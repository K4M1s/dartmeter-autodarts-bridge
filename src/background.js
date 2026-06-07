// Service worker. Bridges the two tabs: relays throw/board envelopes from the
// autodarts tab to every open dartmeter tab, and caches the last "ready" so a
// freshly-opened dartmeter tab can learn the connection state on handshake.
// In Chrome the background runs as a service worker (importScripts available);
// in Firefox it's an event page where shared.js is loaded via background.scripts
// ahead of this file, so importScripts is undefined and must be skipped.
if (typeof importScripts === 'function') importScripts('shared.js');

// Firefox's `chrome.*` is callback-only; `browser.*` returns promises. Chrome
// has no `browser`, but its `chrome.*` returns promises under MV3. Alias to the
// promise-returning namespace on whichever browser we're on.
const api = globalThis.browser ?? globalThis.chrome;

const { HEARTBEAT_GAP_MS, DARTMETER_MATCHES } = self.DM_BRIDGE;

// Debug logging, off unless enabled from the service-worker console:
//   api.storage.local.set({ dmBridgeDebug: true })
let DEBUG = false;
api.storage.local.get('dmBridgeDebug').then((v) => {
  DEBUG = !!v.dmBridgeDebug;
});
api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.dmBridgeDebug) DEBUG = !!changes.dmBridgeDebug.newValue;
});
function debug(...args) {
  if (DEBUG) console.log('[dm-bridge][bg]', ...args);
}

function fanOutToDartMeter(envelope) {
  api.tabs.query({ url: DARTMETER_MATCHES }, (tabs) => {
    debug('fan-out', envelope.type, 'to', tabs.length, 'dartmeter tab(s)');
    for (const tab of tabs) {
      if (tab.id == null) continue;
      api.tabs.sendMessage(tab.id, envelope).catch(() => {});
    }
  });
}

// Origins granted in the manifest (always allowed). Anything else returned by
// permissions.getAll() is a user-granted board site (via the popup) that we must
// dynamically register the autodarts content script on.
const STATIC_ORIGINS = [
  'https://play.autodarts.io/*',
  'https://dartmeter.com/*',
  'http://localhost/*',
  'http://127.0.0.1/*',
];

const scriptId = (origin) => `granted:${origin}`;

// Register the same two autodarts-side scripts the static play.autodarts.io
// match uses, but for a user-granted board origin (e.g. http://192.168.0.121/*).
// inject-autodarts.js is then loaded into the page by content-autodarts.js via
// web_accessible_resources (broadened to http://*/* in the manifest).
async function registerOrigin(origin) {
  try {
    await api.scripting.registerContentScripts([
      {
        id: scriptId(origin),
        matches: [origin],
        js: ['src/shared.js', 'src/content-autodarts.js'],
        runAt: 'document_start',
        persistAcrossSessions: true,
        world: 'ISOLATED',
      },
    ]);
    debug('registered content script for', origin);
  } catch (err) {
    // Already registered (or invalid pattern) — non-fatal.
    debug('registerOrigin skipped', origin, String(err));
  }
}

async function unregisterOrigin(origin) {
  try {
    await api.scripting.unregisterContentScripts({ ids: [scriptId(origin)] });
    debug('unregistered content script for', origin);
  } catch (err) {
    debug('unregisterOrigin skipped', origin, String(err));
  }
}

// On install/startup, re-register every currently-granted board origin. Dynamic
// registrations can be dropped across extension updates; permissions persist, so
// the granted set is the source of truth.
async function reconcileRegistrations() {
  try {
    const [{ origins = [] }, registered] = await Promise.all([
      api.permissions.getAll(),
      api.scripting.getRegisteredContentScripts(),
    ]);
    const have = new Set(registered.map((s) => s.id));
    const granted = origins.filter((o) => !STATIC_ORIGINS.includes(o));
    for (const origin of granted) {
      if (!have.has(scriptId(origin))) await registerOrigin(origin);
    }
    debug('reconciled registrations; granted board origins:', granted);
  } catch (err) {
    debug('reconcileRegistrations failed', String(err));
  }
}

api.runtime.onInstalled.addListener(reconcileRegistrations);
api.runtime.onStartup.addListener(reconcileRegistrations);

// Is the message sender an approved board origin (the static autodarts host or a
// user-granted site)? Granted sites are checked against the live permission set
// so revoking a site immediately stops its throws being relayed.
async function senderIsApprovedBoard(url) {
  if (!url) return false;
  if (/^https:\/\/play\.autodarts\.io\//.test(url)) return true;
  let pattern;
  try {
    pattern = `${new URL(url).origin}/*`;
  } catch {
    return false;
  }
  try {
    return await api.permissions.contains({ origins: [pattern] });
  } catch {
    return false;
  }
}

api.runtime.onMessage.addListener((envelope, sender, sendResponse) => {
  // Handshake query from a dartmeter content script: report cached readiness.
  if (envelope && envelope.type === 'query-ready') {
    api.storage.session.get('lastReady').then(({ lastReady }) => {
      const fresh = typeof lastReady === 'number' && Date.now() - lastReady < HEARTBEAT_GAP_MS;
      debug('query-ready ->', fresh);
      sendResponse({ ready: fresh });
    });
    return true; // async sendResponse
  }

  // Popup asks us to (un)register the autodarts content script on a board origin
  // it just granted/revoked. The popup owns the user-gesture permissions.request;
  // we own the matching content-script registration.
  if (envelope && envelope.type === 'register-origin') {
    registerOrigin(envelope.origin).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (envelope && envelope.type === 'unregister-origin') {
    unregisterOrigin(envelope.origin).then(() => sendResponse({ ok: true }));
    return true;
  }

  // Otherwise this came from a board tab. Accept play.autodarts.io or any site the
  // user has granted via the popup; reject everything else.
  const from = sender.tab && sender.tab.url;
  senderIsApprovedBoard(from).then((ok) => {
    if (!ok) {
      debug('rejected message from non-board sender', from);
      return;
    }
    if (envelope.type === 'ready') {
      api.storage.session.set({ lastReady: Date.now() });
    }
    fanOutToDartMeter(envelope);
  });
});
