import api from '../shared/browser-api.js';

const params = new URLSearchParams(location.search);
const domain = params.get('domain') ?? '';
const rawReturnTo = params.get('returnTo') ?? '';

/**
 * Validates the returnTo URL to prevent open-redirect abuse. Only http and https
 * schemes are accepted; anything else (e.g. javascript:, data:) falls back to
 * the domain root so the user still ends up somewhere safe after an override.
 * @param {string} url
 * @param {string} fallbackDomain
 * @returns {string}
 */
function safeReturnTo(url, fallbackDomain) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') { return url; }
  } catch (_e) {
    // fall through
  }
  return 'https://' + fallbackDomain;
}

const returnTo = safeReturnTo(rawReturnTo, domain);

document.getElementById('domain-display').textContent = domain;

/**
 * Asks the service worker for the current block status and redirects to returnTo
 * if the cooldown has already elapsed (e.g. the user left this tab open while
 * the window expired). Returns the remaining milliseconds if still blocked, or
 * undefined if a redirect was initiated.
 * @returns {Promise<number|undefined>}
 */
async function checkBlockStatus() {
  const response = await api.runtime.sendMessage({ type: 'getBlockStatus', domain });
  if (!response || response.blockedAt === null) {
    location.href = returnTo;
    return;
  }
  const remainingMs = (response.minaway * 60000) - (Date.now() - response.blockedAt);
  if (remainingMs <= 0) {
    location.href = returnTo;
    return;
  }
  return remainingMs;
}

checkBlockStatus().then(remainingMs => {
  if (remainingMs === undefined) { return; }
  const remainingMin = Math.max(0, Math.ceil(remainingMs / 60000));
  document.getElementById('remaining-display').textContent =
    'You will be able to use this site again in ' + remainingMin + ' minute' + (remainingMin === 1 ? '' : 's') + '.';
}).catch(err => {
  console.error('Failed to get block status:', err);
  document.getElementById('remaining-display').textContent = 'Could not load status.';
});

// When the user returns to this tab, re-check in case the cooldown elapsed while away.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') { return; }
  checkBlockStatus().catch(err => { console.error('Visibility check failed:', err); });
});

const OVERRIDE_DELAY = 30;
const overrideBtn = document.getElementById('override-btn');
overrideBtn.textContent = 'Override — I really need this';
let confirmed = false;

overrideBtn.addEventListener('click', () => {
  if (confirmed) {
    api.runtime.sendMessage({ type: 'override', domain }).then(() => {
      location.href = returnTo;
    }).catch(err => { console.error('Override failed:', err); });
    return;
  }

  overrideBtn.disabled = true;
  let remaining = OVERRIDE_DELAY;
  overrideBtn.textContent = 'Hold on… ' + remaining + 's';

  const countdown = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(countdown);
      confirmed = true;
      overrideBtn.disabled = false;
      overrideBtn.textContent = 'Click again to confirm override';
    } else {
      overrideBtn.textContent = 'Hold on… ' + remaining + 's';
    }
  }, 1000);
});
