class PopupController {
  constructor() {
    this.elements = {
      enableToggle: document.getElementById('enableToggle'),
      totalBlocked: document.getElementById('totalBlocked'),
      todayBlocked: document.getElementById('todayBlocked'),
      rulesActive: document.getElementById('rulesActive'),
      statusBar: document.getElementById('statusBar'),
      statusText: document.getElementById('statusText'),
      whitelistBtn: document.getElementById('whitelistBtn'),
      lastUpdate: document.getElementById('lastUpdate'),
      optionsLink: document.getElementById('optionsLink'),
      qualitySection: document.getElementById('qualitySection'),
      qualityBand: document.getElementById('qualityBand'),
      qualityDomain: document.getElementById('qualityDomain'),
      qualityBlocked: document.getElementById('qualityBlocked'),
      labelSlopBtn: document.getElementById('labelSlopBtn'),
      labelFineBtn: document.getElementById('labelFineBtn')
    };

    this.activeTabId = null;
    this.labeled = false; // user labeled this scan; keep buttons disabled
    this.labeledUrl = null; // scan URL the label applies to (reset on nav)
    this.init();
  }

  async init() {
    // A tabs.query failure must not take the whole popup down with it; the
    // blocking UI still works even if we can't resolve the active tab.
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      this.activeTabId = tab ? tab.id : null;
    } catch {
      this.activeTabId = null;
    }
    await this.loadStatus();
    await this.loadQuality();
    this.setupEventListeners();
    this.startPolling();
  }

  async loadQuality() {
    if (this.activeTabId == null) return;
    let report;
    try {
      report = await this.sendMessage({ type: 'QUALITY_GET_TAB', tabId: this.activeTabId });
    } catch {
      return;
    }
    if (!report) return;

    const { scan, blockedCount, domainInfo } = report;

    // Nothing to show for this page (no scan, no block count, no domain history):
    // keep the section hidden instead of rendering an empty panel.
    if (!scan && blockedCount == null && !domainInfo?.samples) {
      this.elements.qualitySection.hidden = true;
      return;
    }
    this.elements.qualitySection.hidden = false;

    // Reset the labeled latch when the scan is for a different URL (the popup
    // can stay open across a navigation).
    const scanUrl = scan ? scan.url : null;
    if (scanUrl !== this.labeledUrl) {
      this.labeled = false;
      this.labeledUrl = null;
    }

    const bandEl = this.elements.qualityBand;
    bandEl.className = 'quality-band';
    if (scan && scan.band) {
      bandEl.textContent = scan.band;
      bandEl.classList.add(scan.band);
      bandEl.title = `raw score ${scan.score}`;
    } else {
      bandEl.textContent = '—';
      bandEl.title = '';
    }

    if (domainInfo && domainInfo.hasVerdict) {
      this.elements.qualityDomain.textContent =
        `${domainInfo.domain} · reputation ${domainInfo.domainBand} (${domainInfo.samples})`;
    } else if (domainInfo && domainInfo.samples > 0) {
      this.elements.qualityDomain.textContent =
        `${domainInfo.domain} · ${domainInfo.samples}/3 visits`;
    } else {
      this.elements.qualityDomain.textContent = scan && scan.domain ? scan.domain : '';
    }

    this.elements.qualityBlocked.textContent =
      blockedCount != null ? `${blockedCount} blocked here` : '';

    // Labels need a stored scan to attach signals to; once labeled, stay done
    // so the 5s poll doesn't re-enable the buttons and invite a duplicate label.
    const done = !scan || this.labeled;
    this.elements.labelSlopBtn.classList.toggle('done', done);
    this.elements.labelFineBtn.classList.toggle('done', done);
  }

  async loadStatus() {
    try {
      const response = await this.sendMessage({ type: 'GET_STATUS' });
      
      if (response) {
        this.elements.enableToggle.checked = response.isEnabled;
        this.updateUI(response.isEnabled);
        
        if (response.stats) {
          this.updateStats(response.stats);
        }
      }
    } catch (error) {
      console.error('Failed to load status:', error);
    }
  }

  updateUI(isEnabled) {
    const statusDot = this.elements.statusBar.querySelector('.status-dot');
    
    if (isEnabled) {
      this.elements.statusBar.classList.remove('disabled');
      statusDot.classList.remove('inactive');
      statusDot.classList.add('active');
      this.elements.statusText.textContent = 'Protection Active';
    } else {
      this.elements.statusBar.classList.add('disabled');
      statusDot.classList.add('inactive');
      statusDot.classList.remove('active');
      this.elements.statusText.textContent = 'Protection Disabled';
    }
  }

  updateStats(stats) {
    this.elements.totalBlocked.textContent = this.formatNumber(stats.totalBlocks || 0);
    
    const today = new Date().toISOString().split('T')[0];
    const todayBlocks = stats.blocksByDate?.[today] || 0;
    this.elements.todayBlocked.textContent = this.formatNumber(todayBlocks);
    
    this.elements.rulesActive.textContent = this.formatNumber(stats.appliedRules || 0);
    
    if (stats.totalDomains) {
      this.elements.lastUpdate.textContent = `${this.formatNumber(stats.totalDomains)} domains blocked`;
    }
  }

  formatNumber(num) {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }

  formatDate(date) {
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) {
      return 'Just now';
    } else if (diff < 3600000) {
      const mins = Math.floor(diff / 60000);
      return `${mins} minute${mins > 1 ? 's' : ''} ago`;
    } else if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else {
      return date.toLocaleDateString();
    }
  }

  setupEventListeners() {
    this.elements.enableToggle.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      await this.sendMessage({ type: 'TOGGLE_ENABLED', enabled });
      this.updateUI(enabled);
      this.showNotification(enabled ? 'Protection enabled' : 'Protection disabled');
    });

    this.elements.whitelistBtn.addEventListener('click', async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url) {
          const url = new URL(tab.url);
          const domain = url.hostname;
          
          await this.sendMessage({ type: 'ADD_WHITELIST', domain });
          this.showNotification(`${domain} whitelisted`);
        }
      } catch (error) {
        this.showNotification('Failed to whitelist site', true);
      }
    });

    this.elements.optionsLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });

    const onLabel = async (e) => {
      const btn = e.currentTarget;
      if (btn.classList.contains('done') || this.activeTabId == null) return;
      const label = btn.dataset.label;
      try {
        const res = await this.sendMessage({
          type: 'QUALITY_LABEL',
          tabId: this.activeTabId,
          label
        });
        if (res && res.success) {
          this.labeled = true;
          this.labeledUrl = res.url || this.labeledUrl;
          this.elements.labelSlopBtn.classList.add('done');
          this.elements.labelFineBtn.classList.add('done');
          this.showNotification('Label saved');
        } else if (res && res.error) {
          // Storage error surfaced by the controller; buttons stay enabled to retry.
          this.showNotification('Failed to save label', true);
        } else {
          this.showNotification('No page scan to label', true);
        }
      } catch {
        this.showNotification('Failed to save label', true);
      }
    };
    this.elements.labelSlopBtn.addEventListener('click', onLabel);
    this.elements.labelFineBtn.addEventListener('click', onLabel);
  }

  startPolling() {
    setInterval(() => {
      this.loadStatus();
      this.loadQuality();
    }, 5000);
  }

  sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
  }

  showNotification(message, isError = false) {
    let notification = document.querySelector('.notification');
    
    if (!notification) {
      notification = document.createElement('div');
      notification.className = 'notification';
      document.body.appendChild(notification);
    }

    notification.textContent = message;
    notification.classList.toggle('error', isError);
    notification.classList.add('show');

    setTimeout(() => {
      notification.classList.remove('show');
    }, 2000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});
