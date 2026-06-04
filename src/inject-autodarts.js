// Runs in the PAGE context of play.autodarts.io (injected by content-autodarts.js).
// A content script lives in an isolated world and cannot see the page's real
// `window.WebSocket`, so we must run here to wrap it.
//
// We wrap WebSocket, watch the autodarts subscribe socket, parse throw / board
// frames, and forward a minimal, already-parsed envelope to the isolated-world
// content script via window.postMessage. We NEVER read cookies, tokens, or
// anything else — only the throw data flowing over the socket the page itself
// opened.
(() => {
  const INJECT_SOURCE = '__dm_ad_inject__';
  const HEARTBEAT_MS = 5_000;
  const VERSION = '0.1.0'; // x-release-please-version
  const SUBSCRIBE_MATCH = 'ms/v0/subscribe';

  const OrigWS = window.WebSocket;
  if (!OrigWS || OrigWS.__dmWrapped) return;

  let throwSeq = 0;
  let lastThrowKey = '';

  function emit(type, payload) {
    // Same-window only; the content script filters on INJECT_SOURCE.
    window.postMessage({ source: INJECT_SOURCE, type, payload }, '*');
  }

  // Autodarts re-sends full board/match state on every frame. Collapse identical
  // frames and assign a stable id per physical dart so the app can dedupe.
  function handleThrows(throws) {
    if (!Array.isArray(throws) || throws.length === 0) return;
    const last = throws[throws.length - 1];
    const seg = last && last.segment;
    if (!seg) return;
    const c = last.coords || {};
    const key = `${throws.length}:${seg.name}:${seg.number}:${seg.multiplier}:${c.x},${c.y}`;
    if (key === lastThrowKey) return;
    lastThrowKey = key;
    emit('throw', {
      segment: {
        name: seg.name,
        number: seg.number,
        bed: seg.bed,
        multiplier: seg.multiplier,
      },
      coords: c.x != null ? { x: c.x, y: c.y } : undefined,
      throwId: `${throws.length}#${key}`,
      seq: throwSeq++,
    });
  }

  // All access to the (private, unversioned) autodarts frame shape is isolated
  // here. If autodarts renames fields, only this function needs updating, and a
  // throw never escapes to break the socket.
  function handleFrame(msg) {
    if (!msg || typeof msg !== 'object') return;
    const channel = typeof msg.channel === 'string' ? msg.channel : '';
    const data = msg.data;
    if (!data || typeof data !== 'object') return;

    if (channel.includes('boards') && typeof data.event === 'string') {
      emit('board-event', { event: data.event });
      if (data.event === 'Takeout started' || data.event === 'Manual reset') {
        lastThrowKey = '';
      }
      return;
    }

    // Throw state can arrive either as a top-level `throws` array (board state)
    // or nested under the latest turn (match state). Handle both.
    if (Array.isArray(data.throws)) {
      handleThrows(data.throws);
    } else if (Array.isArray(data.turns) && data.turns.length) {
      const turn = data.turns[data.turns.length - 1];
      if (turn && Array.isArray(turn.throws)) handleThrows(turn.throws);
    }
  }

  function Wrapped(url, protocols) {
    const ws = protocols === undefined ? new OrigWS(url) : new OrigWS(url, protocols);
    try {
      if (String(url).includes(SUBSCRIBE_MATCH)) {
        let heartbeat;
        const announce = () => emit('ready', { version: VERSION });
        ws.addEventListener('open', () => {
          announce();
          heartbeat = setInterval(announce, HEARTBEAT_MS);
        });
        ws.addEventListener('message', (ev) => {
          try {
            handleFrame(JSON.parse(ev.data));
          } catch {
            // Non-JSON or unexpected shape — ignore, never throw.
          }
        });
        const stop = () => {
          if (heartbeat) clearInterval(heartbeat);
        };
        ws.addEventListener('close', stop);
        ws.addEventListener('error', stop);
        // If the socket is already open by the time we wrap (race), announce now.
        if (ws.readyState === OrigWS.OPEN) {
          announce();
          heartbeat = setInterval(announce, HEARTBEAT_MS);
        }
      }
    } catch {
      // Wrapping must never break the page's socket.
    }
    return ws;
  }

  Wrapped.prototype = OrigWS.prototype;
  Wrapped.CONNECTING = OrigWS.CONNECTING;
  Wrapped.OPEN = OrigWS.OPEN;
  Wrapped.CLOSING = OrigWS.CLOSING;
  Wrapped.CLOSED = OrigWS.CLOSED;
  Wrapped.__dmWrapped = true;

  window.WebSocket = Wrapped;
})();
