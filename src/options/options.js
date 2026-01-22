class OptionsController {
  constructor() {
    this.elements = {
      totalDomainsInfo: document.getElementById('totalDomainsInfo'),
      rulesetsInfo: document.getElementById('rulesetsInfo'),
      builtInfo: document.getElementById('builtInfo'),
      whitelistContainer: document.getElementById('whitelistContainer'),
      newWhitelistDomain: document.getElementById('newWhitelistDomain'),
      addWhitelistBtn: document.getElementById('addWhitelistBtn'),
      statTotalBlocks: document.getElementById('statTotalBlocks'),
      statTotalDomains: document.getElementById('statTotalDomains'),
      statActiveRules: document.getElementById('statActiveRules'),
      statLastUpdate: document.getElementById('statLastUpdate'),
      topBlockedList: document.getElementById('topBlockedList'),
      resetStatsBtn: document.getElementById('resetStatsBtn')
    };

    this.init();
  }

  async init() {
    await this.loadRulesetInfo();
    await this.loadWhitelist();
    await this.loadStats();
    this.setupEventListeners();
  }

  async loadRulesetInfo() {
    try {
      const response = await this.sendMessage({ type: 'GET_RULESETS' });
      if (response.rulesets && response.rulesets.meta) {
        const meta = response.rulesets.meta;
        this.elements.totalDomainsInfo.textContent = meta.totalDomains.toLocaleString();
        this.elements.rulesetsInfo.textContent = `${meta.rulesets} (${response.rulesets.enabled.length} enabled)`;
        this.elements.builtInfo.textContent = new Date(meta.generated).toLocaleDateString();
      } else {
        this.elements.totalDomainsInfo.textContent = 'Not built';
        this.elements.rulesetsInfo.textContent = 'Run build script';
        this.elements.builtInfo.textContent = 'N/A';
      }
    } catch (error) {
      console.error('Failed to load ruleset info:', error);
    }
  }

  async loadWhitelist() {
    try {
      const response = await this.sendMessage({ type: 'GET_WHITELIST' });
      this.renderWhitelist(response.whitelist || []);
    } catch (error) {
      console.error('Failed to load whitelist:', error);
    }
  }

  renderWhitelist(whitelist) {
    if (whitelist.length === 0) {
      this.elements.whitelistContainer.innerHTML = '<div class="whitelist-empty">No whitelisted domains</div>';
      return;
    }

    this.elements.whitelistContainer.innerHTML = whitelist.map(domain => `
      <div class="whitelist-item" data-domain="${this.escapeHtml(domain)}">
        <span>${this.escapeHtml(domain)}</span>
        <button class="btn-remove" title="Remove from whitelist">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18"/>
            <path d="M6 6l12 12"/>
          </svg>
        </button>
      </div>
    `).join('');

    this.elements.whitelistContainer.querySelectorAll('.btn-remove').forEach(btn => {
      btn.addEventListener('click', (e) => this.handleWhitelistRemove(e));
    });
  }

  async handleWhitelistRemove(e) {
    const domain = e.target.closest('.whitelist-item').dataset.domain;
    
    try {
      await this.sendMessage({ type: 'REMOVE_WHITELIST', domain });
      await this.loadWhitelist();
      this.showNotification(`${domain} removed from whitelist`);
    } catch (error) {
      this.showNotification('Failed to remove from whitelist', true);
    }
  }

  async loadStats() {
    try {
      const response = await this.sendMessage({ type: 'GET_STATS' });
      this.renderStats(response.stats || {});
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  }

  renderStats(stats) {
    this.elements.statTotalBlocks.textContent = this.formatNumber(stats.totalBlocks || 0);
    this.elements.statTotalDomains.textContent = this.formatNumber(stats.totalDomains || 0);
    this.elements.statActiveRules.textContent = this.formatNumber(stats.appliedRules || 0);
    
    if (stats.lastUpdate) {
      const date = new Date(stats.lastUpdate);
      this.elements.statLastUpdate.textContent = date.toLocaleDateString();
    }

    const topDomains = Object.entries(stats.topBlockedDomains || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    if (topDomains.length === 0) {
      this.elements.topBlockedList.innerHTML = '<div class="top-blocked-empty">No blocked domains yet</div>';
    } else {
      this.elements.topBlockedList.innerHTML = topDomains.map(([domain, count]) => `
        <div class="top-blocked-item">
          <span class="top-blocked-domain">${this.escapeHtml(domain)}</span>
          <span class="top-blocked-count">${this.formatNumber(count)}</span>
        </div>
      `).join('');
    }
  }

  setupEventListeners() {
    this.elements.addWhitelistBtn.addEventListener('click', async () => {
      const domain = this.elements.newWhitelistDomain.value.trim().toLowerCase();

      if (!domain) {
        this.showNotification('Please enter a domain', true);
        return;
      }

      try {
        await this.sendMessage({ type: 'ADD_WHITELIST', domain });
        this.elements.newWhitelistDomain.value = '';
        await this.loadWhitelist();
        this.showNotification(`${domain} added to whitelist`);
      } catch (error) {
        this.showNotification('Failed to add to whitelist', true);
      }
    });

    this.elements.resetStatsBtn.addEventListener('click', async () => {
      if (confirm('Are you sure you want to reset all statistics?')) {
        try {
          await this.sendMessage({ type: 'RESET_STATS' });
          await this.loadStats();
          this.showNotification('Statistics reset');
        } catch (error) {
          this.showNotification('Failed to reset statistics', true);
        }
      }
    });
  }

  formatNumber(num) {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toLocaleString();
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
    }, 3000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new OptionsController();
});
