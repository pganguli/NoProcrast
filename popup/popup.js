import api from '../shared/browser-api.js';
import { DOMAIN_REGEX, extractHostname } from '../shared/domain.js';

document.getElementById('settings-btn').addEventListener('click', () => {
  api.runtime.openOptionsPage();
});

const newDomainInput = document.getElementById('new-domain');
const addBtn = document.getElementById('add-btn');
const addError = document.getElementById('add-error');

api.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
  if (!tabs.length || !tabs[0].url) { return; }
  const hostname = extractHostname(tabs[0].url);
  if (hostname) { newDomainInput.value = hostname; }
}).catch(() => {});

function statusText(entry) {
  if (entry.blockedAt !== null) {
    const remainingMs = (entry.minaway * 60000) - (Date.now() - entry.blockedAt);
    const remainingMin = Math.max(0, Math.ceil(remainingMs / 60000));
    return 'Blocked for ' + remainingMin + 'm';
  }
  if (entry.sessionUsed > 0) {
    return Math.floor(entry.sessionUsed / 60000) + 'm / ' + entry.maxvisit + 'm used';
  }
  return 'Idle';
}

function buildRow(domain, text) {
  const row = document.createElement('div');
  row.className = 'site-row';
  const domainEl = document.createElement('span');
  domainEl.className = 'site-domain';
  domainEl.textContent = domain;
  const statusEl = document.createElement('span');
  statusEl.className = 'site-status';
  statusEl.textContent = text;
  row.append(domainEl, statusEl);
  return row;
}

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
    const list = document.getElementById('status-list');
    document.getElementById('empty-msg')?.remove();
    list.appendChild(buildRow(domain, 'Idle'));
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
  document.getElementById('empty-msg').remove();
  for (const entry of statuses) {
    list.appendChild(buildRow(entry.domain, statusText(entry)));
  }
}).catch(err => {
  console.error('Failed to load status:', err);
});
