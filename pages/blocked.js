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

// Override button — first click starts a 30s countdown; second click (after countdown) confirms
const OVERRIDE_DELAY = 30;
const overrideBtn = document.getElementById('override-btn');
overrideBtn.textContent = 'Override \u2014 I really need this';
let confirmed = false;

overrideBtn.addEventListener('click', () => {
  if (confirmed) {
    api.runtime.sendMessage({ type: 'override', domain }).then(() => {
      location.href = returnTo;
    }).catch(err => {
      console.error('Override failed:', err);
    });
    return;
  }

  // First click: start countdown
  overrideBtn.disabled = true;
  let remaining = OVERRIDE_DELAY;
  overrideBtn.textContent = 'Hold on\u2026 ' + remaining + 's';

  const countdown = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(countdown);
      confirmed = true;
      overrideBtn.disabled = false;
      overrideBtn.textContent = 'Click again to confirm override';
    } else {
      overrideBtn.textContent = 'Hold on\u2026 ' + remaining + 's';
    }
  }, 1000);
});
