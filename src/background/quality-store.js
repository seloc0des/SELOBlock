// Storage layer for the quality-scoring feature.
//
// All persistent state lives under dotted `quality.*` keys in
// chrome.storage.local, namespaced away from the blocking feature's keys
// (stats / whitelist / isEnabled). The service worker is the only caller.
//
// Privacy model (see the spec's hard constraint):
//   - quality.domains : eTLD+1 aggregates only. No URLs, paths, or page text.
//   - quality.labels  : written ONLY on an explicit user label click.
//   - quality.recent  : origin+path ring buffer, OFF by default (debug aid).
// Full URLs never touch disk except in a label record the user chose to create.
//
// Composites are never persisted. Domain bands are recomputed on read from the
// raw reservoir, so changing a weight in score.js re-scores all history for free.

import { scoreSignals, WEIGHTS_VERSION, PHRASE_LIST_VERSION } from '../quality/score.js';

const KEYS = {
  settings: 'quality.settings',
  domains: 'quality.domains',
  labels: 'quality.labels',
  recent: 'quality.recent',
};

const RESERVOIR_MAX = 20;
const DOMAINS_MAX = 5000;
const LABELS_MAX = 2000;
const RECENT_MAX = 500;
const MIN_SAMPLES = 3; // no domain verdict below this

export const DEFAULT_SETTINGS = {
  enabled: true,
  showBadge: true,
  keepRecent: false,
  weightsVersion: WEIGHTS_VERSION,
  phraseListVersion: PHRASE_LIST_VERSION,
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

async function read(key, fallback) {
  try {
    const got = await chrome.storage.local.get(key);
    return got[key] === undefined ? fallback : got[key];
  } catch {
    return fallback;
  }
}

async function write(key, value) {
  await chrome.storage.local.set({ [key]: value });
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
// Returns the updated aggregate (band is only meaningful once n >= MIN_SAMPLES).
export async function recordScan(domain, signals, band) {
  if (!domain) return null;
  const domains = await read(KEYS.domains, {});

  const entry = domains[domain] || { n: 0, lastSeen: 0, band: null, reservoir: [] };
  entry.reservoir.push(signals);
  if (entry.reservoir.length > RESERVOIR_MAX) {
    entry.reservoir = entry.reservoir.slice(-RESERVOIR_MAX);
  }
  entry.n += 1;
  entry.lastSeen = Date.now();
  // Denormalized cache for raw export/debug; getDomain always recomputes from
  // the reservoir so a weights change is not orphaned by this value.
  entry.band = band ?? entry.band;
  domains[domain] = entry;

  evictLRU(domains);
  await write(KEYS.domains, domains);
  return summarize(domain, entry);
}

function evictLRU(domains) {
  const keys = Object.keys(domains);
  if (keys.length <= DOMAINS_MAX) return;
  keys
    .sort((a, b) => (domains[a].lastSeen || 0) - (domains[b].lastSeen || 0))
    .slice(0, keys.length - DOMAINS_MAX)
    .forEach((k) => delete domains[k]);
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
  const domains = await read(KEYS.domains, {});
  const entry = domains[domain];
  if (!entry) return { domain, samples: 0, hasVerdict: false, domainScore: null, domainBand: null };
  return summarize(domain, entry);
}

// --- labels (explicit user action only) --------------------------------------

export async function addLabel({ url, domain, label, signals }) {
  const labels = await read(KEYS.labels, []);
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
}

export async function getLabels() {
  return read(KEYS.labels, []);
}

// --- recent ring buffer (debug; gated by settings.keepRecent) ----------------

export async function addRecent({ originPath, domain, signals, score }) {
  const recent = await read(KEYS.recent, []);
  recent.push({ originPath, domain, ts: Date.now(), signals, score });
  if (recent.length > RECENT_MAX) recent.splice(0, recent.length - RECENT_MAX);
  await write(KEYS.recent, recent);
}
