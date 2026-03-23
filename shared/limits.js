import { domainMatches } from './domain.js';

/**
 * Returns the effective maxvisit/minaway limits for a hostname.
 * Per-site overrides take precedence over global defaults.
 * @param {string} hostname - The hostname to look up.
 * @param {object} config - The full config object.
 * @returns {{ maxvisit: number, minaway: number }}
 */
export function getEffectiveLimits(hostname, config) {
  const site = config.sites.find(s => domainMatches(hostname, s.domain));
  return {
    maxvisit: site?.maxvisit ?? config.global.maxvisit,
    minaway: site?.minaway ?? config.global.minaway,
  };
}
