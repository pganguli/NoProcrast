import api from './browser-api.js';

const DEFAULT_CONFIG = {
  global: { maxvisit: 20, minaway: 180 },
  sites: [],
};

const DEFAULT_STATE = {
  sessionUsed: 0,
  visitStart: null,
  blockedAt: null,
};

/**
 * Validates that a config object has the correct shape; returns true if valid.
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
 * Validates that a state object has the correct shape; returns true if valid.
 * @param {unknown} state
 * @returns {boolean}
 */
function isValidState(state) {
  return (
    state !== null &&
    typeof state === 'object' &&
    typeof state.sessionUsed === 'number' &&
    (state.visitStart === null || typeof state.visitStart === 'number') &&
    (state.blockedAt === null || typeof state.blockedAt === 'number')
  );
}

/**
 * Reads the config from storage, initialising any missing fields from defaults.
 * @returns {Promise<object>}
 */
export async function getConfig() {
  const result = await api.storage.local.get('config');
  const raw = result.config;
  if (!isValidConfig(raw)) {
    return structuredClone(DEFAULT_CONFIG);
  }
  return {
    global: {
      maxvisit: typeof raw.global.maxvisit === 'number' ? raw.global.maxvisit : DEFAULT_CONFIG.global.maxvisit,
      minaway: typeof raw.global.minaway === 'number' ? raw.global.minaway : DEFAULT_CONFIG.global.minaway,
    },
    sites: raw.sites,
  };
}

/**
 * Saves the config object to storage.
 * @param {object} config
 * @returns {Promise<void>}
 */
export async function saveConfig(config) {
  await api.storage.local.set({ config });
}

/**
 * Reads per-domain state from storage.
 * @param {string} domain
 * @returns {Promise<object>}
 */
export async function getState(domain) {
  const key = 'state:' + domain;
  const result = await api.storage.local.get(key);
  const raw = result[key];
  if (!isValidState(raw)) {
    return structuredClone(DEFAULT_STATE);
  }
  return raw;
}

/**
 * Saves per-domain state to storage.
 * @param {string} domain
 * @param {object} state
 * @returns {Promise<void>}
 */
export async function saveState(domain, state) {
  const key = 'state:' + domain;
  await api.storage.local.set({ [key]: state });
}

/**
 * Removes per-domain state from storage.
 * @param {string} domain
 * @returns {Promise<void>}
 */
export async function clearState(domain) {
  const key = 'state:' + domain;
  await api.storage.local.remove(key);
}

/**
 * Returns all domain keys that have stored state.
 * @returns {Promise<string[]>}
 */
export async function getAllStateDomains() {
  const all = await api.storage.local.get(null);
  return Object.keys(all)
    .filter(k => k.startsWith('state:'))
    .map(k => k.slice('state:'.length));
}
