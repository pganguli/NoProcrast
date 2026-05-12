/**
 * Extracts the hostname from a URL string using the URL API.
 * Returns an empty string for non-parseable URLs (e.g. "about:blank", "chrome://").
 * @param {string} url
 * @returns {string}
 */
export function extractHostname(url) {
  try {
    return new URL(url).hostname;
  } catch (_e) {
    return '';
  }
}

/**
 * Returns true if hostname is, or is a subdomain of, configDomain.
 * The dot-prefix check ("." + configDomain) prevents "evilreddit.com" from
 * matching a config entry for "reddit.com".
 * @param {string} hostname - Actual hostname from the browser (e.g. "old.reddit.com").
 * @param {string} configDomain - Entry from the block list (e.g. "reddit.com").
 * @returns {boolean}
 */
export function domainMatches(hostname, configDomain) {
  return hostname === configDomain || hostname.endsWith('.' + configDomain);
}

/**
 * Finds the canonical config domain for a given hostname, or null if the hostname
 * is not tracked. The returned value is the domain string from config.sites (e.g.
 * "reddit.com"), not the full hostname — callers should use this as the storage key.
 * @param {string} hostname
 * @param {{ sites: Array<{ domain: string }> }} config
 * @returns {string|null}
 */
export function getConfigDomain(hostname, config) {
  return config.sites.find(s => domainMatches(hostname, s.domain))?.domain ?? null;
}
