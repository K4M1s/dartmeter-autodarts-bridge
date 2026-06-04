// Content script on play.autodarts.io (isolated world).
// 1. Injects inject-autodarts.js into the page context at document_start so the
//    WebSocket wrap is installed before autodarts opens its socket.
// 2. Relays the page-context envelopes to the background service worker.
(() => {
  const { INJECT_SOURCE } = self.DM_BRIDGE;

  // Debug logging, off unless: localStorage.setItem('dm-bridge-debug', '1')
  function debug(...args) {
    try {
      if (window.localStorage.getItem('dm-bridge-debug')) {
        console.log('[dm-bridge][content-ad]', ...args);
      }
    } catch {
      // never throw from logging
    }
  }

  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('src/inject-autodarts.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).prepend(script);
  debug('injected page script', script.src);

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const data = e.data;
    if (!data || data.source !== INJECT_SOURCE) return;
    debug('relay -> background', data.type, data.payload);
    // Forward { type, payload } to the background relay. Tolerate the worker
    // being asleep (sendMessage may reject); it will wake on the next event.
    try {
      chrome.runtime
        .sendMessage({ type: data.type, payload: data.payload })
        .catch(() => {});
    } catch {
      // Extension context invalidated (e.g. reload) — ignore.
    }
  });
})();
