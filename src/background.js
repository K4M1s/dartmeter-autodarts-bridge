// Service worker. Bridges the two tabs: relays throw/board envelopes from the
// autodarts tab to every open dartmeter tab, and caches the last "ready" so a
// freshly-opened dartmeter tab can learn the connection state on handshake.
importScripts('shared.js');

const { HEARTBEAT_GAP_MS } = self.DM_BRIDGE;

function fanOutToDartMeter(envelope) {
  chrome.tabs.query({ url: 'https://dartmeter.com/*' }, (tabs) => {
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
      sendResponse({ ready: fresh });
    });
    return true; // async sendResponse
  }

  // Otherwise this came from the autodarts tab. Only accept from autodarts.io.
  const from = sender.tab && sender.tab.url;
  if (!from || !/^https:\/\/([a-z0-9-]+\.)?autodarts\.io\//.test(from)) return;

  if (envelope.type === 'ready') {
    chrome.storage.session.set({ lastReady: Date.now() });
  }
  fanOutToDartMeter(envelope);
});
