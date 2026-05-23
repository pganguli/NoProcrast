import api from '../shared/browser-api.js';

const params = new URLSearchParams(location.search);
const domain = params.get('domain') ?? '';
const rawReturnTo = params.get('returnTo') ?? '';

// Only http/https are safe redirect targets; anything else (e.g. javascript:) falls back to the domain root.
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

async function checkBlockStatus() {
  const response = await api.runtime.sendMessage({ type: 'getBlockStatus', domain });
  if (!response || response.blockedAt === null) {
    location.replace(returnTo);
    return;
  }
  const remainingMs = (response.minaway * 60000) - (Date.now() - response.blockedAt);
  if (remainingMs <= 0) {
    location.replace(returnTo);
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

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') { return; }
  checkBlockStatus().catch(err => { console.error('Visibility check failed:', err); });
});

const OVERRIDE_DELAY = 30;

const overrideBtn = document.getElementById('override-btn');
const justifySection = document.getElementById('justify-section');
const justifyInput = document.getElementById('justify-input');
const startCountdownBtn = document.getElementById('start-countdown-btn');
const countdownSection = document.getElementById('countdown-section');
const countdownText = document.getElementById('countdown-text');
const pauseNotice = document.getElementById('pause-notice');

overrideBtn.addEventListener('click', () => {
  overrideBtn.disabled = true;
  overrideBtn.setAttribute('aria-expanded', 'true');
  justifySection.classList.remove('hidden');
  justifyInput.focus();
});

justifyInput.addEventListener('input', () => {
  startCountdownBtn.disabled = justifyInput.value.trim().length === 0;
});

startCountdownBtn.addEventListener('click', () => {
  justifySection.classList.add('hidden');
  countdownSection.classList.remove('hidden');
  runCountdown();
});

function runCountdown() {
  let remaining = OVERRIDE_DELAY;
  let active = true;

  function setActive(on) {
    active = on;
    pauseNotice.classList.toggle('hidden', on);
  }

  countdownText.textContent = 'Hold on… ' + remaining + 's';

  const interval = setInterval(() => {
    if (!active) { return; }
    remaining -= 1;
    countdownText.textContent = 'Hold on… ' + remaining + 's';
    if (remaining <= 0) {
      clearInterval(interval);
      window.removeEventListener('blur', checkFocus);
      window.removeEventListener('focus', checkFocus);
      document.removeEventListener('visibilitychange', checkFocus);
      api.runtime.sendMessage({ type: 'override', domain }).then(() => {
        location.replace(returnTo);
      }).catch(err => { console.error('Override failed:', err); });
    }
  }, 1000);

  function checkFocus() { setActive(document.visibilityState === 'visible' && document.hasFocus()); }

  window.addEventListener('blur', checkFocus);
  window.addEventListener('focus', checkFocus);
  document.addEventListener('visibilitychange', checkFocus);
}
