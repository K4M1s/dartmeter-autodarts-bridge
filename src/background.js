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

  // Otherwise this came from the autodarts tab. Only accept from play.autodarts.io.
  const from = sender.tab && sender.tab.url;
  if (!from || !/^https:\/\/play\.autodarts\.io\//.test(from)) {
    debug('rejected message from non-autodarts sender', from);
    return;
  }

  if (envelope.type === 'ready') {
    api.storage.session.set({ lastReady: Date.now() });
  }
  fanOutToDartMeter(envelope);
});
