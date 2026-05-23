import api from '../shared/browser-api.js';

const DOMAIN_REGEX = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

let currentConfig = null;

const globalMaxvisitInput = document.getElementById('global-maxvisit');
const globalMinawayInput = document.getElementById('global-minaway');
const savedMsg = document.getElementById('saved-msg');
const sitesTbody = document.getElementById('sites-tbody');
const newDomainInput = document.getElementById('new-domain');
const addBtn = document.getElementById('add-btn');
const domainError = document.getElementById('domain-error');

// Unlock gate
const unlockCode = String(1000 + Math.floor(Math.random() * 9000));
document.getElementById('unlock-label').innerHTML = 'Type <strong>' + unlockCode + '</strong> to edit settings:';
const unlockInput = document.getElementById('unlock-input');
const unlockError = document.getElementById('unlock-error');

let isLocked = true;

function setLocked(locked) {
  isLocked = locked;
  for (const el of document.querySelectorAll('input, button')) {
    if (el === unlockInput || el.id === 'new-domain' || el.id === 'add-btn') { continue; }
    el.disabled = locked;
  }
  document.body.classList.toggle('locked', locked);
  if (!locked) {
    document.getElementById('unlock-section').style.display = 'none';
    globalMaxvisitInput.focus();
  }
}

setLocked(true);

unlockInput.addEventListener('input', () => {
  if (unlockInput.value === unlockCode) {
    unlockError.textContent = '';
    setLocked(false);
  } else if (unlockInput.value.length === 4) {
    unlockError.textContent = 'Incorrect.';
    unlockInput.value = '';
  }
});

async function loadConfig() {
  currentConfig = await api.runtime.sendMessage({ type: 'getConfig' });
  globalMaxvisitInput.value = currentConfig.global.maxvisit;
  globalMinawayInput.value = currentConfig.global.minaway;
  renderSites();
}

function renderSites() {
  sitesTbody.replaceChildren(...currentConfig.sites.map(buildSiteRow));
  setLocked(isLocked);
}

function buildNumberInput(value, label, onChange) {
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '1';
  input.placeholder = 'default';
  input.setAttribute('aria-label', label);
  if (value !== undefined) { input.value = String(value); }
  input.addEventListener('blur', () => {
    const val = input.value.trim();
    onChange(val === '' ? undefined : Math.max(1, parseInt(val, 10)));
    saveConfig();
  });
  return input;
}

function buildSiteRow(site) {
  const tr = document.createElement('tr');

  const tdDomain = document.createElement('td');
  tdDomain.textContent = site.domain;

  const tdMaxvisit = document.createElement('td');
  tdMaxvisit.appendChild(buildNumberInput(site.maxvisit, 'Max visit for ' + site.domain, v => { site.maxvisit = v; }));

  const tdMinaway = document.createElement('td');
  tdMinaway.appendChild(buildNumberInput(site.minaway, 'Min away for ' + site.domain, v => { site.minaway = v; }));

  const removeBtn = document.createElement('button');
  removeBtn.className = 'remove-btn';
  removeBtn.textContent = 'Remove';
  removeBtn.setAttribute('aria-label', 'Remove ' + site.domain);
  removeBtn.addEventListener('click', () => {
    api.runtime.sendMessage({ type: 'removeSite', domain: site.domain }).then(() => {
      currentConfig.sites = currentConfig.sites.filter(s => s.domain !== site.domain);
      renderSites();
    }).catch(err => { console.error('Remove site failed:', err); });
  });

  const tdRemove = document.createElement('td');
  tdRemove.appendChild(removeBtn);

  tr.append(tdDomain, tdMaxvisit, tdMinaway, tdRemove);
  return tr;
}

function saveConfig() {
  api.runtime.sendMessage({ type: 'saveConfig', config: currentConfig }).then(() => {
    savedMsg.textContent = 'Saved ✓';
    setTimeout(() => { savedMsg.textContent = ''; }, 2000);
  }).catch(err => { console.error('Save config failed:', err); });
}

globalMaxvisitInput.addEventListener('blur', () => {
  const val = parseInt(globalMaxvisitInput.value, 10);
  if (!isNaN(val) && val >= 1) { currentConfig.global.maxvisit = val; saveConfig(); }
});

globalMinawayInput.addEventListener('blur', () => {
  const val = parseInt(globalMinawayInput.value, 10);
  if (!isNaN(val) && val >= 1) { currentConfig.global.minaway = val; saveConfig(); }
});

addBtn.addEventListener('click', () => {
  const domain = newDomainInput.value.trim().toLowerCase();
  domainError.textContent = '';
  if (!DOMAIN_REGEX.test(domain)) {
    domainError.textContent = 'Invalid domain name.';
    return;
  }
  if (currentConfig.sites.some(s => s.domain === domain)) {
    domainError.textContent = 'Domain already in list.';
    return;
  }
  currentConfig.sites.push({ domain });
  newDomainInput.value = '';
  saveConfig();
  renderSites();
});

newDomainInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { addBtn.click(); }
});

loadConfig().catch(err => { console.error('Failed to load config:', err); });
