// Service worker. Bridges the two tabs: relays throw/board envelopes from the
// autodarts tab to every open dartmeter tab, and caches the last "ready" so a
// freshly-opened dartmeter tab can learn the connection state on handshake.
importScripts('shared.js');

const { HEARTBEAT_GAP_MS, DARTMETER_MATCHES } = self.DM_BRIDGE;

// Debug logging, off unless enabled from the service-worker console:
//   chrome.storage.local.set({ dmBridgeDebug: true })
let DEBUG = false;
chrome.storage.local.get('dmBridgeDebug').then((v) => {
  DEBUG = !!v.dmBridgeDebug;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.dmBridgeDebug) DEBUG = !!changes.dmBridgeDebug.newValue;
});
function debug(...args) {
  if (DEBUG) console.log('[dm-bridge][bg]', ...args);
}

function fanOutToDartMeter(envelope) {
  chrome.tabs.query({ url: DARTMETER_MATCHES }, (tabs) => {
    debug('fan-out', envelope.type, 'to', tabs.length, 'dartmeter tab(s)');
    for (const tab of tabs) {
      if (tab.id == null) continue;
      chrome.tabs.sendMessage(tab.id, envelope).catch(() => {});
    }
  });
}

chrome.runtime.onMessage.addListener((envelope, sender, sendResponse) => {
  // Handshake query from a dartmeter content script: report cached readiness.
  if (envelope && envelope.type === 'query-ready') {
    chrome.storage.session.get('lastReady').then(({ lastReady }) => {
      const fresh = typeof lastReady === 'number' && Date.now() - lastReady < HEARTBEAT_GAP_MS;
      debug('query-ready ->', fresh);
      sendResponse({ ready: fresh });
    });
    return true; // async sendResponse
  }

  // Otherwise this came from the autodarts tab. Only accept from autodarts.io.
  const from = sender.tab && sender.tab.url;
  if (!from || !/^https:\/\/([a-z0-9-]+\.)?autodarts\.io\//.test(from)) {
    debug('rejected message from non-autodarts sender', from);
    return;
  }

  if (envelope.type === 'ready') {
    chrome.storage.session.set({ lastReady: Date.now() });
  }
  fanOutToDartMeter(envelope);
});
