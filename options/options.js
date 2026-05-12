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

/**
 * Fetches config from the service worker, populates the global-defaults inputs,
 * and renders the site list. Called once on page load.
 * @returns {Promise<void>}
 */
async function loadConfig() {
  currentConfig = await api.runtime.sendMessage({ type: 'getConfig' });
  globalMaxvisitInput.value = currentConfig.global.maxvisit;
  globalMinawayInput.value = currentConfig.global.minaway;
  renderSites();
}

/**
 * Re-renders the entire site table from currentConfig.sites.
 * Called after any mutation to the sites array.
 */
function renderSites() {
  sitesTbody.replaceChildren(...currentConfig.sites.map(buildSiteRow));
}

/**
 * Creates a number input for a per-site override field (maxvisit or minaway).
 * Empty value means "inherit global default" and is stored as undefined.
 * Clamps the minimum to 1 to match the global-defaults constraint.
 * @param {number|undefined} value - Current override; undefined renders as placeholder.
 * @param {function(number|undefined): void} onChange - Receives the parsed value on blur.
 * @returns {HTMLInputElement}
 */
function buildNumberInput(value, onChange) {
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '1';
  input.placeholder = 'default';
  if (value !== undefined) { input.value = String(value); }
  input.addEventListener('blur', () => {
    const val = input.value.trim();
    onChange(val === '' ? undefined : Math.max(1, parseInt(val, 10)));
    saveConfig();
  });
  return input;
}

/**
 * Builds a table row for one entry in the site list. Edits to the maxvisit and
 * minaway inputs mutate the site object in-place (currentConfig.sites is an
 * array of references) and then persist via saveConfig.
 * @param {{ domain: string, maxvisit?: number, minaway?: number }} site
 * @returns {HTMLTableRowElement}
 */
function buildSiteRow(site) {
  const tr = document.createElement('tr');

  const tdDomain = document.createElement('td');
  tdDomain.textContent = site.domain;

  const tdMaxvisit = document.createElement('td');
  tdMaxvisit.appendChild(buildNumberInput(site.maxvisit, v => { site.maxvisit = v; }));

  const tdMinaway = document.createElement('td');
  tdMinaway.appendChild(buildNumberInput(site.minaway, v => { site.minaway = v; }));

  const removeBtn = document.createElement('button');
  removeBtn.className = 'remove-btn';
  removeBtn.textContent = 'Remove';
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

/**
 * Sends the current in-memory config to the service worker for persistence.
 * Shows a brief "Saved ✓" confirmation on success.
 */
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
