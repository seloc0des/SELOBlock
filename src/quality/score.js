// Pure content-quality scorer.
//
// Contract: signals in, { score, band } out. No I/O, no DOM, no storage access.
// This is the single slot Phase B will replace with a model. Keep it pure.
//
// The weights below are guesses, exactly as the spec frames them. Expect to
// change them within a week of real use. Because callers store the RAW signal
// vector (never a composite), changing a weight here re-scores all accumulated
// history for free. Bump WEIGHTS_VERSION on every change so label records can be
// attributed to the formula that produced them.

import { PHRASE_LIST_VERSION } from './phrases.js';

export const WEIGHTS_VERSION = 1;
export { PHRASE_LIST_VERSION };

// Band thresholds. score >= clean -> "clean"; >= mixed -> "mixed"; else "slop".
export const BANDS = { clean: 70, mixed: 40 };

// Per-term penalty caps (points subtracted from a base of 100).
const CAPS = {
  adSlot: 25,
  affiliate: 20,
  preamble: 15,
  linkDensity: 10,
  boilerplate: 12,
  overlay: 10,
  textToMarkup: 15,
  blocked: 15,
};

// Bonuses.
const BONUS_BYLINE = 5;
const BONUS_CITATIONS = 5;
const CITATION_THRESHOLD = 3;

// --- Derived-quantity tunables (the spec names these but does not define them) ---

// linkDensity is anchors / word. Normal prose sits well under LINK_DENSITY_FLOOR;
// aggregator and doorway pages spike far above it. Below the floor, no penalty.
const LINK_DENSITY_FLOOR = 0.1;
const LINK_DENSITY_SCALE = 40; // hits the cap around linkDensity ~= 0.35

// textToMarkup is visible-text-chars / serialized-HTML-length, a small ratio.
// At or above TEXT_TO_MARKUP_GOOD the page is considered text-dense (no penalty);
// near zero it is markup-bloated (full penalty).
const TEXT_TO_MARKUP_GOOD = 0.25;

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Score a raw signal vector.
 *
 * @param {object} signals - raw, un-normalized signals from extraction.
 * @param {number} signals.adSlotCount
 * @param {number} signals.affiliateRatio      - 0..1
 * @param {number} signals.preambleWords
 * @param {number} signals.linkDensity          - anchors / word
 * @param {number} signals.boilerplateHits
 * @param {number} signals.overlayCount
 * @param {number} signals.textToMarkup         - visible-text / html-length ratio
 * @param {number} [signals.blockedRequests]    - optional; term is dropped if absent
 * @param {boolean} signals.hasByline
 * @param {number} signals.outboundCitations
 * @returns {{ score: number, band: string, usedBlockedRequests: boolean }}
 */
export function scoreSignals(signals = {}) {
  const s = signals || {};

  const adSlotPenalty = Math.min(num(s.adSlotCount) * 4, CAPS.adSlot);
  const affiliatePenalty = Math.min(num(s.affiliateRatio) * 40, CAPS.affiliate);
  const preamblePenalty = Math.min((num(s.preambleWords) / 50) * 5, CAPS.preamble);

  const linkDensityPenalty = clamp(
    (num(s.linkDensity) - LINK_DENSITY_FLOOR) * LINK_DENSITY_SCALE,
    0,
    CAPS.linkDensity
  );

  const boilerplatePenalty = Math.min(num(s.boilerplateHits) * 3, CAPS.boilerplate);
  const overlayPenalty = Math.min(num(s.overlayCount) * 5, CAPS.overlay);

  const textToMarkupNormalized = clamp(num(s.textToMarkup) / TEXT_TO_MARKUP_GOOD, 0, 1);
  const textToMarkupPenalty = Math.min((1 - textToMarkupNormalized) * 15, CAPS.textToMarkup);

  // blockedRequests is dev-only (see the DNR spike). When absent, we DROP the
  // term rather than inflating the others to stand in for it: a page should not
  // be judged worse because we could not measure something. This keeps packed
  // scores comparable to dev scores minus, at most, the blocked penalty. If
  // label data later shows a systematic dev/packed band shift, revisit this.
  const hasBlocked = s.blockedRequests != null && Number.isFinite(Number(s.blockedRequests));
  const blockedPenalty = hasBlocked
    ? Math.min(num(s.blockedRequests) / 4, CAPS.blocked)
    : 0;

  const bylineBonus = s.hasByline ? BONUS_BYLINE : 0;
  const citationBonus = num(s.outboundCitations) >= CITATION_THRESHOLD ? BONUS_CITATIONS : 0;

  const raw =
    100 -
    adSlotPenalty -
    affiliatePenalty -
    preamblePenalty -
    linkDensityPenalty -
    boilerplatePenalty -
    overlayPenalty -
    textToMarkupPenalty -
    blockedPenalty +
    bylineBonus +
    citationBonus;

  const score = clamp(Math.round(raw), 0, 100);

  return { score, band: bandFor(score), usedBlockedRequests: hasBlocked };
}

/** Map a numeric score to its band. */
export function bandFor(score) {
  if (score >= BANDS.clean) return 'clean';
  if (score >= BANDS.mixed) return 'mixed';
  return 'slop';
}
