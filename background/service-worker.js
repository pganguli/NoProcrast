import api from '../shared/browser-api.js';
import { getConfig, saveConfig, getState, saveState, clearState, getAllStateDomains } from '../shared/storage.js';
import { extractHostname, domainMatches } from '../shared/domain.js';
import { getEffectiveLimits } from '../shared/limits.js';

const ALARM_PREFIX = 'unblock:';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the URL belongs to the extension itself.
 * @param {string} url
 * @returns {boolean}
 */
function isExtensionPage(url) {
  return url.startsWith(api.runtime.getURL(''));
}

/**
 * Returns true if hostname matches any configured site.
 * @param {string} hostname
 * @param {object} config
 * @returns {boolean}
 */
function isTracked(hostname, config) {
  return config.sites.some(s => domainMatches(hostname, s.domain));
}

/**
 * Redirects a tab to the block page.
 * @param {number} tabId
 * @param {string} hostname
 * @param {string} originalUrl
 * @returns {Promise<void>}
 */
async function redirectTabToBlockPage(tabId, hostname, originalUrl) {
  const params = new URLSearchParams({ domain: hostname, returnTo: originalUrl });
  const blockUrl = api.runtime.getURL('pages/blocked.html') + '?' + params.toString();
  await api.tabs.update(tabId, { url: blockUrl });
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

/**
 * Flushes an open visitStart for hostname into sessionUsed.
 * @param {string} hostname
 * @returns {Promise<void>}
 */
async function flushVisit(hostname) {
  const state = await getState(hostname);
  if (state.visitStart === null) { return; }
  const elapsed = Date.now() - state.visitStart;
  state.sessionUsed += elapsed;
  state.visitStart = null;
  await saveState(hostname, state);
}

/**
 * Blocks a site: resets session, records blockedAt, schedules alarm, redirects.
 * @param {string} hostname
 * @param {number} tabId
 * @param {string} originalUrl
 * @returns {Promise<void>}
 */
async function blockSite(hostname, tabId, originalUrl) {
  await saveState(hostname, { sessionUsed: 0, visitStart: null, blockedAt: Date.now() });
  await scheduleUnblockAlarm(hostname);
  await redirectTabToBlockPage(tabId, hostname, originalUrl);
}

/**
 * Clears a block: resets state and cancels the alarm.
 * @param {string} hostname
 * @returns {Promise<void>}
 */
async function clearBlock(hostname) {
  await saveState(hostname, { sessionUsed: 0, visitStart: null, blockedAt: null });
  await api.alarms.clear(ALARM_PREFIX + hostname);
}

/**
 * Schedules the unblock alarm for hostname.
 * @param {string} hostname
 * @returns {Promise<void>}
 */
async function scheduleUnblockAlarm(hostname) {
  const config = await getConfig();
  const limits = getEffectiveLimits(hostname, config);
  await api.alarms.create(ALARM_PREFIX + hostname, { delayInMinutes: limits.minaway });
}

/**
 * Resets session without setting blockedAt (override flow).
 * @param {string} hostname
 * @returns {Promise<void>}
 */
async function handleOverride(hostname) {
  await saveState(hostname, { sessionUsed: 0, visitStart: null, blockedAt: null });
  await api.alarms.clear(ALARM_PREFIX + hostname);
}

// ---------------------------------------------------------------------------
// Navigation handler
// ---------------------------------------------------------------------------

/** @type {Map<number, string>} tabId -> last known URL */
const tabUrls = new Map();

/**
 * Handles a navigation event for a top-level frame.
 * @param {number} tabId
 * @param {string} newUrl
 * @returns {Promise<void>}
 */
async function handleNavigation(tabId, newUrl) {
  const previousUrl = tabUrls.get(tabId) ?? null;
  tabUrls.set(tabId, newUrl);

  // Flush previous visit
  if (previousUrl !== null) {
    const prevHostname = extractHostname(previousUrl);
    const prevConfig = await getConfig();
    if (prevHostname && isTracked(prevHostname, prevConfig)) {
      await flushVisit(prevHostname);
    }
  }

  // Skip extension pages
  if (isExtensionPage(newUrl)) { return; }

  const newHostname = extractHostname(newUrl);
  if (!newHostname) { return; }

  const config = await getConfig();
  if (!isTracked(newHostname, config)) { return; }

  const state = await getState(newHostname);
  const limits = getEffectiveLimits(newHostname, config);

  // Check if currently blocked
  if (state.blockedAt !== null) {
    const elapsed = Date.now() - state.blockedAt;
    if (elapsed >= limits.minaway * 60000) {
      await clearBlock(newHostname);
    } else {
      await redirectTabToBlockPage(tabId, newHostname, newUrl);
      return;
    }
  }

  // Re-read state after potential clearBlock
  const freshState = await getState(newHostname);
  const freshLimits = getEffectiveLimits(newHostname, config);

  // Check if session exhausted
  if (freshState.sessionUsed >= freshLimits.maxvisit * 60000) {
    await blockSite(newHostname, tabId, newUrl);
    return;
  }

  // Allow — record visit start
  freshState.visitStart = Date.now();
  await saveState(newHostname, freshState);
}

// ---------------------------------------------------------------------------
// Startup reconciliation
// ---------------------------------------------------------------------------

/**
 * On startup, flush any open visitStart entries and clear expired blocks.
 * @returns {Promise<void>}
 */
async function reconcileStateOnStartup() {
  const domains = await getAllStateDomains();
  const config = await getConfig();
  for (const domain of domains) {
    const state = await getState(domain);

    if (state.visitStart !== null) {
      await flushVisit(domain);
    }

    if (state.blockedAt !== null) {
      const limits = getEffectiveLimits(domain, config);
      const elapsed = Date.now() - state.blockedAt;
      if (elapsed >= limits.minaway * 60000) {
        await clearBlock(domain);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

/**
 * Handles runtime messages from page scripts.
 * @param {object} message
 * @param {object} _sender
 * @param {Function} sendResponse
 * @returns {boolean} true to keep channel open for async response
 */
function onMessage(message, _sender, sendResponse) {
  const handle = async () => {
    switch (message.type) {
    case 'getBlockStatus': {
      const state = await getState(message.domain);
      const config = await getConfig();
      const limits = getEffectiveLimits(message.domain, config);
      return { blockedAt: state.blockedAt, minaway: limits.minaway };
    }
    case 'override': {
      await handleOverride(message.domain);
      return { ok: true };
    }
    case 'getConfig': {
      return await getConfig();
    }
    case 'saveConfig': {
      await saveConfig(message.config);
      return { ok: true };
    }
    case 'removeSite': {
      const cfg = await getConfig();
      cfg.sites = cfg.sites.filter(s => s.domain !== message.domain);
      await saveConfig(cfg);
      await clearState(message.domain);
      await api.alarms.clear(ALARM_PREFIX + message.domain);
      return { ok: true };
    }
    case 'getAllStatus': {
      const allConfig = await getConfig();
      const results = [];
      for (const site of allConfig.sites) {
        const st = await getState(site.domain);
        const lim = getEffectiveLimits(site.domain, allConfig);
        results.push({
          domain: site.domain,
          sessionUsed: st.sessionUsed,
          blockedAt: st.blockedAt,
          maxvisit: lim.maxvisit,
          minaway: lim.minaway,
        });
      }
      return results;
    }
    default:
      return { error: 'unknown message type' };
    }
  };

  handle().then(sendResponse).catch(err => {
    console.error('Message handler error:', err);
    sendResponse({ error: String(err) });
  });

  return true; // keep channel open
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

api.webNavigation.onCommitted.addListener(
  (details) => {
    if (details.frameId !== 0) { return; }
    handleNavigation(details.tabId, details.url).catch(err => {
      console.error('Navigation handler error:', err);
    });
  }
);

api.tabs.onRemoved.addListener((tabId) => {
  const url = tabUrls.get(tabId);
  tabUrls.delete(tabId);
  if (!url) { return; }
  const hostname = extractHostname(url);
  if (!hostname) { return; }
  getConfig().then(config => {
    if (isTracked(hostname, config)) {
      return flushVisit(hostname);
    }
  }).catch(err => {
    console.error('Tab close flush error:', err);
  });
});

api.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(ALARM_PREFIX)) { return; }
  const hostname = alarm.name.slice(ALARM_PREFIX.length);
  clearBlock(hostname).catch(err => {
    console.error('Alarm handler error:', err);
  });
});

api.runtime.onMessage.addListener(onMessage);

api.runtime.onInstalled.addListener(() => {
  reconcileStateOnStartup().catch(err => {
    console.error('Startup reconcile error:', err);
  });
});

reconcileStateOnStartup().catch(err => {
  console.error('Startup reconcile error:', err);
});
