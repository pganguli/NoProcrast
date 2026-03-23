/**
 * Extracts the hostname from a URL string.
 * @param {string} url - The full URL.
 * @returns {string} The hostname, or empty string on failure.
 */
export function extractHostname(url) {
  try {
    return new URL(url).hostname;
  } catch (_e) {
    return '';
  }
}

/**
 * Returns true if hostname matches configDomain or is a subdomain of it.
 * @param {string} hostname - The hostname to test.
 * @param {string} configDomain - The domain from config.
 * @returns {boolean}
 */
export function domainMatches(hostname, configDomain) {
  return hostname === configDomain || hostname.endsWith('.' + configDomain);
}
