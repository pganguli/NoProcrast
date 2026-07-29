import api from '../shared/browser-api.js';
import { DOMAIN_REGEX, extractHostname } from '../shared/domain.js';
import { parseOptionalInt } from '../shared/parse.js';

const IDLE_STATUS = { state: 'idle', text: 'Idle', title: 'Not currently being tracked as active' };

document.getElementById('settings-btn').addEventListener('click', () => {
  api.runtime.openOptionsPage();
});

const newDomainInput = document.getElementById('new-domain');
const addBtn = document.getElementById('add-btn');
const addError = document.getElementById('add-error');
const customizeToggle = document.getElementById('customize-toggle');
const addCustomize = document.getElementById('add-customize');
const addMaxvisitInput = document.getElementById('add-maxvisit');
const addMinawayInput = document.getElementById('add-minaway');
const addBypassTimeoutInput = document.getElementById('add-bypass-timeout');

api.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
  if (!tabs.length || !tabs[0].url) { return; }
  const hostname = extractHostname(tabs[0].url);
  if (hostname) { newDomainInput.value = hostname; }
}).catch(() => {});

function statusInfo(entry) {
  if (entry.blockedAt !== null) {
    const remainingMs = (entry.minaway * 60000) - (Date.now() - entry.blockedAt);
    const remainingMin = Math.max(0, Math.ceil(remainingMs / 60000));
    return { state: 'blocked', text: remainingMin + 'm left', title: 'Blocked — ' + remainingMin + ' minute' + (remainingMin === 1 ? '' : 's') + ' until it unblocks' };
  }
  if (entry.sessionUsed > 0) {
    const usedMin = Math.floor(entry.sessionUsed / 60000);
    return { state: 'using', text: usedMin + '/' + entry.maxvisit + 'm', title: usedMin + ' of ' + entry.maxvisit + ' minutes used this visit' };
  }
  return IDLE_STATUS;
}

function buildRow(domain, info) {
  const row = document.createElement('div');
  row.className = 'site-row';
  const domainEl = document.createElement('span');
  domainEl.className = 'site-domain';
  domainEl.textContent = domain;
  const statusEl = document.createElement('span');
  statusEl.className = 'site-status';
  statusEl.title = info.title ?? '';
  const dot = document.createElement('span');
  dot.className = 'status-dot ' + info.state;
  dot.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.textContent = info.text;
  statusEl.append(dot, label);
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
  const message = { type: 'addSite', domain };
  const maxvisit = parseOptionalInt(addMaxvisitInput.value, 0);
  const minaway = parseOptionalInt(addMinawayInput.value, 1);
  const bypassTimeout = parseOptionalInt(addBypassTimeoutInput.value, 0);
  if (maxvisit !== undefined) { message.maxvisit = maxvisit; }
  if (minaway !== undefined) { message.minaway = minaway; }
  if (bypassTimeout !== undefined) { message.bypassTimeout = bypassTimeout; }

  api.runtime.sendMessage(message).then((response) => {
    if (!response.ok) {
      addError.textContent = response.error ?? 'Failed to add site.';
      return;
    }
    newDomainInput.value = '';
    addMaxvisitInput.value = '';
    addMinawayInput.value = '';
    addBypassTimeoutInput.value = '';
    addBtn.classList.add('hidden');
    customizeToggle.classList.add('hidden');
    setCustomizeExpanded(false);
    const list = document.getElementById('status-list');
    document.getElementById('empty-msg')?.remove();
    list.appendChild(buildRow(domain, { state: 'idle', text: 'Idle', title: 'Not currently being tracked as active' }));
  }).catch(err => {
    console.error('Add site failed:', err);
    addError.textContent = 'Failed to add site.';
  });
}

function setCustomizeExpanded(expanded) {
  customizeToggle.setAttribute('aria-expanded', String(expanded));
  customizeToggle.textContent = expanded ? '▴' : '▾';
  addCustomize.classList.toggle('expanded', expanded);
  // max-height (rather than display:none) is used so the collapse can animate, but
  // that alone leaves the clipped inputs still tab-focusable — inert removes them
  // from the focus order and AT tree while collapsed.
  addCustomize.inert = !expanded;
}

customizeToggle.addEventListener('click', () => {
  setCustomizeExpanded(customizeToggle.getAttribute('aria-expanded') !== 'true');
});

// Collapse once focus leaves the customize fields entirely — e.g. clicking into a
// field and then clicking elsewhere on the page. Clicks on the toggle button itself
// are excluded so they don't race with its own click handler above (which would
// otherwise immediately re-expand what this just collapsed).
addCustomize.addEventListener('focusout', (e) => {
  if (addCustomize.contains(e.relatedTarget) || e.relatedTarget === customizeToggle) { return; }
  setCustomizeExpanded(false);
});

addBtn.addEventListener('click', addSite);
newDomainInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { addSite(); }
});
newDomainInput.addEventListener('input', () => {
  const hasText = newDomainInput.value.trim() !== '';
  addBtn.classList.toggle('hidden', !hasText);
  customizeToggle.classList.toggle('hidden', !hasText);
  if (!hasText) {
    setCustomizeExpanded(false);
    // Clearing the domain starts a fresh "add" attempt — don't leave stale custom
    // values sitting in the (now hidden) fields for a different domain to inherit.
    addMaxvisitInput.value = '';
    addMinawayInput.value = '';
    addBypassTimeoutInput.value = '';
  }
});

api.runtime.sendMessage({ type: 'getAllStatus' }).then((statuses) => {
  if (!Array.isArray(statuses) || statuses.length === 0) { return; }
  const list = document.getElementById('status-list');
  document.getElementById('empty-msg').remove();
  for (const entry of statuses) {
    list.appendChild(buildRow(entry.domain, statusInfo(entry)));
  }
}).catch(err => {
  console.error('Failed to load status:', err);
});
