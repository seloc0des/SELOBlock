# SELOBlock Quality Scoring (Phase A)

## The gap this fills

SELOBlock is an identity filter. It asks whether a domain appears on a 300k-entry list and it answers before the page renders, declaratively, without ever looking at content. That works well for what it targets: ad networks, trackers, data brokers. Known bad actors on stable domains.

It has no answer for the other half of a bad web page.

A recipe blog with 1,400 words of Tuscan childhood before the flour measurement loads completely clean. Nothing on OISD. Nothing on StevenBlack. No trackers worth blocking, because it isn't a privacy problem. SELOBlock waves it through, correctly. Meanwhile a genuinely good newspaper article trips fifty rules and gets nothing but a counter increment.

Blocklists cannot close this gap, and not for lack of effort. Slop domains rotate faster than curated lists update, and there is no community consensus to crowdsource from. Everyone agrees about doubleclick. Nobody agrees about content farms.

So this layer asks a different question. Not "who is this," but "what is this page doing to me."

## Scope

In scope for Phase A:

- Heuristic signal extraction from rendered DOM
- A per-page quality band, surfaced in the popup
- Per-domain reputation accumulated across visits
- A manual label button and a JSON export, for calibration

Out of scope, deliberately:

- Truthfulness or fact checking. Not now, not in a later phase. A local model has worse world knowledge than most pages it would grade, and a personal truth filter tuned until it agrees with you is a bias amplifier with a nice UI.
- Any LLM inference. Phase A is heuristics only. The point is finding out how far heuristics get before committing to a model pipeline.
- Blocking, hiding, or rewriting page content. Scoring annotates. It never intervenes.
- Search integration. That is Phase C and it depends on this working first.

## Privacy constraint

This is a hard constraint, not a preference. SELOBlock's README promises no data collection. A quality scorer that persists every URL you visit would break that promise even though the data never leaves the machine, and "it's only local" is exactly the excuse every telemetry vendor uses.

Rules:

- Persisted by default: eTLD+1 aggregates only. Domain name, visit count, median signal values, last seen timestamp.
- Never persisted by default: full URLs, paths, query strings, page titles, page text.
- Persisted only on explicit user action: when the user clicks a label button, that single page's URL and signal vector are written to the label store. That is a deliberate act, not passive collection.
- The recent-pages ring buffer used for debugging holds origin plus path with query stripped, caps at 500 entries, and ships disabled. It is a developer affordance and the options page should say so.

If a design decision makes the privacy story worse, the design decision loses.

## Signals

Each signal is extracted once per page and stored raw. No normalization at extraction time.

Content structure:

- `textToMarkup` - visible text character count divided by total serialized HTML length. Slop pages carry enormous DOM overhead relative to what you can actually read.
- `wordCount` - visible words in the main content region.
- `linkDensity` - anchor count divided by word count. Aggregator and doorway pages spike here.
- `domDepthToContent` - nesting depth of the first substantive text block. Deeply buried content usually means chrome-heavy templating.

Commercial intent:

- `adSlotCount` - elements matching known ad container patterns. `ins.adsbygoogle`, ids and classes containing ad, advert, sponsor, promoted, taboola, outbrain, plus iframes whose src matches ad-serving hosts.
- `affiliateLinkCount` and `affiliateRatio` - anchors carrying affiliate markers, over total outbound anchors. Match on `tag=`, `/dp/`, `amzn.to`, `ref=`, shareasale, impact.com, awin, cj.com, rstyle, shopstyle, skimlinks.
- `overlayCount` - fixed or sticky positioned elements covering a meaningful share of viewport at scan time. Newsletter modals, subscribe gates, app install interstitials.
- `blockedRequests` - count of DNR rule matches attributed to this tab. Optional. See constraints below.

Padding and provenance:

- `preambleWords` - words between the H1 and the first element that looks like real payload. First `ol`, `table`, `h2`, or code block, whichever comes first. This is the recipe blog detector.
- `boilerplateHits` - count of matches against a small phrase list. "in today's fast-paced", "in the ever-evolving", "let's dive in", "look no further", "when it comes to", "it's important to note", "in conclusion". Keep the list short and versioned. It will need tuning and you want to know which version produced which score.
- `hasByline` - author present via meta tag, `article:author`, or JSON-LD Person.
- `hasDate` - `article:published_time`, `datePublished`, or a `time[datetime]` element.
- `outboundCitations` - anchors to external domains that are not affiliate, not social, not the site's own network.

## Scoring

Compute the score at read time from stored raw signals. Do not persist a composite.

The reason is practical. You will change these weights repeatedly over the first month, and every change would otherwise orphan your accumulated history. Keeping the vector raw means a weight change re-scores everything you have already seen, instantly and for free.

Score lives in a single pure function with no I/O, no storage access, no DOM access. Signals in, number out. That makes it trivially testable and trivially replaceable when Phase B wants a model in the same slot.

Starting weights, presented as a guess and nothing more. These are unvalidated. Expect to change them within a week of real use.

```
score = 100
  - min(adSlotCount * 4, 25)
  - min(affiliateRatio * 40, 20)
  - min(preambleWords / 50 * 5, 15)
  - min(linkDensityPenalty, 10)
  - min(boilerplateHits * 3, 12)
  - min(overlayCount * 5, 10)
  - min((1 - textToMarkupNormalized) * 15, 15)
  - min(blockedRequests / 4, 15)        // only if available
  + (hasByline ? 5 : 0)
  + (outboundCitations >= 3 ? 5 : 0)
```

Surface a band, not the number. Bands are honest about the precision you actually have.

- 70 and above: clean
- 40 to 69: mixed
- below 40: slop

The raw number stays available in the options page for debugging and calibration, because you will want it. Users get a band.

## Domain reputation

Slop is overwhelmingly domain-consistent. One bad page from a domain predicts the next one well, which means per-domain aggregation is where most of the practical value sits, and eventually it is what lets you skip scanning entirely for domains you already know.

Keep a reservoir of the last 20 signal vectors per domain and compute medians on read. Running medians are fiddly and a 20-element reservoir is cheap. Use median rather than mean so a single outlier page does not drag a domain's reputation around.

Key on eTLD+1. Do not try to be clever about subdomains in Phase A. Cap the table at 5,000 domains with LRU eviction, which is far more than a single human visits in months.

Require at least 3 samples before displaying a domain-level verdict. One page is not a reputation.

## Storage schema

All state in `chrome.storage.local`. The MV3 service worker terminates after roughly 30 seconds idle, so anything held only in memory is gone by the next page load. This is the single most common bug in MV3 extensions and it fails intermittently, which makes it miserable to chase later.

```
quality.settings   { enabled, showBadge, keepRecent, weightsVersion, phraseListVersion }
quality.domains    { "<etld+1>": { n, lastSeen, band, reservoir: [SignalVector x20] } }
quality.labels     [ { url, domain, ts, label, signals, weightsVersion } ]   cap 2000
quality.recent     [ { originPath, domain, ts, signals, score } ]            cap 500, off by default
```

Stamp `weightsVersion` and `phraseListVersion` onto every label record. When you retune and your accuracy shifts, you will want to know which formula produced which judgment, and reconstructing that after the fact is not possible.

## Calibration loop

The popup gets two buttons: this page was slop, this page was fine. One click writes the current page's URL and signal vector to the label store with the user's verdict.

The options page gets an export button that dumps `quality.labels` as JSON.

This is small and it is the most important part of Phase A. Without labels you are tuning by feel, and tuning by feel converges on a filter that agrees with your mood. With a few hundred labels you can compute actual precision and recall per signal, find out which of these heuristics are carrying weight and which are decorative, and hand Phase B a real training set instead of starting over.

Most projects like this skip the label button and die of unfalsifiability. Do not skip the label button.

## Constraints and known hazards

**DNR feedback is quota-limited.** `chrome.declarativeNetRequest.getMatchedRules()` allows 20 calls per 10 minutes unless the extension holds `activeTab` for the tab in question, and it requires the `declarativeNetRequestFeedback` permission. `onRuleMatchedDebug` fires only for unpacked extensions and is not an option for a distributed build. Spike this before designing around it. The scorer must degrade gracefully when `blockedRequests` is unavailable, dropping that term and renormalizing rather than failing.

**Service worker lifetime.** Covered above. No in-memory state that matters.

**Scan timing.** Run the content script at `document_idle`, then wait for one `requestIdleCallback` plus a short settle delay before extracting. Scanning too early misses lazy-loaded ad slots and undercounts the exact thing you care about most.

**Do not scan everything.** Skip non-HTML documents, extension pages, localhost and private ranges, and pages under roughly 200 words. SPA shells and app UIs will produce garbage signals and pollute domain reputation with noise.

**Performance budget.** The extension's current selling point is native-speed blocking with zero JS in the request path. Do not spend that. Extraction should complete in under 50ms on a typical page. Measure it, do not assume it. If a single-pass DOM walk collecting all signals at once is faster than separate queries per signal, write it that way.

**Same-page navigation.** SPAs change content without a page load. Phase A ignores this. Scan once per document load and accept the gap.

## Done means

- Visiting a page produces a band in the popup within a second of load
- Domain reputation shows after 3 visits to a domain
- Both label buttons work and export produces valid JSON
- Scoring lives in one pure function with unit tests covering the boundaries between bands
- Blocking behavior is byte-for-byte unchanged, and the block path has no new work in it
- Nothing beyond domain aggregates is persisted unless the user clicked a label
- The whole thing can be disabled from options, and disabled means the content script does not run at all

## Later phases, recorded so they do not creep in now

Phase B routes middle-band pages to a local model on selodevserv for a content judgment, keeping heuristics as the fast path. Phase C re-ranks SearXNG results using the accumulated domain table. Neither is in scope, and Phase C is not really a separate project so much as the payoff for this one.
