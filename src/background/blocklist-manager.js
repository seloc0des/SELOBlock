export class BlockListManager {
  constructor() {
    this.cache = new Map();
  }

  async fetchAndParse(url) {
    const response = await fetch(url, {
      headers: {
        'Cache-Control': 'no-cache'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }

    const text = await response.text();
    return this.parseHostsFile(text);
  }

  parseHostsFile(content) {
    const domains = new Set();
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) {
        continue;
      }

      let domain = null;

      if (trimmed.startsWith('0.0.0.0 ') || trimmed.startsWith('127.0.0.1 ')) {
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 2) {
          domain = parts[1].split('#')[0].trim();
        }
      }
      else if (trimmed.startsWith('||') && trimmed.endsWith('^')) {
        domain = trimmed.slice(2, -1);
      }
      else if (trimmed.startsWith('||')) {
        domain = trimmed.slice(2).split('^')[0].split('/')[0];
      }
      else if (!trimmed.includes(' ') && !trimmed.includes('/') && trimmed.includes('.')) {
        domain = trimmed;
      }

      if (domain && this.isValidDomain(domain)) {
        domains.add(domain.toLowerCase());
      }
    }

    return domains;
  }

  isValidDomain(domain) {
    if (!domain || domain.length < 4) return false;
    if (domain === 'localhost') return false;
    if (domain.startsWith('.') || domain.endsWith('.')) return false;
    if (domain.startsWith('-') || domain.endsWith('-')) return false;
    if (domain.includes('..')) return false;

    if (/^\d+\.\d+\.\d+\.\d+$/.test(domain)) return false;

    const validPattern = /^[a-zA-Z0-9][a-zA-Z0-9-]*(\.[a-zA-Z0-9][a-zA-Z0-9-]*)*\.[a-zA-Z]{2,}$/;
    return validPattern.test(domain);
  }
}
