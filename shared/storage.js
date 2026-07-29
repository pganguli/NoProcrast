import api from './browser-api.js';

const DEFAULT_CONFIG = {
  global: { maxvisit: 20, minaway: 180, bypassTimeout: 60 },
  sites: [],
};

const DEFAULT_STATE = {
  sessionStart: null,
};

/**
 * Guards against malformed data in storage (e.g. after a schema migration or
 * manual edit). Returns true only if all required fields are present and typed.
 * @param {unknown} config
 * @returns {boolean}
 */
function isValidConfig(config) {
  return (
    config !== null &&
    typeof config === 'object' &&
    typeof config.global === 'object' &&
    typeof config.global.maxvisit === 'number' &&
    typeof config.global.minaway === 'number' &&
    Array.isArray(config.sites)
  );
}

/**
 * Guards against malformed per-domain state in storage. sessionStart must be
 * either null (no active session) or a Unix-millisecond timestamp.
 * @param {unknown} state
 * @returns {boolean}
 */
function isValidState(state) {
  return (
    state !== null &&
    typeof state === 'object' &&
    (state.sessionStart === null || typeof state.sessionStart === 'number')
  );
}

/**
 * Clamps global limits to their valid ranges. minaway must be at least 1 (a
 * zero/negative cooldown breaks the block logic). maxvisit and bypassTimeout
 * may be 0 (deliberately: 0 maxvisit blocks indefinitely, 0 bypassTimeout
 * disables overrides for that scope).
 * @param {object} global
 * @returns {{ maxvisit: number, minaway: number, bypassTimeout: number }}
 */
function clampGlobal(global) {
  return {
    maxvisit: Math.max(0, Number(global.maxvisit) || 0),
    minaway: Math.max(1, Number(global.minaway) || 1),
    bypassTimeout: Math.max(0, Number(global.bypassTimeout) || 0),
  };
}

/**
 * Clamps a per-site override to the same valid ranges as clampGlobal, leaving
 * fields that are absent (i.e. inheriting the global default) untouched.
 * @param {{ domain: string, maxvisit?: number, minaway?: number, bypassTimeout?: number }} site
 * @returns {{ domain: string, maxvisit?: number, minaway?: number, bypassTimeout?: number }}
 */
function clampSite(site) {
  const clamped = { domain: site.domain };
  if (site.maxvisit !== undefined) { clamped.maxvisit = Math.max(0, Number(site.maxvisit) || 0); }
  if (site.minaway !== undefined) { clamped.minaway = Math.max(1, Number(site.minaway) || 1); }
  if (site.bypassTimeout !== undefined) { clamped.bypassTimeout = Math.max(0, Number(site.bypassTimeout) || 0); }
  return clamped;
}

/**
 * Reads the extension config from storage.local. Falls back to DEFAULT_CONFIG
 * if the stored value is missing or fails validation. Numeric fields are
 * clamped to their valid ranges so a hand-edited or corrupted value (e.g.
 * minaway: 0) can't silently invert the block-indefinitely behavior.
 * @returns {Promise<{ global: { maxvisit: number, minaway: number }, sites: Array }>}
 */
export async function getConfig() {
  const { config } = await api.storage.local.get('config');
  const base = isValidConfig(config) ? config : structuredClone(DEFAULT_CONFIG);
  // Merge global defaults so fields added in later versions don't invalidate old configs.
  return {
    ...base,
    global: clampGlobal({ ...DEFAULT_CONFIG.global, ...base.global }),
    sites: base.sites.map(clampSite),
  };
}

/**
 * Persists the full config object to storage.local, overwriting the previous value.
 * @param {{ global: { maxvisit: number, minaway: number }, sites: Array }} config
 * @returns {Promise<void>}
 */
export async function saveConfig(config) {
  await api.storage.local.set({ config });
}

/**
 * Reads per-domain session state from storage.local (key: "state:<domain>").
 * Falls back to DEFAULT_STATE if missing or invalid.
 * @param {string} domain - The canonical config domain (e.g. "reddit.com").
 * @returns {Promise<{ sessionStart: number|null }>}
 */
export async function getState(domain) {
  const key = 'state:' + domain;
  const result = await api.storage.local.get(key);
  const base = isValidState(result[key]) ? result[key] : structuredClone(DEFAULT_STATE);
  // Merge defaults so fields added in later versions don't invalidate old state.
  return { ...DEFAULT_STATE, ...base };
}

/**
 * Writes per-domain session state to storage.local (key: "state:<domain>").
 * @param {string} domain - The canonical config domain (e.g. "reddit.com").
 * @param {{ sessionStart: number|null }} state
 * @returns {Promise<void>}
 */
export async function saveState(domain, state) {
  await api.storage.local.set({ ['state:' + domain]: state });
}

/**
 * Removes per-domain session state from storage.local. Called when a site is
 * removed from the block list so no stale state lingers.
 * @param {string} domain
 * @returns {Promise<void>}
 */
export async function clearState(domain) {
  await api.storage.local.remove('state:' + domain);
}

/**
 * Returns all domains that currently have stored state, by scanning storage.local
 * for keys with the "state:" prefix. Used at startup to reconcile stale sessions.
 * @returns {Promise<string[]>}
 */
export async function getAllStateDomains() {
  const all = await api.storage.local.get(null);
  return Object.keys(all)
    .filter(k => k.startsWith('state:'))
    .map(k => k.slice('state:'.length));
}
