// Storage layer for the quality-scoring feature.
//
// All persistent state lives under dotted `quality.*` keys in
// chrome.storage.local, namespaced away from the blocking feature's keys
// (stats / whitelist / isEnabled). The service worker is the only caller.
//
// Privacy model (see the spec's hard constraint):
//   - quality.domain.<etld+1> : per-domain eTLD+1 aggregate. No URLs/paths/text.
//   - quality.domainIndex     : {domain: lastSeen} for LRU eviction only.
//   - quality.labels          : written ONLY on an explicit user label click.
//   - quality.recent          : origin+path ring buffer, OFF by default (debug).
// Full URLs never touch disk except in a label record the user chose to create.
//
// Composites are never persisted. Domain bands are recomputed on read from the
// raw reservoir, so changing a weight in score.js re-scores all history for free.
//
// Concurrency: reputation lives in one key per domain, so a racing/failed write
// can only affect that one domain, never the whole table. The still-shared
// arrays (labels/recent) go through a small in-worker write mutex so two tabs
// appending at once can't clobber each other. Read-modify-write paths BAIL on a
// storage read error rather than writing an empty fallback over real data.

import { scoreSignals, WEIGHTS_VERSION, PHRASE_LIST_VERSION } from '../quality/score.js';

const KEYS = {
  settings: 'quality.settings',
  labels: 'quality.labels',
  recent: 'quality.recent',
  domainIndex: 'quality.domainIndex',
};

const DOMAIN_PREFIX = 'quality.domain.';
const domainKey = (d) => DOMAIN_PREFIX + d;

const RESERVOIR_MAX = 20;
const DOMAINS_MAX = 5000;
const LABELS_MAX = 2000;
const RECENT_MAX = 500;
const MIN_SAMPLES = 3; // no domain verdict below this

// weightsVersion/phraseListVersion are code facts, not user settings, so they're
// NOT persisted here (they'd freeze stale on disk). The controller stamps the
// current code constants onto the settings it hands back to the UI.
export const DEFAULT_SETTINGS = {
  enabled: true,
  showBadge: true,
  keepRecent: false,
};

// Numeric signal fields we take medians of. hasByline is handled separately as
// a boolean. Unknown/extra fields on a vector are ignored by the scorer anyway.
const NUMERIC_SIGNAL_KEYS = [
  'adSlotCount',
  'affiliateLinkCount',
  'affiliateRatio',
  'overlayCount',
  'blockedRequests',
  'preambleWords',
  'boilerplateHits',
  'outboundCitations',
  'linkDensity',
  'textToMarkup',
  'wordCount',
  'domDepthToContent',
];

// --- low-level get/set -------------------------------------------------------

// Throws on a storage error. Mutating paths use this so a transient read failure
// aborts the write instead of clobbering real data with the fallback.
async function getOrThrow(key, fallback) {
  const got = await chrome.storage.local.get(key);
  return got[key] === undefined ? fallback : got[key];
}

// Swallows storage errors -> fallback. Only for read-only display paths where a
// transient miss is harmless.
async function read(key, fallback) {
  try {
    return await getOrThrow(key, fallback);
  } catch {
    return fallback;
  }
}

async function write(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

// Serialize all read-modify-write operations through one in-worker promise
// queue. Writes are infrequent; global serialization is the simplest correct
// fix for two tabs racing on the same key (shared arrays, or the same domain).
let writeChain = Promise.resolve();
function withLock(fn) {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(() => {}, () => {}); // keep the chain alive, swallow settle
  return run;
}

// --- settings ----------------------------------------------------------------

export async function getSettings() {
  const stored = await read(KEYS.settings, {});
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function setSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await write(KEYS.settings, next);
  return next;
}

// --- median helpers ----------------------------------------------------------

function median(nums) {
  const xs = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (xs.length === 0) return undefined;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

// Reduce a reservoir of raw signal vectors to one median vector for scoring.
export function medianVector(reservoir) {
  const out = {};
  for (const key of NUMERIC_SIGNAL_KEYS) {
    const m = median(reservoir.map((v) => Number(v?.[key])));
    if (m !== undefined) out[key] = m;
  }
  // Boolean: majority vote on presence.
  const bylineVotes = reservoir.filter((v) => v && v.hasByline).length;
  out.hasByline = bylineVotes * 2 >= reservoir.length;
  return out;
}

// --- domains -----------------------------------------------------------------

// Record one page scan into its domain's reservoir. `domain` is an eTLD+1.
// Returns the updated aggregate (band is only meaningful once n >= MIN_SAMPLES),
// or null if a storage read failed (we bail rather than reset the domain).
export async function recordScan(domain, signals, band) {
  if (!domain) return null;
  return withLock(async () => {
    const key = domainKey(domain);
    let entry;
    try {
      entry = await getOrThrow(key, null);
    } catch {
      return null; // read failed; don't overwrite a possibly-populated key
    }
    entry = entry || { n: 0, lastSeen: 0, band: null, reservoir: [] };
    entry.reservoir.push(signals);
    if (entry.reservoir.length > RESERVOIR_MAX) {
      entry.reservoir = entry.reservoir.slice(-RESERVOIR_MAX);
    }
    entry.n += 1;
    entry.lastSeen = Date.now();
    // Denormalized cache for raw export/debug; getDomain always recomputes from
    // the reservoir so a weights change is not orphaned by this value.
    entry.band = band ?? entry.band;

    await write(key, entry);
    await touchIndex(domain, entry.lastSeen);
    return summarize(domain, entry);
  });
}

// Maintain the lightweight LRU index and evict the oldest domains when over the
// cap. Reading one small index key avoids the O(table) load of the old blob.
async function touchIndex(domain, lastSeen) {
  let index;
  try {
    index = await getOrThrow(KEYS.domainIndex, {});
  } catch {
    return; // best-effort; a miss just delays eviction, never loses data
  }
  index[domain] = lastSeen;
  const names = Object.keys(index);
  if (names.length > DOMAINS_MAX) {
    const evict = names
      .sort((a, b) => (index[a] || 0) - (index[b] || 0))
      .slice(0, names.length - DOMAINS_MAX);
    for (const d of evict) {
      delete index[d];
      await chrome.storage.local.remove(domainKey(d)).catch(() => {});
    }
  }
  await write(KEYS.domainIndex, index);
}

function summarize(domain, entry) {
  const enough = entry.n >= MIN_SAMPLES;
  const verdict = enough ? scoreSignals(medianVector(entry.reservoir)) : null;
  return {
    domain,
    samples: entry.n,
    hasVerdict: enough,
    domainScore: verdict ? verdict.score : null,
    domainBand: verdict ? verdict.band : null,
  };
}

export async function getDomain(domain) {
  if (!domain) return null;
  const entry = await read(domainKey(domain), null);
  if (!entry) return { domain, samples: 0, hasVerdict: false, domainScore: null, domainBand: null };
  return summarize(domain, entry);
}

// --- labels (explicit user action only) --------------------------------------

export async function addLabel({ url, domain, label, signals }) {
  return withLock(async () => {
    // Bail on read failure: the label set is the whole point of Phase A, so a
    // transient error must not fall through to writing an empty array over it.
    const labels = await getOrThrow(KEYS.labels, []);
    labels.push({
      url,
      domain,
      ts: Date.now(),
      label, // 'slop' | 'fine'
      signals,
      weightsVersion: WEIGHTS_VERSION,
      phraseListVersion: PHRASE_LIST_VERSION,
    });
    if (labels.length > LABELS_MAX) labels.splice(0, labels.length - LABELS_MAX);
    await write(KEYS.labels, labels);
    return labels.length;
  });
}

export async function getLabels() {
  return read(KEYS.labels, []);
}

// --- recent ring buffer (debug; gated by settings.keepRecent) ----------------

export async function addRecent({ originPath, domain, signals, score }) {
  return withLock(async () => {
    let recent;
    try {
      recent = await getOrThrow(KEYS.recent, []);
    } catch {
      return; // debug ring buffer; a read failure just skips this entry
    }
    recent.push({ originPath, domain, ts: Date.now(), signals, score });
    if (recent.length > RECENT_MAX) recent.splice(0, recent.length - RECENT_MAX);
    await write(KEYS.recent, recent);
  });
}
