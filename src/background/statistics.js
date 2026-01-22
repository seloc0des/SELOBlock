export class Statistics {
  constructor() {
    this.sessionBlocks = 0;
    this.sessionBlocksByDomain = new Map();
  }

  async initialize() {
    const stored = await chrome.storage.local.get(['stats']);
    if (!stored.stats) {
      await this.reset();
    }
  }

  async reset() {
    this.sessionBlocks = 0;
    this.sessionBlocksByDomain.clear();
    
    await chrome.storage.local.set({
      stats: {
        totalBlocks: 0,
        blocksByDate: {},
        topBlockedDomains: {},
        lastReset: Date.now()
      }
    });
  }

  async recordBlock(url, tabId) {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname;

      this.sessionBlocks++;
      this.sessionBlocksByDomain.set(
        domain,
        (this.sessionBlocksByDomain.get(domain) || 0) + 1
      );

      const stored = await chrome.storage.local.get(['stats']);
      const stats = stored.stats || {
        totalBlocks: 0,
        blocksByDate: {},
        topBlockedDomains: {},
        lastReset: Date.now()
      };

      stats.totalBlocks++;

      const today = new Date().toISOString().split('T')[0];
      stats.blocksByDate[today] = (stats.blocksByDate[today] || 0) + 1;

      stats.topBlockedDomains[domain] = (stats.topBlockedDomains[domain] || 0) + 1;

      const sortedDomains = Object.entries(stats.topBlockedDomains)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 100);
      stats.topBlockedDomains = Object.fromEntries(sortedDomains);

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const cutoffDate = thirtyDaysAgo.toISOString().split('T')[0];
      
      for (const date of Object.keys(stats.blocksByDate)) {
        if (date < cutoffDate) {
          delete stats.blocksByDate[date];
        }
      }

      await chrome.storage.local.set({ stats });
    } catch (error) {
      console.error('[SELOBlock] Error recording block:', error);
    }
  }

  async getStats() {
    const stored = await chrome.storage.local.get(['stats', 'totalDomains', 'appliedRules', 'lastUpdate']);
    
    return {
      ...(stored.stats || {
        totalBlocks: 0,
        blocksByDate: {},
        topBlockedDomains: {},
        lastReset: Date.now()
      }),
      sessionBlocks: this.sessionBlocks,
      totalDomains: stored.totalDomains || 0,
      appliedRules: stored.appliedRules || 0,
      lastUpdate: stored.lastUpdate || null
    };
  }

  async getTodayBlocks() {
    const stats = await this.getStats();
    const today = new Date().toISOString().split('T')[0];
    return stats.blocksByDate[today] || 0;
  }

  async saveSession() {
    console.log('[SELOBlock] Session stats saved');
  }
}
