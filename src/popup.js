// Toolbar popup. Lets the user grant the bridge on a board-manager site that
// isn't play.autodarts.io — e.g. when autodarts redirects board scoring to a LAN
// IP like http://192.168.0.121. The optional permission is limited to http://*/*
// (see manifest optional_host_permissions), so only plaintext-http boards qualify.
//
// permissions.request MUST run from this popup (it requires a user gesture).
// The matching content-script registration is owned by the background worker;
// we message it after the permission flips.
(() => {
  const api = globalThis.browser ?? globalThis.chrome;

  // Origins baked into the manifest — always on, never listed/removable here.
  const STATIC_ORIGINS = [
    'https://play.autodarts.io/*',
    'https://dartmeter.com/*',
    'http://localhost/*',
    'http://127.0.0.1/*',
  ];

  const currentEl = document.getElementById('current');
  const allowedEl = document.getElementById('allowed');

  // "http://192.168.0.121:3180/board" -> { pattern: "http://192.168.0.121/*", host, scheme }
  function tabOrigin(url) {
    try {
      const u = new URL(url);
      return { pattern: `${u.origin}/*`, host: u.host, scheme: u.protocol };
    } catch {
      return null;
    }
  }

  function hostOf(pattern) {
    try {
      return new URL(pattern.replace(/\/\*$/, '/')).host;
    } catch {
      return pattern;
    }
  }

  async function activeTab() {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function renderCurrent() {
    const tab = await activeTab();
    const info = tab && tab.url ? tabOrigin(tab.url) : null;
    currentEl.innerHTML = '';

    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = 'This site';
    currentEl.append(label);

    if (!info) {
      const p = document.createElement('div');
      p.className = 'note';
      p.textContent = 'No web page in this tab.';
      currentEl.append(p);
      return;
    }

    const host = document.createElement('div');
    host.className = 'host';
    host.textContent = info.host;
    currentEl.append(host);

    if (STATIC_ORIGINS.includes(info.pattern) || info.host === 'play.autodarts.io') {
      const p = document.createElement('div');
      p.className = 'note';
      p.textContent = 'Built in — always active here.';
      currentEl.append(p);
      return;
    }

    if (info.scheme !== 'http:') {
      const p = document.createElement('div');
      p.className = 'note';
      p.textContent = 'Only http:// board pages can be allowed.';
      currentEl.append(p);
      return;
    }

    const granted = await api.permissions.contains({ origins: [info.pattern] });
    if (granted) {
      const p = document.createElement('div');
      p.className = 'note';
      p.textContent = '✓ Allowed. Reload the page if scoring isn’t connected yet.';
      currentEl.append(p);
      return;
    }

    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.textContent = 'Allow on this site';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      // Native Chrome/Firefox allow prompt fires here (the user gesture).
      const ok = await api.permissions.request({ origins: [info.pattern] });
      if (!ok) {
        btn.disabled = false;
        return;
      }
      await api.runtime.sendMessage({ type: 'register-origin', origin: info.pattern });
      if (tab.id != null) await api.tabs.reload(tab.id);
      window.close();
    });
    currentEl.append(btn);
  }

  async function renderAllowed() {
    const { origins = [] } = await api.permissions.getAll();
    const granted = origins.filter((o) => !STATIC_ORIGINS.includes(o));
    allowedEl.innerHTML = '';

    if (granted.length === 0) {
      const p = document.createElement('div');
      p.className = 'empty';
      p.textContent = 'None yet.';
      allowedEl.append(p);
      return;
    }

    for (const pattern of granted) {
      const row = document.createElement('div');
      row.className = 'allowed-row';

      const host = document.createElement('span');
      host.className = 'host';
      host.textContent = hostOf(pattern);
      row.append(host);

      const rm = document.createElement('button');
      rm.className = 'remove';
      rm.textContent = 'Remove';
      rm.addEventListener('click', async () => {
        rm.disabled = true;
        await api.permissions.remove({ origins: [pattern] });
        await api.runtime.sendMessage({ type: 'unregister-origin', origin: pattern });
        render();
      });
      row.append(rm);

      allowedEl.append(row);
    }
  }

  function render() {
    renderCurrent();
    renderAllowed();
  }

  render();
})();
