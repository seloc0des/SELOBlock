// Unit tests for the pure scorer. Zero-dependency: run with `node --test`.
//
//   node --test
//
// Covers the band boundaries (the numbers that actually matter to the UI) and
// the blockedRequests-absent degradation path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreSignals, bandFor, BANDS } from '../src/quality/score.js';

// A signal vector that, on its own, scores 100 (text-dense, no penalties).
// textToMarkup >= 0.25 zeroes the markup-bloat term.
const CLEAN = { textToMarkup: 0.5 };

test('bandFor thresholds', () => {
  assert.equal(bandFor(100), 'clean');
  assert.equal(bandFor(BANDS.clean), 'clean'); // 70
  assert.equal(bandFor(BANDS.clean - 1), 'mixed'); // 69
  assert.equal(bandFor(BANDS.mixed), 'mixed'); // 40
  assert.equal(bandFor(BANDS.mixed - 1), 'slop'); // 39
  assert.equal(bandFor(0), 'slop');
});

test('a text-dense page with no penalties scores 100 / clean', () => {
  assert.deepEqual(scoreSignals(CLEAN), {
    score: 100,
    band: 'clean',
    usedBlockedRequests: false,
  });
});

test('clean/mixed boundary at 70', () => {
  // adSlotCount caps at 25, overlayCount 1 -> 5. 100 - 30 = 70.
  const at70 = scoreSignals({ ...CLEAN, adSlotCount: 100, overlayCount: 1 });
  assert.equal(at70.score, 70);
  assert.equal(at70.band, 'clean');

  // + preambleWords 10 -> penalty 1. 100 - 31 = 69.
  const at69 = scoreSignals({ ...CLEAN, adSlotCount: 100, overlayCount: 1, preambleWords: 10 });
  assert.equal(at69.score, 69);
  assert.equal(at69.band, 'mixed');
});

test('mixed/slop boundary at 40', () => {
  // ad 25 + affiliate 20 + overlay 10 + preamble 5 = 60. 100 - 60 = 40.
  const at40 = scoreSignals({
    ...CLEAN,
    adSlotCount: 100,
    affiliateRatio: 1,
    overlayCount: 100,
    preambleWords: 50,
  });
  assert.equal(at40.score, 40);
  assert.equal(at40.band, 'mixed');

  // preambleWords 60 -> penalty 6. total 61. 100 - 61 = 39.
  const at39 = scoreSignals({
    ...CLEAN,
    adSlotCount: 100,
    affiliateRatio: 1,
    overlayCount: 100,
    preambleWords: 60,
  });
  assert.equal(at39.score, 39);
  assert.equal(at39.band, 'slop');
});

test('blockedRequests: present penalizes, absent is dropped (not inflated)', () => {
  const withBlocked = scoreSignals({ ...CLEAN, blockedRequests: 40 }); // min(40/4,15)=10
  assert.equal(withBlocked.score, 90);
  assert.equal(withBlocked.usedBlockedRequests, true);

  const withoutBlocked = scoreSignals({ ...CLEAN });
  assert.equal(withoutBlocked.score, 100);
  assert.equal(withoutBlocked.usedBlockedRequests, false);

  // A missing measurement must never score worse than a zero measurement.
  const zeroBlocked = scoreSignals({ ...CLEAN, blockedRequests: 0 });
  assert.ok(withoutBlocked.score >= zeroBlocked.score);
});

test('bonuses apply and the score clamps at 100', () => {
  const byline = scoreSignals({ ...CLEAN, adSlotCount: 100, hasByline: true }); // 75 + 5
  assert.equal(byline.score, 80);

  const citations = scoreSignals({ ...CLEAN, adSlotCount: 100, outboundCitations: 3 });
  assert.equal(citations.score, 80);

  // Bonuses cannot push past 100.
  const capped = scoreSignals({ ...CLEAN, hasByline: true, outboundCitations: 5 });
  assert.equal(capped.score, 100);
});

test('malformed signals do not throw and stay in range', () => {
  for (const bad of [null, undefined, {}, { adSlotCount: 'x', affiliateRatio: NaN }]) {
    const r = scoreSignals(bad);
    assert.ok(r.score >= 0 && r.score <= 100);
    assert.ok(['clean', 'mixed', 'slop'].includes(r.band));
  }
});
