// eTLD+1 (registrable domain) resolution using the compiled Public Suffix List.
//
// Domain reputation keys on the registrable domain so that, e.g., user1.github.io
// and user2.github.io are treated as distinct sites (github.io is a public
// suffix) while news.example.com and example.com collapse to example.com. This
// correctness is the whole reason we ship the PSL rather than a naive .slice(-2).
//
// Pure module: hostname in, eTLD+1 out. The PSL ships as a newline-joined string
// and is split into a Set lazily on the first resolution (not at import) so a
// cold worker start that never resolves a domain pays nothing.
// Regenerate the rule data with: node scripts/build-psl.js

import { PSL_RULES_RAW } from './psl-data.js';

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

let PSL_SET = null;
function pslRules() {
  if (!PSL_SET) PSL_SET = new Set(PSL_RULES_RAW.split('\n'));
  return PSL_SET;
}

/**
 * Resolve the registrable domain (eTLD+1) for a hostname.
 *
 * @param {string} hostname - a punycode/ASCII hostname (as the browser reports).
 * @param {Set<string>} [rules] - PSL rule set; defaults to the shipped list
 *          (built lazily on first call).
 * @returns {string|null} the eTLD+1, or null when there is none (IP, single
 *          label, localhost, or a bare public suffix).
 */
export function registrableDomain(hostname, rules = pslRules()) {
  if (!hostname) return null;
  let host = String(hostname).toLowerCase().replace(/\.+$/, '');
  if (!host || host === 'localhost') return null;
  if (host.includes(':')) return null; // IPv6 / host:port -- caller should pre-strip
  if (IPV4.test(host)) return null;
  if (host.indexOf('.') === -1) return null; // single label

  const labels = host.split('.');

  // Find the public-suffix length (in labels) using the PSL algorithm:
  // longest matching rule wins; exceptions ('!') override; wildcards ('*.')
  // match exactly one label. The implicit default rule is '*' (one label).
  let psLen = 1;
  for (let i = 0; i < labels.length; i++) {
    const candidate = labels.slice(i).join('.');
    if (rules.has('!' + candidate)) {
      // Exception: the public suffix is this candidate minus its leftmost label.
      psLen = labels.length - i - 1;
      break;
    }
    if (rules.has(candidate)) {
      psLen = labels.length - i;
      break;
    }
    const wildcard = '*.' + labels.slice(i + 1).join('.');
    if (labels.length - i >= 2 && rules.has(wildcard)) {
      psLen = labels.length - i;
      break;
    }
  }

  // A registrable domain needs one label to the left of the public suffix.
  if (psLen >= labels.length) return null;
  return labels.slice(labels.length - psLen - 1).join('.');
}
