import api from '../shared/browser-api.js';

const params = new URLSearchParams(location.search);
const domain = params.get('domain') ?? '';
const rawReturnTo = params.get('returnTo') ?? '';

/**
 * Validates returnTo URL — only http/https allowed.
 * @param {string} url
 * @param {string} fallbackDomain
 * @returns {string}
 */
function safeReturnTo(url, fallbackDomain) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return url;
    }
  } catch (_e) {
    // fall through
  }
  return 'https://' + fallbackDomain;
}

const returnTo = safeReturnTo(rawReturnTo, domain);

// Display domain
document.getElementById('domain-display').textContent = domain;

// Fetch block status from service worker
api.runtime.sendMessage({ type: 'getBlockStatus', domain }).then((response) => {
  if (!response || response.blockedAt === null) {
    document.getElementById('remaining-display').textContent = 'This site is no longer blocked.';
    return;
  }
  const remainingMs = (response.minaway * 60000) - (Date.now() - response.blockedAt);
  const remainingMin = Math.max(0, Math.ceil(remainingMs / 60000));
  document.getElementById('remaining-display').textContent =
    'You will be able to use this site again in ' + remainingMin + ' minute' + (remainingMin === 1 ? '' : 's') + '.';
}).catch(err => {
  console.error('Failed to get block status:', err);
  document.getElementById('remaining-display').textContent = 'Could not load status.';
});

// Override button — two-click confirm
let confirmPending = false;
const overrideBtn = document.getElementById('override-btn');

overrideBtn.addEventListener('click', () => {
  if (!confirmPending) {
    confirmPending = true;
    overrideBtn.textContent = 'Are you sure? Click again to confirm.';
    return;
  }
  api.runtime.sendMessage({ type: 'override', domain }).then(() => {
    location.href = returnTo;
  }).catch(err => {
    console.error('Override failed:', err);
  });
});
