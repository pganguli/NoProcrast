import api from '../shared/browser-api.js';

document.getElementById('settings-btn').addEventListener('click', () => {
  api.runtime.openOptionsPage();
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
