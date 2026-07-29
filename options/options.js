import api from '../shared/browser-api.js';
import { DOMAIN_REGEX, findOverlappingDomain } from '../shared/domain.js';
import { parseOptionalInt } from '../shared/parse.js';

let currentConfig = null;

const globalMaxvisitInput = document.getElementById('global-maxvisit');
const globalMinawayInput = document.getElementById('global-minaway');
const globalBypassTimeoutInput = document.getElementById('global-bypass-timeout');
const globalMaxvisitError = document.getElementById('global-maxvisit-error');
const globalMinawayError = document.getElementById('global-minaway-error');
const globalBypassTimeoutError = document.getElementById('global-bypass-timeout-error');
const savedMsg = document.getElementById('saved-msg');
const sitesList = document.getElementById('sites-list');
const newDomainInput = document.getElementById('new-domain');
const addBtn = document.getElementById('add-btn');
const domainError = document.getElementById('domain-error');

async function loadConfig() {
  currentConfig = await api.runtime.sendMessage({ type: 'getConfig' });
  globalMaxvisitInput.value = currentConfig.global.maxvisit;
  globalMinawayInput.value = currentConfig.global.minaway;
  globalBypassTimeoutInput.value = currentConfig.global.bypassTimeout;
  renderSites();
}

function renderSites() {
  sitesList.replaceChildren(...currentConfig.sites.map(buildSiteRow));
}

function buildNumberInput(value, min, label, onChange) {
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(min);
  input.placeholder = 'default';
  input.setAttribute('aria-label', label);
  if (value !== undefined) { input.value = String(value); }
  input.addEventListener('blur', () => {
    onChange(parseOptionalInt(input.value, min));
    saveConfig();
  });
  return input;
}

function buildSiteRow(site) {
  const row = document.createElement('div');
  row.className = 'site-row';

  const domainEl = document.createElement('span');
  domainEl.className = 'site-domain';
  domainEl.textContent = site.domain;

  function buildSummaryField(label, value, unit) {
    const field = document.createElement('span');
    field.className = 'summary-field';
    field.textContent = label + ' ' + value + ' ' + unit;
    return field;
  }

  function renderSummary() {
    const maxvisit = site.maxvisit ?? currentConfig.global.maxvisit;
    const minaway = site.minaway ?? currentConfig.global.minaway;
    const bypassTimeout = site.bypassTimeout ?? currentConfig.global.bypassTimeout;
    summaryEl.replaceChildren(
      buildSummaryField('Max', maxvisit, 'm'),
      buildSummaryField('Min', minaway, 'm'),
      buildSummaryField('Bypass', bypassTimeout, 's'),
    );
  }

  const summaryEl = document.createElement('span');
  summaryEl.className = 'site-summary';

  const customizeLink = document.createElement('button');
  customizeLink.className = 'customize-link';
  customizeLink.textContent = 'Customize';

  const overrideFields = document.createElement('div');
  overrideFields.className = 'override-fields';

  function collapse() {
    renderSummary();
    customizeLink.classList.remove('hidden');
    overrideFields.classList.remove('expanded');
    // max-height (rather than display:none) is used so the collapse can animate, but
    // that alone leaves the clipped inputs still tab-focusable — inert removes them
    // from the focus order and AT tree while collapsed.
    overrideFields.inert = true;
  }

  function expand() {
    customizeLink.classList.add('hidden');
    overrideFields.classList.add('expanded');
    overrideFields.inert = false;
  }

  function buildFieldGroup(labelText, input, unitText, title) {
    const group = document.createElement('div');
    group.className = 'field-group';
    const label = document.createElement('label');
    label.textContent = labelText;
    const unit = document.createElement('span');
    unit.className = 'unit';
    unit.textContent = unitText;
    if (title) { input.title = title; }
    group.append(label, input, unit);
    return group;
  }

  const maxvisitInput = buildNumberInput(
    site.maxvisit, 0, 'Max visit in minutes for ' + site.domain + ', 0 blocks indefinitely', v => { site.maxvisit = v; },
  );
  const minawayInput = buildNumberInput(
    site.minaway, 1, 'Min away in minutes for ' + site.domain, v => { site.minaway = v; },
  );
  const bypassInput = buildNumberInput(
    site.bypassTimeout, 0, 'Bypass timeout in seconds for ' + site.domain + ', 0 disables overrides', v => { site.bypassTimeout = v; },
  );

  overrideFields.append(
    buildFieldGroup('Max visit', maxvisitInput, 'min', '0 blocks this site indefinitely'),
    buildFieldGroup('Min away', minawayInput, 'min'),
    buildFieldGroup('Bypass timeout', bypassInput, 'sec', '0 disables overrides'),
  );
  collapse();

  // Only collapse back to the compact summary once focus leaves the whole customize
  // group — not on every individual field blur, which would collapse the row (and
  // discard the in-progress edit) the moment you tab from one blank field to another
  // before typing anything.
  overrideFields.addEventListener('focusout', (e) => {
    if (overrideFields.contains(e.relatedTarget)) { return; }
    collapse();
  });

  customizeLink.addEventListener('click', expand);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'remove-btn';
  removeBtn.textContent = '🗑';
  removeBtn.setAttribute('aria-label', 'Remove ' + site.domain);
  let confirming = false;
  let revertTimer = null;
  removeBtn.addEventListener('click', () => {
    if (!confirming) {
      confirming = true;
      removeBtn.textContent = 'Confirm?';
      removeBtn.setAttribute('aria-label', 'Confirm removal of ' + site.domain);
      revertTimer = setTimeout(() => {
        confirming = false;
        removeBtn.textContent = '🗑';
        removeBtn.setAttribute('aria-label', 'Remove ' + site.domain);
      }, 3000);
      return;
    }
    clearTimeout(revertTimer);
    api.runtime.sendMessage({ type: 'removeSite', domain: site.domain }).then(() => {
      currentConfig.sites = currentConfig.sites.filter(s => s.domain !== site.domain);
      renderSites();
    }).catch(err => { console.error('Remove site failed:', err); });
  });

  row.append(domainEl, summaryEl, customizeLink, removeBtn, overrideFields);
  return row;
}

function saveConfig() {
  api.runtime.sendMessage({ type: 'saveConfig', config: currentConfig }).then(() => {
    savedMsg.textContent = 'Saved ✓';
    setTimeout(() => { savedMsg.textContent = ''; }, 2000);
  }).catch(err => { console.error('Save config failed:', err); });
}

function bindGlobalField(input, errorEl, min, apply) {
  input.addEventListener('blur', () => {
    const raw = input.value.trim();
    const val = parseInt(raw, 10);
    if (raw === '' || isNaN(val) || val < min) {
      errorEl.textContent = 'Enter a whole number ≥ ' + min + '.';
      return;
    }
    errorEl.textContent = '';
    apply(val);
    saveConfig();
    // Site rows that inherit this default show it in their collapsed summary — refresh
    // them now rather than leaving stale numbers until each row is next expanded.
    renderSites();
  });
}

bindGlobalField(globalMaxvisitInput, globalMaxvisitError, 0, v => { currentConfig.global.maxvisit = v; });
bindGlobalField(globalMinawayInput, globalMinawayError, 1, v => { currentConfig.global.minaway = v; });
bindGlobalField(globalBypassTimeoutInput, globalBypassTimeoutError, 0, v => { currentConfig.global.bypassTimeout = v; });

addBtn.addEventListener('click', () => {
  const domain = newDomainInput.value.trim().toLowerCase();
  domainError.textContent = '';
  if (!DOMAIN_REGEX.test(domain)) {
    domainError.textContent = 'Invalid domain name.';
    return;
  }
  const overlap = findOverlappingDomain(domain, currentConfig.sites.map(s => s.domain));
  if (overlap) {
    domainError.textContent = overlap === domain
      ? 'Domain already in list.'
      : 'Overlaps with existing entry "' + overlap + '".';
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
