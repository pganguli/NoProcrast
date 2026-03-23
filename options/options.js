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

// ---------------------------------------------------------------------------
// Load config
// ---------------------------------------------------------------------------

async function loadConfig() {
  currentConfig = await api.runtime.sendMessage({ type: 'getConfig' });
  globalMaxvisitInput.value = currentConfig.global.maxvisit;
  globalMinawayInput.value = currentConfig.global.minaway;
  renderSites();
}

// ---------------------------------------------------------------------------
// Render site rows
// ---------------------------------------------------------------------------

function renderSites() {
  while (sitesTbody.firstChild) {
    sitesTbody.removeChild(sitesTbody.firstChild);
  }
  for (const site of currentConfig.sites) {
    sitesTbody.appendChild(buildSiteRow(site));
  }
}

/**
 * @param {{ domain: string, maxvisit?: number, minaway?: number }} site
 * @returns {HTMLTableRowElement}
 */
function buildSiteRow(site) {
  const tr = document.createElement('tr');

  const tdDomain = document.createElement('td');
  tdDomain.textContent = site.domain;
  tr.appendChild(tdDomain);

  const tdMaxvisit = document.createElement('td');
  const maxvisitInput = document.createElement('input');
  maxvisitInput.type = 'number';
  maxvisitInput.min = '1';
  maxvisitInput.placeholder = 'default';
  if (site.maxvisit !== undefined) { maxvisitInput.value = String(site.maxvisit); }
  maxvisitInput.addEventListener('blur', () => {
    const val = maxvisitInput.value.trim();
    site.maxvisit = val === '' ? undefined : Math.max(1, parseInt(val, 10));
    saveConfig();
  });
  tdMaxvisit.appendChild(maxvisitInput);
  tr.appendChild(tdMaxvisit);

  const tdMinaway = document.createElement('td');
  const minawayInput = document.createElement('input');
  minawayInput.type = 'number';
  minawayInput.min = '1';
  minawayInput.placeholder = 'default';
  if (site.minaway !== undefined) { minawayInput.value = String(site.minaway); }
  minawayInput.addEventListener('blur', () => {
    const val = minawayInput.value.trim();
    site.minaway = val === '' ? undefined : Math.max(1, parseInt(val, 10));
    saveConfig();
  });
  tdMinaway.appendChild(minawayInput);
  tr.appendChild(tdMinaway);

  const tdRemove = document.createElement('td');
  const removeBtn = document.createElement('button');
  removeBtn.className = 'remove-btn';
  removeBtn.textContent = 'Remove';
  removeBtn.addEventListener('click', () => {
    api.runtime.sendMessage({ type: 'removeSite', domain: site.domain }).then(() => {
      currentConfig.sites = currentConfig.sites.filter(s => s.domain !== site.domain);
      renderSites();
    }).catch(err => {
      console.error('Remove site failed:', err);
    });
  });
  tdRemove.appendChild(removeBtn);
  tr.appendChild(tdRemove);

  return tr;
}

// ---------------------------------------------------------------------------
// Save config
// ---------------------------------------------------------------------------

function saveConfig() {
  api.runtime.sendMessage({ type: 'saveConfig', config: currentConfig }).then(() => {
    savedMsg.textContent = 'Saved \u2713';
    setTimeout(() => { savedMsg.textContent = ''; }, 2000);
  }).catch(err => {
    console.error('Save config failed:', err);
  });
}

// ---------------------------------------------------------------------------
// Global defaults — save on blur
// ---------------------------------------------------------------------------

globalMaxvisitInput.addEventListener('blur', () => {
  const val = parseInt(globalMaxvisitInput.value, 10);
  if (!isNaN(val) && val >= 1) {
    currentConfig.global.maxvisit = val;
    saveConfig();
  }
});

globalMinawayInput.addEventListener('blur', () => {
  const val = parseInt(globalMinawayInput.value, 10);
  if (!isNaN(val) && val >= 1) {
    currentConfig.global.minaway = val;
    saveConfig();
  }
});

// ---------------------------------------------------------------------------
// Add site
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

loadConfig().catch(err => {
  console.error('Failed to load config:', err);
});
