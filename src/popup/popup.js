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
      optionsLink: document.getElementById('optionsLink')
    };

    this.init();
  }

  async init() {
    await this.loadStatus();
    this.setupEventListeners();
    this.startPolling();
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
  }

  startPolling() {
    setInterval(() => this.loadStatus(), 5000);
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
