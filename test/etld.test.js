// eTLD+1 resolution tests against the shipped PSL artifact. Run: node --test
//
// These guard the cases that a naive .slice(-2) would get wrong and that
// motivated shipping the full Public Suffix List.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registrableDomain } from '../src/quality/etld.js';

test('registrable domain resolution', () => {
  const cases = [
    ['www.example.com', 'example.com'],
    ['news.example.com', 'example.com'],
    ['example.com', 'example.com'],
    ['a.b.example.co.uk', 'example.co.uk'], // multi-part ICANN suffix
    ['example.co.uk', 'example.co.uk'],
    ['user1.github.io', 'user1.github.io'], // github.io is a private suffix
    ['user2.github.io', 'user2.github.io'],
    ['github.io', null], // bare public suffix has no registrable domain
    ['foo.bar.s3.amazonaws.com', 'bar.s3.amazonaws.com'],
    ['sub.city.kawasaki.jp', 'city.kawasaki.jp'], // *.kawasaki.jp wildcard
  ];
  for (const [host, expected] of cases) {
    assert.equal(registrableDomain(host), expected, `${host}`);
  }
});

test('degenerate hosts return null', () => {
  for (const host of ['localhost', '192.168.1.1', 'co.uk', '', null, undefined]) {
    assert.equal(registrableDomain(host), null, `${host}`);
  }
});
