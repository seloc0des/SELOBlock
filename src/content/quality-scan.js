// SELOBlock content-quality scanner (Phase A).
//
// Registered programmatically by the service worker (so "disabled" means this
// never runs at all). Executes once per document load: waits for one
// requestIdleCallback plus a short settle delay so lazy ad slots have loaded,
// extracts a raw signal vector in a handful of native queries, and posts it to
// the service worker. It never modifies the page and never blocks anything.
//
// Extraction is wrapped per-signal so one bad measurement can't sink the vector.
// Timing is measured (extractMs) against the 50ms budget, not assumed.

(() => {
  if (window.__seloQualityScanned) return; // one scan per document
  window.__seloQualityScanned = true;

  const SETTLE_MS = 500;
  const MIN_WORDS = 200;

  // Content scripts are classic scripts and cannot import the phrases module, so
  // these constants are generated from src/quality/phrases.js (the source of
  // truth) by scripts/build-phrases.js. Re-run it after editing that list.
  // BEGIN GENERATED PHRASES -- do not edit by hand.
  const PHRASE_LIST_VERSION = 1;
  const BOILERPLATE_PHRASES = [
    "in today's fast-paced",
    'in the ever-evolving',
    "let's dive in",
    'look no further',
    'when it comes to',
    "it's important to note",
    'in conclusion',
  ];
  // END GENERATED PHRASES

  const AD_HOST = /(doubleclick|googlesyndication|googleadservices|adservice|adnxs|amazon-adsystem|taboola|outbrain|criteo|adsafeprotected|2mdn|moatads|rubiconproject|pubmatic|openx)\./i;
  const AD_TOKEN = /^(ad|ads|adslot|advert|advertisement|sponsor|sponsored|promoted|taboola|outbrain)([-_].*)?$/i;
  // Affiliate markers, anchored to URL components: params/path via AFF_PARAM,
  // known networks via AFF_HOSTS. Testing the whole href with a bare substring
  // regex flagged ordinary links (any ?tag=/?ref=, any host containing "awin").
  const AFF_PARAM = /([?&](tag|ref|aff(?:iliate)?)[_=]|\/dp\/|amzn\.to)/i;
  const AFF_HOSTS = [
    'shareasale.com', 'impact.com', 'awin.com', 'awin1.com', 'cj.com',
    'rstyle.me', 'shopstyle.com', 'skimlinks.com',
  ];
  // (^|\.) anchors each brand to a label boundary; without it short alternatives
  // like x/t/fb match mid-label (netflix.com, cnet.com, nyt.com) and wrongly drop
  // real citations.
  const SOCIAL = /(^|\.)(twitter|x|facebook|instagram|linkedin|youtube|tiktok|reddit|pinterest|fb|t)\.(com|co|me)$/i;
  const PAYLOAD_BREAK = new Set(['OL', 'TABLE', 'H2', 'PRE', 'CODE']);

  function isPrivateHost(h) {
    return (
      h === 'localhost' ||
      h.endsWith('.local') ||
      /^127\./.test(h) ||
      /^10\./.test(h) ||
      /^192\.168\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
      h === '::1'
    );
  }

  function shouldSkip() {
    if (!/^https?:$/.test(location.protocol)) return true;
    if (document.contentType && !/html/.test(document.contentType)) return true;
    if (isPrivateHost(location.hostname)) return true;
    return false;
  }

  function words(text) {
    const t = (text || '').trim();
    if (!t) return 0;
    return t.split(/\s+/).length;
  }

  function mainRegion() {
    return (
      document.querySelector('main, article, [role="main"]') ||
      document.body ||
      document.documentElement
    );
  }

  // --- individual signal extractors (each guarded by the caller) -------------

  function extract() {
    const t0 = performance.now();
    const region = mainRegion();
    const regionText = (region.innerText || '').trim();
    const wordCount = words(regionText);

    const signals = { wordCount };

    guard(signals, 'textToMarkup', () => {
      const visible = (document.body?.innerText || '').length;
      const markup = document.documentElement.outerHTML.length || 1;
      return round(visible / markup, 4);
    });

    guard(signals, 'linkDensity', () => {
      const anchors = region.querySelectorAll('a[href]').length;
      return round(anchors / Math.max(wordCount, 1), 4);
    });

    guard(signals, 'domDepthToContent', () => {
      const blocks = document.querySelectorAll('p, li, blockquote, pre');
      for (const el of blocks) {
        if ((el.innerText || '').trim().length > 40) return depthOf(el);
      }
      return 0;
    });

    guard(signals, 'adSlotCount', countAdSlots);

    guard(signals, null, () => {
      const { affiliateLinkCount, affiliateRatio, outboundCitations } = analyzeAnchors();
      signals.affiliateLinkCount = affiliateLinkCount;
      signals.affiliateRatio = affiliateRatio;
      signals.outboundCitations = outboundCitations;
    });

    guard(signals, 'overlayCount', countOverlays);
    guard(signals, 'preambleWords', preambleWords);

    guard(signals, 'boilerplateHits', () => {
      const hay = regionText.toLowerCase();
      let hits = 0;
      for (const p of BOILERPLATE_PHRASES) if (hay.includes(p)) hits++;
      return hits;
    });

    guard(signals, 'hasByline', hasByline);
    guard(signals, 'hasDate', hasDate);

    signals.phraseListVersion = PHRASE_LIST_VERSION;
    signals.extractMs = round(performance.now() - t0, 1);
    return { signals, wordCount };
  }

  function guard(target, key, fn) {
    try {
      const v = fn();
      if (key) target[key] = v;
    } catch {
      if (key) target[key] = key === 'hasByline' || key === 'hasDate' ? false : 0;
    }
  }

  function depthOf(el) {
    let d = 0;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) d++;
    return d;
  }

  function countAdSlots() {
    let count = document.querySelectorAll('ins.adsbygoogle').length;

    const candidates = document.querySelectorAll(
      '[class*="ad" i],[id*="ad" i],[class*="sponsor" i],[id*="sponsor" i],' +
        '[class*="promoted" i],[class*="taboola" i],[class*="outbrain" i]'
    );
    const seen = new Set();
    for (const el of candidates) {
      if (seen.has(el)) continue;
      // getAttribute('class'), not el.className: on SVG elements className is an
      // SVGAnimatedString object that stringifies to "[object ...]".
      const tokens = `${el.id} ${el.getAttribute('class') || ''}`.split(/\s+/);
      if (tokens.some((tok) => AD_TOKEN.test(tok))) {
        count++;
        seen.add(el);
      }
    }

    for (const f of document.querySelectorAll('iframe[src]')) {
      if (AD_HOST.test(f.src)) count++;
    }
    return count;
  }

  function isAffiliate(u) {
    const h = u.hostname.replace(/^www\./, '');
    if (AFF_HOSTS.some((x) => h === x || h.endsWith('.' + x))) return true;
    return AFF_PARAM.test(u.search + u.pathname);
  }

  function analyzeAnchors() {
    const here = location.hostname.replace(/^www\./, '');
    let affiliate = 0;
    let outbound = 0;
    const citationHosts = new Set();

    for (const a of document.querySelectorAll('a[href]')) {
      const href = a.href || '';
      let u;
      try {
        u = new URL(href, location.href);
      } catch {
        continue;
      }
      const host = u.hostname;
      if (!host) continue;
      const bare = host.replace(/^www\./, '');
      const external = bare !== here && !bare.endsWith(`.${here}`) && !here.endsWith(`.${bare}`);
      if (!external) continue;
      outbound++;
      const isAff = isAffiliate(u);
      if (isAff) affiliate++;
      if (!isAff && !SOCIAL.test(bare)) citationHosts.add(bare);
    }

    return {
      affiliateLinkCount: affiliate,
      affiliateRatio: outbound ? round(affiliate / outbound, 4) : 0,
      outboundCitations: citationHosts.size,
    };
  }

  function countOverlays() {
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    const viewport = vw * vh;
    const candidates = document.querySelectorAll(
      '[role="dialog"],[aria-modal="true"],[class*="modal" i],[class*="popup" i],' +
        '[class*="overlay" i],[class*="interstitial" i],[class*="newsletter" i],[class*="subscribe" i]'
    );
    let count = 0;
    for (const el of candidates) {
      const style = getComputedStyle(el);
      if (style.position !== 'fixed' && style.position !== 'sticky') continue;
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height >= viewport * 0.25) count++;
    }
    return count;
  }

  function preambleWords() {
    const h1 = document.querySelector('h1');
    if (!h1) return 0;
    let count = 0;
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT);
    walker.currentNode = h1;
    let node = walker.nextNode();
    while (node) {
      if (PAYLOAD_BREAK.has(node.tagName)) break;
      node = walker.nextNode();
    }
    // Count words in text nodes between the H1 and the payload break, minus any
    // script/style text (Range.toString() would otherwise include it).
    const range = document.createRange();
    range.setStartAfter(h1);
    if (node) range.setEndBefore(node);
    else range.setEndAfter(document.body || document.documentElement);
    const frag = range.cloneContents();
    frag.querySelectorAll('script, style').forEach((n) => n.remove());
    count = words(frag.textContent);
    return count;
  }

  function hasByline() {
    if (document.querySelector('meta[name="author"][content], meta[property="article:author"][content]')) {
      return true;
    }
    return jsonLdHas((obj) => obj.author || typeOf(obj).includes('Person'));
  }

  function hasDate() {
    if (
      document.querySelector(
        'meta[property="article:published_time"][content], time[datetime]'
      )
    ) {
      return true;
    }
    return jsonLdHas((obj) => obj.datePublished);
  }

  function typeOf(obj) {
    const t = obj && obj['@type'];
    return Array.isArray(t) ? t.join(',') : String(t || '');
  }

  function jsonLdHas(pred) {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try {
        data = JSON.parse(s.textContent);
      } catch {
        continue;
      }
      const nodes = Array.isArray(data) ? data : data['@graph'] || [data];
      for (const n of nodes) {
        if (n && typeof n === 'object' && pred(n)) return true;
      }
    }
    return false;
  }

  function round(n, dp) {
    const f = 10 ** dp;
    return Math.round(n * f) / f;
  }

  // --- run ------------------------------------------------------------------

  function run() {
    if (shouldSkip()) return;
    const { signals, wordCount } = extract();
    if (wordCount < MIN_WORDS) return; // SPA shells / app UIs produce garbage
    try {
      // Fire-and-forget. In MV3 sendMessage returns a promise that rejects if
      // the worker is asleep / the context was invalidated; swallow it so it
      // doesn't surface as an unhandled rejection. A scan is best-effort.
      const p = chrome.runtime.sendMessage({
        type: 'QUALITY_SIGNALS',
        payload: { url: location.href, signals, extractedAt: Date.now() },
      });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      // Synchronous throw (no extension context at all); ignore.
    }
  }

  const schedule = () => setTimeout(run, SETTLE_MS);
  if ('requestIdleCallback' in window) {
    requestIdleCallback(schedule, { timeout: 2000 });
  } else {
    schedule();
  }
})();
