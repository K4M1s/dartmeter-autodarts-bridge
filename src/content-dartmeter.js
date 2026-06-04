// Content script on dartmeter.com (isolated world).
// Delivers relayed envelopes into the page with the page's own origin (so the
// app's strict origin check passes), and answers the app's handshake.
(() => {
  const { EXT_SOURCE, APP_SOURCE } = self.DM_BRIDGE;
  const origin = location.origin;

  function postToPage(type, payload) {
    window.postMessage({ source: EXT_SOURCE, type, payload }, origin);
  }

  // Relayed throw/board/ready envelopes from the autodarts tab (via background).
  chrome.runtime.onMessage.addListener((envelope) => {
    if (!envelope || !envelope.type) return;
    postToPage(envelope.type, envelope.payload);
  });

  // The app announces itself with `hello`; reply with current readiness so the
  // indicator is correct even if the user opened dartmeter after autodarts.
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== origin) return;
    const data = e.data;
    if (!data || data.source !== APP_SOURCE || data.type !== 'hello') return;
    try {
      chrome.runtime.sendMessage({ type: 'query-ready' }).then((res) => {
        if (res && res.ready) postToPage('ready', { version: self.DM_BRIDGE.VERSION });
      }).catch(() => {});
    } catch {
      // Extension context invalidated — ignore.
    }
  });
})();
