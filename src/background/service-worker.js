import { Statistics } from './statistics.js';

const ALARM_NAME = 'seloblock-stats';

class SELOBlock {
  constructor() {
    this.statistics = new Statistics();
    this.isEnabled = true;
  }

  async initialize() {
    console.log('[SELOBlock] Initializing...');
    
    const stored = await chrome.storage.local.get(['isEnabled']);
    this.isEnabled = stored.isEnabled !== undefined ? stored.isEnabled : true;

    await this.statistics.initialize();
    await this.applyBlockingState();
    await this.applyWhitelistRules();
    
    this.setupAlarm();
    this.setupListeners();
    
    await this.loadRulesetMeta();
    
    console.log('[SELOBlock] Initialization complete');
  }

  async loadRulesetMeta() {
    try {
      const response = await fetch(chrome.runtime.getURL('rulesets/meta.json'));
      if (response.ok) {
        const meta = await response.json();
        await chrome.storage.local.set({
          totalDomains: meta.totalDomains,
          lastUpdate: new Date(meta.generated).getTime(),
          rulesetCount: meta.rulesets
        });
        console.log(`[SELOBlock] Loaded ${meta.totalDomains.toLocaleString()} domains from ${meta.rulesets} rulesets`);
      }
    } catch (error) {
      console.log('[SELOBlock] No ruleset meta found - run build script first');
    }
  }

  setupAlarm() {
    chrome.alarms.create(ALARM_NAME, {
      periodInMinutes: 60
    });
  }

  setupListeners() {
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === ALARM_NAME) {
        this.statistics.saveSession();
      }
    });

    if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
      chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
        this.statistics.recordBlock(info.request.url, info.request.tabId);
      });
    } else {
      console.log('[SELOBlock] Note: Detailed statistics require Developer Mode');
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true;
    });
  }

  async handleMessage(message, sender, sendResponse) {
    try {
      switch (message.type) {
        case 'GET_STATUS':
          sendResponse({
            isEnabled: this.isEnabled,
            stats: await this.statistics.getStats()
          });
          break;

        case 'TOGGLE_ENABLED':
          this.isEnabled = message.enabled;
          await chrome.storage.local.set({ isEnabled: this.isEnabled });
          await this.applyBlockingState();
          sendResponse({ success: true, isEnabled: this.isEnabled });
          break;

        case 'GET_RULESETS':
          const rulesets = await this.getRulesetInfo();
          sendResponse({ rulesets });
          break;

        case 'TOGGLE_RULESET':
          await this.toggleRuleset(message.id, message.enabled);
          sendResponse({ success: true });
          break;

        case 'GET_STATS':
          const stats = await this.statistics.getStats();
          sendResponse({ stats });
          break;

        case 'RESET_STATS':
          await this.statistics.reset();
          sendResponse({ success: true });
          break;

        case 'ADD_WHITELIST':
          await this.addToWhitelist(message.domain);
          sendResponse({ success: true });
          break;

        case 'REMOVE_WHITELIST':
          await this.removeFromWhitelist(message.domain);
          sendResponse({ success: true });
          break;

        case 'GET_WHITELIST':
          const whitelist = await this.getWhitelist();
          sendResponse({ whitelist });
          break;

        default:
          sendResponse({ error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('[SELOBlock] Error handling message:', error);
      sendResponse({ error: error.message });
    }
  }

  async getRulesetInfo() {
    try {
      const available = await chrome.declarativeNetRequest.getAvailableStaticRuleCount();
      const enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
      const response = await fetch(chrome.runtime.getURL('rulesets/meta.json'));
      const meta = response.ok ? await response.json() : null;
      
      return {
        enabled,
        availableCount: available,
        meta
      };
    } catch (error) {
      return { enabled: [], availableCount: 0, meta: null };
    }
  }

  async toggleRuleset(id, enabled) {
    try {
      if (enabled) {
        await chrome.declarativeNetRequest.updateEnabledRulesets({
          enableRulesetIds: [id]
        });
      } else {
        await chrome.declarativeNetRequest.updateEnabledRulesets({
          disableRulesetIds: [id]
        });
      }
    } catch (error) {
      console.error('[SELOBlock] Failed to toggle ruleset:', error);
    }
  }

  async applyBlockingState() {
    try {
      const allRulesets = await this.getAvailableRulesets();
      
      if (this.isEnabled) {
        if (allRulesets.length > 0) {
          await chrome.declarativeNetRequest.updateEnabledRulesets({
            enableRulesetIds: allRulesets
          });
          console.log(`[SELOBlock] Enabled ${allRulesets.length} rulesets`);
        }
      } else {
        const enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
        if (enabled.length > 0) {
          await chrome.declarativeNetRequest.updateEnabledRulesets({
            disableRulesetIds: enabled
          });
          console.log('[SELOBlock] Disabled all rulesets');
        }
      }
    } catch (error) {
      console.error('[SELOBlock] Error applying blocking state:', error);
    }
  }

  async getAvailableRulesets() {
    try {
      const response = await fetch(chrome.runtime.getURL('rulesets/meta.json'));
      if (response.ok) {
        const meta = await response.json();
        return Array.from({ length: meta.rulesets }, (_, i) => `ruleset_${i + 1}`);
      }
    } catch (error) {
      console.log('[SELOBlock] Could not load ruleset meta');
    }
    return [];
  }

  async applyWhitelistRules() {
    const whitelist = await this.getWhitelist();
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const existingIds = existingRules.map(r => r.id);

    if (existingIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existingIds
      });
    }

    if (whitelist.length > 0) {
      const allowRules = whitelist.map((domain, index) => ({
        id: index + 1,
        priority: 2,
        action: { type: 'allow' },
        condition: {
          urlFilter: `||${domain}`,
          resourceTypes: [
            'main_frame', 'sub_frame', 'stylesheet', 'script', 'image',
            'font', 'object', 'xmlhttprequest', 'ping', 'media',
            'websocket', 'webtransport', 'webbundle', 'other'
          ]
        }
      }));

      await chrome.declarativeNetRequest.updateDynamicRules({
        addRules: allowRules
      });
      console.log(`[SELOBlock] Applied ${allowRules.length} whitelist rules`);
    }
  }

  async getWhitelist() {
    const stored = await chrome.storage.local.get(['whitelist']);
    return stored.whitelist || [];
  }

  async addToWhitelist(domain) {
    const whitelist = await this.getWhitelist();
    if (!whitelist.includes(domain)) {
      whitelist.push(domain);
      await chrome.storage.local.set({ whitelist });
      await this.applyWhitelistRules();
    }
  }

  async removeFromWhitelist(domain) {
    let whitelist = await this.getWhitelist();
    whitelist = whitelist.filter(d => d !== domain);
    await chrome.storage.local.set({ whitelist });
    await this.applyWhitelistRules();
  }
}

const seloblock = new SELOBlock();
seloblock.initialize();
