Here's what to correct, grouped by how much it matters. I've written the actual fix for each — several are one-liners, two are small restructures.

Must fix — these break the feature or lose data
1. preambleWords payload-break (quality-scan.js:39, 228) — the flagship "recipe-blog detector" is dead. Swap the substring test for set membership, and while you're in there, stop Range.toString() from counting <script>/<style> text (#15):


const PAYLOAD_BREAK = new Set(['OL', 'TABLE', 'H2', 'PRE', 'CODE']);
// ...
while (node) {
  if (PAYLOAD_BREAK.has(node.tagName)) break;
  node = walker.nextNode();
}
// ...count words, excluding script/style:
const frag = range.cloneContents();
frag.querySelectorAll('script, style').forEach((n) => n.remove());
count = words(frag.textContent);
2. Unsafe read-modify-write in the store (quality-store.js) — a masked get() error or a two-tab race can wipe the domain table or the entire label set. The genuinely-correct fix is a small restructure, not a band-aid:

Per-domain keys for reputation: quality.domain.<etld+1> instead of one quality.domains blob. This scopes every write to one key (a failed/racing write can't erase other domains) and eliminates the O(table) I/O in finding #13. Keep a separate lightweight LRU index key for eviction.
Don't let a read failure drive a destructive write. In recordScan/addLabel/addRecent, if the read throws, bail — don't fall through to writing the empty fallback back over the key.
Serialize writes to the still-shared quality.labels/quality.recent arrays with a tiny in-worker promise queue (mutex) so concurrent appends don't clobber.
3. Polling re-enables the label buttons → duplicate labels (popup.js:72-73) — track labeled state instead of deriving done from !scan every 5s:


// in onLabel success: this.labeled = true;
// in loadQuality: const done = !scan || this.labeled;
//   toggle('done', done)  — and reset this.labeled=false when the tab/URL changes
4. AFFILIATE regex matches ordinary links (quality-scan.js:34) — anchor tokens to URL components. analyzeAnchors already has the parsed URL, so split host tokens from path/param tokens:


const AFF_PARAM = /([?&](tag|ref|aff(?:iliate)?)[_=]|\/dp\/|amzn\.to)/i;
const AFF_HOSTS = ['shareasale.com','impact.com','awin.com','awin1.com','cj.com','rstyle.me','shopstyle.com','skimlinks.com'];
function isAffiliate(u) {
  const h = u.hostname.replace(/^www\./, '');
  return AFF_HOSTS.some((x) => h === x || h.endsWith('.' + x)) || AFF_PARAM.test(u.search + u.pathname);
}
Should fix — wrong output or fragility
Stale band across navigation (controller:42): on 'loading', also clear the session scan — chrome.storage.session.remove(TAB_KEY(tabId)) — not just the in-memory counter.
Dev-only blockedRequests in persisted reputation (controller:140 / store:97): strip blockedRequests before recordScan. Score the live page with it, but never persist it — that removes both the dev/packed divergence and the "absent ≠ 0" median bias.
handle() drops the reply guarantee (controller:100): add .catch(e => sendResponse({ error: e.message })) to each async case, make default: send an error and return true, and add .catch(()=>{}) to the content script's fire-and-forget sendMessage (quality-scan.js:291).
Version fields freeze stale in settings (store:35): don't persist weightsVersion/phraseListVersion — drop them from DEFAULT_SETTINGS and stamp them from the code constants when answering QUALITY_GET_SETTINGS. They're code facts, not user settings.
Empty quality panel shown on every page (popup.js:42): hide the section when !scan && blockedCount == null && !domainInfo?.samples.
init() can kill the whole popup (popup.js:26): wrap the chrome.tabs.query in try/catch (or move it after setupEventListeners) so a tabs failure only disables the quality section.
Worth fixing — maintainability / MV3 / perf
Phrase-list duplication (quality-scan.js:22): add scripts/build-phrases.js that generates the content-script constants from phrases.js, exactly like build-psl.js does for the PSL — single source of truth, drift becomes impossible.
Listeners registered after await (controller:41, and the base worker): register tabs.onUpdated/onRemoved synchronously at top level, hydrate settings lazily.
PSL Set built on every cold start (psl-data.js:11 / etld.js): memoize — build the Set on first registrableDomain() call, not at import.
The four must-fixes are what I'd do first: #1 and #4 restore the scoring accuracy the feature exists for, and #2 and #3 protect the label data the spec calls the whole point of Phase A.

Want me to implement these? I'd suggest starting with the must-fix tier (#1–#4) plus the two one-line should-fixes (#5, #6) in one pass, then the rest. Say the word and I'll apply them and run the tests.