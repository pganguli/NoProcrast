import api from './browser-api.js';

/**
 * Returns true if the URL is an internal extension page (blocked.html, popup,
 * options). Used to skip navigation handling for the extension's own pages.
 * @param {string} url
 * @returns {boolean}
 */
export function isExtensionPage(url) {
  return url.startsWith(api.runtime.getURL(''));
}

/**
 * Redirects a tab to blocked.html, encoding the blocked domain and the original
 * URL as query parameters so the block page can display context and redirect back
 * after a successful override.
 * @param {number} tabId
 * @param {string} hostname - The canonical config domain that triggered the block.
 * @param {string} originalUrl - The URL the user was trying to visit.
 * @returns {Promise<void>}
 */
export async function redirectTabToBlockPage(tabId, hostname, originalUrl) {
  const params = new URLSearchParams({ domain: hostname, returnTo: originalUrl });
  await api.tabs.update(tabId, { url: api.runtime.getURL('pages/blocked.html') + '?' + params });
}
