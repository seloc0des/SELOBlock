# SELOBlock

<p align="center">
  <img src="icons/icon128.svg" alt="SELOBlock Logo" width="128" height="128">
</p>

<p align="center">
  <strong>🛡️ Browser-level protection against ads, trackers, and data brokers</strong>
</p>

<p align="center">
  <a href="#-why-seloblock">Why SELOBlock</a> •
  <a href="#-features">Features</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-how-it-works">How It Works</a> •
  <a href="#-contributing">Contributing</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/domains_blocked-300,000+-blue?style=flat-square" alt="Domains Blocked">
  <img src="https://img.shields.io/badge/manifest-v3-green?style=flat-square" alt="Manifest V3">
  <img src="https://img.shields.io/badge/license-MIT-orange?style=flat-square" alt="MIT License">
</p>

---

## 🤔 Why SELOBlock?

Every time you browse the web, dozens of hidden trackers follow your every move. Data brokers collect and sell your personal information. Ads slow down your browsing and invade your privacy.

**SELOBlock stops them at the browser level.**

Unlike DNS-based blockers that require network configuration, SELOBlock works instantly in your browser—no setup, no configuration, no technical knowledge required.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| **🚫 300,000+ Domains Blocked** | Comprehensive protection from day one |
| **🏃 Native Performance** | Uses Chrome's built-in blocking API—zero slowdown |
| **🔐 Data Broker Protection** | Specifically targets companies that buy and sell your data |
| **📊 Real-time Statistics** | See exactly what's being blocked |
| **✅ Easy Whitelisting** | One click to allow a trusted site |
| **🔒 Privacy First** | No data collection. No tracking. Fully open source. |

---

## 🚀 Quick Start

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/seloc0des/seloblock.git
   cd seloblock
   ```

2. **Build the rulesets** (requires Node.js)
   ```bash
   node scripts/build-rulesets.js
   ```

3. **Load in Chrome/Edge/Brave**
   - Navigate to `chrome://extensions`
   - Enable **Developer mode** (top right toggle)
   - Click **Load unpacked**
   - Select the `seloblock` folder

4. **Done!** The shield icon appears in your toolbar. You're protected.

---

## 🎯 What Gets Blocked

SELOBlock uses two carefully curated block lists:

### SELO Block List
A merged and deduplicated collection from the most trusted sources in the privacy community:
- **OISD** — One of the most comprehensive domain blocklists
- **Steven Black Hosts** — The gold standard unified hosts file
- **AdGuard DNS** — Industry-leading ad and tracker filtering

### Data Broker Block List
Specifically targets **data brokers**—companies that collect, aggregate, and sell your personal information to advertisers, insurance companies, employers, and more.

> 📖 Learn more: [Data Broker Block List](https://github.com/seloc0des/databrokerblocklist)

---

## ⚙️ How It Works

SELOBlock uses Chrome's **Declarative Net Request API** (Manifest V3) with static rulesets. This means:

```
┌─────────────────────────────────────────────────────────────┐
│  Traditional Ad Blockers          SELOBlock                 │
├─────────────────────────────────────────────────────────────┤
│  JavaScript intercepts requests → Chrome blocks natively    │
│  Runs in extension sandbox      → Runs in browser engine    │
│  Can slow down browsing         → Zero performance impact   │
│  Limited rule capacity          → 300,000+ rules supported  │
└─────────────────────────────────────────────────────────────┘
```

### Architecture

- **Static Rulesets** — Block rules compiled at build time (10 files × 30,000 rules)
- **Dynamic Rules** — Reserved for user whitelist entries
- **No Background Processing** — Rules evaluated by Chrome itself

---

## 📱 Using SELOBlock

### Popup Controls
Click the SELOBlock icon in your toolbar to:
- **Toggle protection** on/off
- **View statistics** — total blocks, today's blocks, active rules
- **Whitelist current site** — instantly allow a trusted domain

### Settings Page
Access via popup → **Settings** or right-click the extension icon:
- View included block lists and build info
- Manage whitelisted domains
- See detailed blocking statistics

---

## 🔧 Development

### Project Structure
```
seloblock/
├── manifest.json              # Extension manifest
├── seloblocklist_300k.txt     # Pre-built SELO block list
├── src/
│   ├── background/            # Service worker & statistics
│   ├── popup/                 # Popup UI
│   └── options/               # Settings page
├── rulesets/                  # Generated JSON rulesets
├── scripts/
│   └── build-rulesets.js      # Ruleset generator
└── icons/                     # Extension icons
```

### Updating Block Lists

```bash
# Regenerate rulesets with latest lists
node scripts/build-rulesets.js

# Then reload the extension in chrome://extensions
```

### Build Output
```
Loading Data Broker Block List...
  Found 796 domains
Loading SELO Block List...
  Found 299,956 domains

Total unique domains: 300,744
Generating 10 ruleset file(s)...

Build complete!
Total rules: 300,000
```

---

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

- **🐛 Report bugs** — Open an issue with reproduction steps
- **💡 Suggest features** — We'd love to hear your ideas
- **🔧 Submit PRs** — Code improvements are always appreciated
- **📝 Improve docs** — Help make SELOBlock more accessible

### Block List Contributions

Found a domain that should be blocked? Submit it to:
- [SELO Block List](https://github.com/seloc0des/SELO-Block-List)
- [Data Broker Block List](https://github.com/seloc0des/databrokerblocklist)

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

<p align="center">
  <strong>Take back your privacy. Install SELOBlock.</strong>
</p>

<p align="center">
  Made with 🛡️ by <a href="https://selodev.com">SELOdev</a> • <a href="https://github.com/seloc0des">GitHub</a> • <a href="mailto:selodev3d@gmail.com">Contact</a>
</p>
