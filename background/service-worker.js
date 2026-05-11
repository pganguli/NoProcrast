import api from '../shared/browser-api.js';
import { getConfig, saveConfig, getState, saveState, clearState, getAllStateDomains } from '../shared/storage.js';
import { extractHostname, domainMatches } from '../shared/domain.js';
import { getEffectiveLimits } from '../shared/limits.js';

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
 * Returns the config domain that matches hostname, or null if not tracked.
 * @param {string} hostname
 * @param {object} config
 * @returns {string|null}
 */
function getConfigDomain(hostname, config) {
  return config.sites.find(s => domainMatches(hostname, s.domain))?.domain ?? null;
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
 * Blocks a site: resets session, records blockedAt, redirects.
 * @param {string} hostname
 * @param {number} tabId
 * @param {string} originalUrl
 * @returns {Promise<void>}
 */
async function blockSite(hostname, tabId, originalUrl) {
  await saveState(hostname, { sessionUsed: 0, visitStart: null, blockedAt: Date.now() });
  await redirectTabToBlockPage(tabId, hostname, originalUrl);
}

/**
 * Clears a block: resets state.
 * @param {string} hostname
 * @returns {Promise<void>}
 */
async function clearBlock(hostname) {
  await saveState(hostname, { sessionUsed: 0, visitStart: null, blockedAt: null });
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

  const config = await getConfig();

  // Flush previous visit
  if (previousUrl !== null) {
    const prevHostname = extractHostname(previousUrl);
    if (prevHostname) {
      const prevConfigDomain = getConfigDomain(prevHostname, config);
      if (prevConfigDomain) {
        await flushVisit(prevConfigDomain);
      }
    }
  }

  // Skip extension pages
  if (isExtensionPage(newUrl)) { return; }

  const newHostname = extractHostname(newUrl);
  if (!newHostname) { return; }

  const configDomain = getConfigDomain(newHostname, config);
  if (!configDomain) { return; }

  const state = await getState(configDomain);
  const limits = getEffectiveLimits(configDomain, config);

  // Check if currently blocked
  if (state.blockedAt !== null) {
    const elapsed = Date.now() - state.blockedAt;
    if (elapsed >= limits.minaway * 60000) {
      await clearBlock(configDomain);
      // Mirror what clearBlock wrote so we can continue without re-reading storage.
      state.sessionUsed = 0;
      state.visitStart = null;
      state.blockedAt = null;
    } else {
      await redirectTabToBlockPage(tabId, configDomain, newUrl);
      return;
    }
  }

  // Check if session exhausted
  if (state.sessionUsed >= limits.maxvisit * 60000) {
    await blockSite(configDomain, tabId, newUrl);
    return;
  }

  // Allow — record visit start
  state.visitStart = Date.now();
  await saveState(configDomain, state);
}

// ---------------------------------------------------------------------------
// Startup reconciliation
// ---------------------------------------------------------------------------

/**
 * On startup, flush any open visitStart entries and clear expired blocks.
 * @returns {Promise<void>}
 */
async function reconcileStateOnStartup() {
  const [domains, config] = await Promise.all([getAllStateDomains(), getConfig()]);
  await Promise.all(domains.map(async (domain) => {
    const state = await getState(domain);
    const limits = getEffectiveLimits(domain, config);

    if (state.visitStart !== null) {
      // Cap elapsed time at maxvisit to prevent service-worker restarts (common on
      // Android) from flushing hours of wall-clock time as fake visit time.
      const elapsed = Math.min(Date.now() - state.visitStart, limits.maxvisit * 60000);
      state.sessionUsed += elapsed;
      state.visitStart = null;
      await saveState(domain, state);
    }

    if (state.blockedAt !== null) {
      const elapsed = Date.now() - state.blockedAt;
      if (elapsed >= limits.minaway * 60000) {
        await clearBlock(domain);
      }
    }
  }));
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
      const [state, config] = await Promise.all([getState(message.domain), getConfig()]);
      const limits = getEffectiveLimits(message.domain, config);
      return { blockedAt: state.blockedAt, minaway: limits.minaway };
    }
    case 'override': {
      await clearBlock(message.domain);
      return { ok: true };
    }
    case 'getConfig': {
      return getConfig();
    }
    case 'saveConfig': {
      await saveConfig(message.config);
      return { ok: true };
    }
    case 'addSite': {
      const cfg = await getConfig();
      if (!cfg.sites.some(s => s.domain === message.domain)) {
        cfg.sites.push({ domain: message.domain });
        await saveConfig(cfg);
      }
      return { ok: true };
    }
    case 'removeSite': {
      const cfg = await getConfig();
      cfg.sites = cfg.sites.filter(s => s.domain !== message.domain);
      await saveConfig(cfg);
      await clearState(message.domain);
      return { ok: true };
    }
    case 'getAllStatus': {
      const allConfig = await getConfig();
      const states = await Promise.all(allConfig.sites.map(s => getState(s.domain)));
      return allConfig.sites.map((site, i) => {
        const lim = getEffectiveLimits(site.domain, allConfig);
        return {
          domain: site.domain,
          sessionUsed: states[i].sessionUsed,
          blockedAt: states[i].blockedAt,
          maxvisit: lim.maxvisit,
          minaway: lim.minaway,
        };
      });
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
    const configDomain = getConfigDomain(hostname, config);
    if (configDomain) {
      return flushVisit(configDomain);
    }
  }).catch(err => {
    console.error('Tab close flush error:', err);
  });
});

api.runtime.onMessage.addListener(onMessage);

reconcileStateOnStartup().catch(err => {
  console.error('Startup reconcile error:', err);
});
