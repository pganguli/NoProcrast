import { domainMatches } from './domain.js';

/**
 * Returns the effective time limits for a hostname. Per-site overrides in
 * config.sites take precedence; unset fields fall back to config.global defaults.
 * Note: hostname is matched against config domains (not the other way around),
 * so subdomains inherit the parent domain's overrides.
 * @param {string} hostname - Actual hostname (e.g. "old.reddit.com").
 * @param {{ global: { maxvisit: number, minaway: number }, sites: Array }} config
 * @returns {{ maxvisit: number, minaway: number }} Limits in minutes.
 */
export function getEffectiveLimits(hostname, config) {
  const site = config.sites.find(s => domainMatches(hostname, s.domain));
  return {
    maxvisit: site?.maxvisit ?? config.global.maxvisit,
    minaway: site?.minaway ?? config.global.minaway,
  };
}
