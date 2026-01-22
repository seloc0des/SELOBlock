#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const BLOCKLIST_SOURCES = [
  {
    name: 'Data Broker Block List',
    url: 'https://raw.githubusercontent.com/seloc0des/databrokerblocklist/refs/heads/main/lists/databroker.txt',
    priority: true
  },
  {
    name: 'SELO Block List',
    file: path.join(__dirname, '..', 'seloblocklist_300k.txt')
  }
];

const RULES_PER_RULESET = 30000;
const MAX_RULESETS = 10;
const RULESETS_DIR = path.join(__dirname, '..', 'rulesets');
const MANIFEST_PATH = path.join(__dirname, '..', 'manifest.json');

function fetch(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    const request = protocol.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        return fetch(response.headers.location).then(resolve).catch(reject);
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => resolve(data));
      response.on('error', reject);
    });

    request.on('error', reject);
    request.setTimeout(60000, () => {
      request.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

function parseHostsFile(content) {
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
    } else if (trimmed.startsWith('||') && trimmed.endsWith('^')) {
      domain = trimmed.slice(2, -1);
    } else if (trimmed.startsWith('||')) {
      domain = trimmed.slice(2).split('^')[0].split('/')[0];
    } else if (!trimmed.includes(' ') && !trimmed.includes('/') && trimmed.includes('.')) {
      domain = trimmed;
    }

    if (domain && isValidDomain(domain)) {
      domains.add(domain.toLowerCase());
    }
  }

  return domains;
}

function isValidDomain(domain) {
  if (!domain || domain.length < 4) return false;
  if (domain === 'localhost') return false;
  if (domain.startsWith('.') || domain.endsWith('.')) return false;
  if (domain.startsWith('-') || domain.endsWith('-')) return false;
  if (domain.includes('..')) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(domain)) return false;

  const validPattern = /^[a-zA-Z0-9][a-zA-Z0-9-]*(\.[a-zA-Z0-9][a-zA-Z0-9-]*)*\.[a-zA-Z]{2,}$/;
  return validPattern.test(domain);
}

function generateRules(domains, startId = 1) {
  const rules = [];
  let id = startId;

  for (const domain of domains) {
    rules.push({
      id: id++,
      priority: 1,
      action: { type: 'block' },
      condition: {
        urlFilter: `||${domain}^`,
        resourceTypes: [
          'main_frame', 'sub_frame', 'stylesheet', 'script', 'image',
          'font', 'object', 'xmlhttprequest', 'ping', 'media',
          'websocket', 'webtransport', 'webbundle', 'other'
        ]
      }
    });
  }

  return rules;
}

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

async function main() {
  console.log('SELOBlock Ruleset Builder');
  console.log('=========================\n');

  if (!fs.existsSync(RULESETS_DIR)) {
    fs.mkdirSync(RULESETS_DIR, { recursive: true });
  }

  const allDomains = new Set();

  for (const source of BLOCKLIST_SOURCES) {
    console.log(`Loading ${source.name}...`);
    try {
      let content;
      if (source.file) {
        content = fs.readFileSync(source.file, 'utf8');
      } else {
        content = await fetch(source.url);
      }
      const domains = parseHostsFile(content);
      console.log(`  Found ${domains.size.toLocaleString()} domains`);
      domains.forEach(d => allDomains.add(d));
    } catch (error) {
      console.error(`  Error: ${error.message}`);
    }
  }

  console.log(`\nTotal unique domains: ${allDomains.size.toLocaleString()}`);

  const domainsArray = Array.from(allDomains);
  const maxDomains = RULES_PER_RULESET * MAX_RULESETS;
  
  if (domainsArray.length > maxDomains) {
    console.log(`\nWarning: Truncating to ${maxDomains.toLocaleString()} domains (Chrome limit)`);
    domainsArray.length = maxDomains;
  }

  const domainChunks = chunkArray(domainsArray, RULES_PER_RULESET);
  console.log(`\nGenerating ${domainChunks.length} ruleset file(s)...`);

  const ruleResources = [];

  for (let i = 0; i < domainChunks.length; i++) {
    const chunk = domainChunks[i];
    const rulesetId = `ruleset_${i + 1}`;
    const filename = `${rulesetId}.json`;
    const filepath = path.join(RULESETS_DIR, filename);

    const startId = i * RULES_PER_RULESET + 1;
    const rules = generateRules(chunk, startId);

    fs.writeFileSync(filepath, JSON.stringify(rules, null, 0));
    console.log(`  Created ${filename} (${rules.length.toLocaleString()} rules)`);

    ruleResources.push({
      id: rulesetId,
      enabled: true,
      path: `rulesets/${filename}`
    });
  }

  console.log('\nUpdating manifest.json...');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  manifest.declarative_net_request = {
    rule_resources: ruleResources
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');

  const metaPath = path.join(RULESETS_DIR, 'meta.json');
  fs.writeFileSync(metaPath, JSON.stringify({
    generated: new Date().toISOString(),
    totalDomains: domainsArray.length,
    rulesets: domainChunks.length,
    sources: BLOCKLIST_SOURCES.map(s => s.name)
  }, null, 2));

  console.log('\nBuild complete!');
  console.log(`Total rules: ${domainsArray.length.toLocaleString()}`);
  console.log(`Rulesets: ${domainChunks.length}`);
  console.log('\nReload the extension in chrome://extensions to apply changes.');
}

main().catch(console.error);
