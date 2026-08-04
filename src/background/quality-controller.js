// Quality-scoring controller. Owns everything the service worker needs for the
// scoring layer so service-worker.js stays a thin router. Strictly additive:
// it runs after page load and never touches the request/blocking path.
//
// Blocked-count sourcing (see the DNR spike):
//   - dev/unpacked : onRuleMatchedDebug streams per-tab counts for free. Used
//                    both to display and as the (dev-only) blockedRequests score.
//   - packed build : the native badge shows counts; the popup reads a count via
//                    getMatchedRules (activeTab, granted while the popup is open)
//                    or falls back to the badge text. blockedRequests is dropped
//                    from scoring and the scorer renormalizes.

import { registrableDomain } from '../quality/etld.js';
import { scoreSignals, WEIGHTS_VERSION, PHRASE_LIST_VERSION } from '../quality/score.js';
import {
  getSettings,
  setSettings,
  recordScan,
  getDomain,
  addLabel,
  getLabels,
  addRecent,
} from './quality-store.js';

const CS_ID = 'selo-quality-scan';
const TAB_KEY = (tabId) => `quality.tab.${tabId}`;

export class QualityController {
  constructor() {
    // Per-tab blocked counts from onRuleMatchedDebug (dev only). In-memory is
    // fine: the events keep the worker alive across a page's lifetime, and this
    // is a best-effort calibration signal, not persisted reputation.
    this.blockedByTab = new Map();

    // Register tab listeners synchronously at construction (the worker news up
    // this controller at top level). Registering after an await in initialize()
    // risks missing early navigations while settings hydrate.
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo.status === 'loading') {
        this.blockedByTab.delete(tabId);
        // Drop the stale per-tab scan too, or the popup shows the previous
        // page's band until the new page finishes scanning.
        chrome.storage.session.remove(TAB_KEY(tabId)).catch(() => {});
      }
    });
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.blockedByTab.delete(tabId);
      chrome.storage.session.remove(TAB_KEY(tabId)).catch(() => {});
    });
  }

  async initialize() {
    const settings = await getSettings();
    await this.syncBadge(settings.showBadge);
    await this.syncContentScript(settings.enabled);
  }

  // Called from the existing onRuleMatchedDebug listener (dev builds only).
  onBlockedRequest(tabId) {
    if (tabId == null || tabId < 0) return;
    this.blockedByTab.set(tabId, (this.blockedByTab.get(tabId) || 0) + 1);
  }

  devBlockedCount(tabId) {
    return this.blockedByTab.has(tabId) ? this.blockedByTab.get(tabId) : null;
  }

  // --- native badge & content-script registration ---------------------------

  async syncBadge(show) {
    try {
      await chrome.declarativeNetRequest.setExtensionActionOptions({
        displayActionCountAsBadgeText: !!show,
      });
    } catch (e) {
      console.log('[SELOBlock] Could not set badge action count:', e?.message);
    }
  }

  async syncContentScript(enabled) {
    try {
      const existing = await chrome.scripting
        .getRegisteredContentScripts({ ids: [CS_ID] })
        .catch(() => []);
      if (enabled && existing.length === 0) {
        await chrome.scripting.registerContentScripts([
          {
            id: CS_ID,
            js: ['src/content/quality-scan.js'],
            matches: ['http://*/*', 'https://*/*'],
            runAt: 'document_idle',
            allFrames: false,
            world: 'ISOLATED',
          },
        ]);
      } else if (!enabled && existing.length > 0) {
        await chrome.scripting.unregisterContentScripts({ ids: [CS_ID] });
      }
    } catch (e) {
      console.log('[SELOBlock] Content-script registration failed:', e?.message);
    }
  }

  // --- message handling -----------------------------------------------------

  // Returns true if it handled the message (and will call sendResponse). Every
  // async branch has a .catch so a rejected promise still replies; otherwise the
  // caller's sendMessage hangs until the channel closes ("message port closed").
  handle(message, sender, sendResponse) {
    const fail = (e) => sendResponse({ error: e?.message || String(e) });
    switch (message.type) {
      case 'QUALITY_SIGNALS':
        this.onSignals(message.payload, sender).then(() => sendResponse({ ok: true }), fail);
        return true;
      case 'QUALITY_GET_TAB':
        this.getTabReport(message.tabId).then(sendResponse, fail);
        return true;
      case 'QUALITY_LABEL':
        this.onLabel(message.tabId, message.label).then(sendResponse, fail);
        return true;
      case 'QUALITY_EXPORT_LABELS':
        getLabels().then((labels) => sendResponse({ labels }), fail);
        return true;
      case 'QUALITY_GET_SETTINGS':
        this.getSettingsForUi().then((settings) => sendResponse({ settings }), fail);
        return true;
      case 'QUALITY_SET_SETTINGS':
        this.onSetSettings(message.settings).then((settings) => sendResponse({ settings }), fail);
        return true;
      default:
        sendResponse({ error: `Unknown quality message: ${message.type}` });
        return true;
    }
  }

  // Settings as the UI should see them: persisted user prefs plus the current
  // code-fact versions stamped on (never read stale from disk).
  async getSettingsForUi() {
    const settings = await getSettings();
    return { ...settings, weightsVersion: WEIGHTS_VERSION, phraseListVersion: PHRASE_LIST_VERSION };
  }

  async onSignals(payload, sender) {
    const settings = await getSettings();
    if (!settings.enabled) return;

    const tabId = sender?.tab?.id;
    let hostname = '';
    try {
      hostname = new URL(payload.url).hostname;
    } catch {
      return;
    }
    const domain = registrableDomain(hostname);
    const signals = { ...payload.signals };

    // Dev-only scoring signal. Absent in packed builds -> scorer renormalizes.
    const blocked = tabId != null ? this.devBlockedCount(tabId) : null;
    if (blocked != null) signals.blockedRequests = blocked;

    const { score, band } = scoreSignals(signals);

    // Score the live page WITH blockedRequests, but never persist it: it only
    // exists in dev builds, so persisting it would make dev/packed reputations
    // diverge and bias medians (absent != 0). Strip it from everything on disk.
    const persistSignals = { ...signals };
    delete persistSignals.blockedRequests;

    // Transient per-tab cache for the popup. storage.session is in-memory and
    // never written to disk, so holding the full URL here does not break the
    // "URLs never persisted" promise.
    if (tabId != null) {
      await chrome.storage.session.set({
        [TAB_KEY(tabId)]: { url: payload.url, domain, signals: persistSignals, score, band, ts: Date.now() },
      });
    }

    if (domain) await recordScan(domain, persistSignals, band);

    if (settings.keepRecent) {
      try {
        const u = new URL(payload.url);
        await addRecent({ originPath: u.origin + u.pathname, domain, signals: persistSignals, score });
      } catch {
        /* ignore */
      }
    }
  }

  async getTabReport(tabId) {
    const key = TAB_KEY(tabId);
    const got = await chrome.storage.session.get(key).catch(() => ({}));
    const scan = got[key] || null;
    const blockedCount = await this.displayBlockedCount(tabId);
    const domainInfo = scan?.domain ? await getDomain(scan.domain) : null;
    return { scan, blockedCount, domainInfo };
  }

  async onLabel(tabId, label) {
    const key = TAB_KEY(tabId);
    const got = await chrome.storage.session.get(key).catch(() => ({}));
    const scan = got[key];
    if (!scan) return { success: false, reason: 'no-scan' };
    await addLabel({ url: scan.url, domain: scan.domain, label, signals: scan.signals });
    return { success: true, url: scan.url };
  }

  async onSetSettings(patch) {
    const before = await getSettings();
    const settings = await setSettings(patch);
    if (settings.showBadge !== before.showBadge) await this.syncBadge(settings.showBadge);
    if (settings.enabled !== before.enabled) await this.syncContentScript(settings.enabled);
    return { ...settings, weightsVersion: WEIGHTS_VERSION, phraseListVersion: PHRASE_LIST_VERSION };
  }

  // Best-effort blocked count for display: dev counter, else getMatchedRules
  // (works while the popup holds activeTab), else the badge text Chrome painted.
  async displayBlockedCount(tabId) {
    const dev = this.devBlockedCount(tabId);
    if (dev != null) return dev;

    try {
      const res = await chrome.declarativeNetRequest.getMatchedRules({ tabId });
      if (res?.rulesMatchedInfo) return res.rulesMatchedInfo.length;
    } catch {
      /* quota exhausted or no activeTab; fall through */
    }

    try {
      const text = await chrome.action.getBadgeText({ tabId });
      const n = parseInt(text, 10);
      if (Number.isFinite(n)) return n;
    } catch {
      /* ignore */
    }
    return null;
  }
}
