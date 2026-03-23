import api from '../shared/browser-api.js';

const DOMAIN_REGEX = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

document.getElementById('settings-btn').addEventListener('click', () => {
  api.runtime.openOptionsPage();
});

const newDomainInput = document.getElementById('new-domain');
const addBtn = document.getElementById('add-btn');
const addError = document.getElementById('add-error');

// Pre-fill input with the current tab's hostname
api.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
  if (!tabs.length || !tabs[0].url) { return; }
  try {
    const hostname = new URL(tabs[0].url).hostname;
    if (hostname) { newDomainInput.value = hostname; }
  } catch (_e) { /* ignore non-parseable URLs */ }
}).catch(() => { /* ignore */ });

function addSite() {
  const domain = newDomainInput.value.trim().toLowerCase();
  addError.textContent = '';
  if (!DOMAIN_REGEX.test(domain)) {
    addError.textContent = 'Invalid domain.';
    return;
  }
  const existing = document.querySelectorAll('.site-domain');
  for (const el of existing) {
    if (el.textContent === domain) {
      addError.textContent = 'Already in list.';
      return;
    }
  }
  api.runtime.sendMessage({ type: 'addSite', domain }).then(() => {
    newDomainInput.value = '';
    // Append the new site as Idle without reloading the whole list
    const list = document.getElementById('status-list');
    const emptyMsg = document.getElementById('empty-msg');
    if (emptyMsg) { emptyMsg.remove(); }
    const row = document.createElement('div');
    row.className = 'site-row';
    const domainEl = document.createElement('span');
    domainEl.className = 'site-domain';
    domainEl.textContent = domain;
    const statusEl = document.createElement('span');
    statusEl.className = 'site-status';
    statusEl.textContent = 'Idle';
    row.appendChild(domainEl);
    row.appendChild(statusEl);
    list.appendChild(row);
  }).catch(err => {
    console.error('Add site failed:', err);
    addError.textContent = 'Failed to add site.';
  });
}

addBtn.addEventListener('click', addSite);
newDomainInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { addSite(); }
});

api.runtime.sendMessage({ type: 'getAllStatus' }).then((statuses) => {
  if (!Array.isArray(statuses) || statuses.length === 0) { return; }

  const list = document.getElementById('status-list');
  const emptyMsg = document.getElementById('empty-msg');
  emptyMsg.remove();

  for (const entry of statuses) {
    const row = document.createElement('div');
    row.className = 'site-row';

    const domainEl = document.createElement('span');
    domainEl.className = 'site-domain';
    domainEl.textContent = entry.domain;

    const statusEl = document.createElement('span');
    statusEl.className = 'site-status';

    if (entry.blockedAt !== null) {
      const remainingMs = (entry.minaway * 60000) - (Date.now() - entry.blockedAt);
      const remainingMin = Math.max(0, Math.ceil(remainingMs / 60000));
      statusEl.textContent = 'Blocked — ' + remainingMin + 'm remaining';
      statusEl.classList.add('blocked');
    } else if (entry.sessionUsed > 0) {
      const usedMin = Math.ceil(entry.sessionUsed / 60000);
      const allowedMin = entry.maxvisit;
      statusEl.textContent = usedMin + 'm used / ' + allowedMin + 'm allowed';
      statusEl.classList.add('active');
    } else {
      statusEl.textContent = 'Idle';
    }

    row.appendChild(domainEl);
    row.appendChild(statusEl);
    list.appendChild(row);
  }
}).catch(err => {
  console.error('Failed to load status:', err);
});
