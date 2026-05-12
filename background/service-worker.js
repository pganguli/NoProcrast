import api from '../shared/browser-api.js';
import { getConfig, saveConfig, getState, saveState, clearState, getAllStateDomains } from '../shared/storage.js';
import { extractHostname, getConfigDomain } from '../shared/domain.js';
import { getEffectiveLimits } from '../shared/limits.js';
import { isExtensionPage, redirectTabToBlockPage } from '../shared/navigation.js';

/**
 * Core navigation handler — called on every top-level frame commit.
 *
 * Implements the session-window model: each tracked domain gets a wall-clock
 * window of maxvisit minutes from first visit. Once exhausted the user enters a
 * minaway-minute cooldown. After the full maxvisit+minaway window elapses the
 * session resets automatically.
 *
 * State transitions by elapsed time since sessionStart:
 *   null                             → first visit; start a new session window
 *   elapsed < maxvisit               → within the allowed window; allow
 *   elapsed in [maxvisit, +minaway)  → in cooldown; redirect to block page
 *   elapsed >= maxvisit + minaway    → cooldown over; start a fresh session window
 *
 * @param {number} tabId
 * @param {string} url - Fully-qualified URL of the newly committed page.
 * @returns {Promise<void>}
 */
async function handleNavigation(tabId, url) {
  if (isExtensionPage(url)) { return; }

  const hostname = extractHostname(url);
  if (!hostname) { return; }

  const config = await getConfig();
  const configDomain = getConfigDomain(hostname, config);
  if (!configDomain) { return; }

  const state = await getState(configDomain);
  const limits = getEffectiveLimits(configDomain, config);
  const now = Date.now();

  if (state.sessionStart === null) {
    await saveState(configDomain, { sessionStart: now });
    return;
  }

  const elapsed = now - state.sessionStart;
  const maxMs = limits.maxvisit * 60000;
  const cooldownMs = limits.minaway * 60000;

  if (elapsed < maxMs) { return; }

  if (elapsed >= maxMs + cooldownMs) {
    await saveState(configDomain, { sessionStart: now });
    return;
  }

  await redirectTabToBlockPage(tabId, configDomain, url);
}

/**
 * Runs at service-worker startup to clean up stale state left by a previous
 * browser session. If the browser was closed while a domain's full
 * maxvisit+minaway window had already elapsed, the sessionStart is reset to
 * null so the next visit starts a fresh window rather than blocking immediately.
 * @returns {Promise<void>}
 */
async function reconcileStateOnStartup() {
  const [domains, config] = await Promise.all([getAllStateDomains(), getConfig()]);
  await Promise.all(domains.map(async (domain) => {
    const state = await getState(domain);
    if (state.sessionStart === null) { return; }
    const limits = getEffectiveLimits(domain, config);
    if (Date.now() - state.sessionStart >= (limits.maxvisit + limits.minaway) * 60000) {
      await saveState(domain, { sessionStart: null });
    }
  }));
}

/**
 * Handles all runtime messages sent by page scripts (blocked.html, popup, options).
 * Returns a plain object that is forwarded back to the caller as the response.
 *
 * Supported message types:
 *   getBlockStatus  { domain }         → { blockedAt: number|null, minaway: number }
 *   override        { domain }         → { ok: true }  (grants a fresh maxvisit window)
 *   getConfig       —                  → config object
 *   saveConfig      { config }         → { ok: true }
 *   addSite         { domain }         → { ok: true }  (no-op if already present)
 *   removeSite      { domain }         → { ok: true }  (also clears state)
 *   getAllStatus     —                  → Array<{ domain, blockedAt, sessionUsed, maxvisit, minaway }>
 *
 * @param {{ type: string, [key: string]: unknown }} message
 * @returns {Promise<object>}
 */
async function handleMessage(message) {
  switch (message.type) {
  case 'getBlockStatus': {
    const [state, config] = await Promise.all([getState(message.domain), getConfig()]);
    const limits = getEffectiveLimits(message.domain, config);
    if (state.sessionStart === null) {
      return { blockedAt: null, minaway: limits.minaway };
    }
    const elapsed = Date.now() - state.sessionStart;
    const maxMs = limits.maxvisit * 60000;
    if (elapsed < maxMs || elapsed >= maxMs + limits.minaway * 60000) {
      return { blockedAt: null, minaway: limits.minaway };
    }
    return { blockedAt: state.sessionStart + maxMs, minaway: limits.minaway };
  }
  case 'override':
    await saveState(message.domain, { sessionStart: Date.now() });
    return { ok: true };
  case 'getConfig':
    return getConfig();
  case 'saveConfig':
    await saveConfig(message.config);
    return { ok: true };
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
    const now = Date.now();
    const states = await Promise.all(allConfig.sites.map(s => getState(s.domain)));
    return allConfig.sites.map((site, i) => {
      const lim = getEffectiveLimits(site.domain, allConfig);
      const { sessionStart } = states[i];
      const maxMs = lim.maxvisit * 60000;
      if (sessionStart === null) {
        return { domain: site.domain, blockedAt: null, sessionUsed: 0, maxvisit: lim.maxvisit, minaway: lim.minaway };
      }
      const elapsed = now - sessionStart;
      if (elapsed < maxMs) {
        return { domain: site.domain, blockedAt: null, sessionUsed: elapsed, maxvisit: lim.maxvisit, minaway: lim.minaway };
      }
      if (elapsed >= maxMs + lim.minaway * 60000) {
        return { domain: site.domain, blockedAt: null, sessionUsed: 0, maxvisit: lim.maxvisit, minaway: lim.minaway };
      }
      return { domain: site.domain, blockedAt: sessionStart + maxMs, sessionUsed: maxMs, maxvisit: lim.maxvisit, minaway: lim.minaway };
    });
  }
  default:
    return { error: 'unknown message type' };
  }
}

api.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) { return; }
  handleNavigation(details.tabId, details.url).catch(err => {
    console.error('Navigation handler error:', err);
  });
});

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch(err => {
    console.error('Message handler error:', err);
    sendResponse({ error: String(err) });
  });
  return true; // keep channel open for async response
});

reconcileStateOnStartup().catch(err => {
  console.error('Startup reconcile error:', err);
});
