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

  // Debug logging, off unless the user opts in on the autodarts.io page:
  //   localStorage.setItem('dm-bridge-debug', '1')
  function debug(...args) {
    try {
      if (window.localStorage.getItem('dm-bridge-debug')) {
        console.log('[dm-bridge][autodarts]', ...args);
      }
    } catch {
      // localStorage may be blocked — never throw from logging.
    }
  }

  const OrigWS = window.WebSocket;
  if (!OrigWS || OrigWS.__dmWrapped) return;

  debug('WebSocket wrap installed');

  let throwSeq = 0;
  // How many darts of the current board-manager visit we've already emitted.
  let bmEmitted = 0;
  // Have we already emitted the "visit finished" boundary for the darts
  // currently on the board? Starts true (no visit in progress); set false when
  // a fresh visit's first dart is emitted, true again when the visit is closed.
  // Prevents emitting the boundary more than once per visit.
  let bmVisitClosed = true;
  // Was the previous board-manager frame a *physical* takeout ("Takeout in
  // progress")? The takeout -> throw transition is the reliable start-of-visit
  // marker: the throw count alone can't detect it (a 1-dart visit followed by
  // another 1-dart visit stays 1 -> 1 and never shrinks).
  let bmRemoving = false;

  function emit(type, payload) {
    // Same-window, same-origin only; the content script also filters on
    // INJECT_SOURCE + source===window. Targeting our own origin (rather than
    // '*') keeps the envelope from being delivered to cross-origin frames.
    window.postMessage({ source: INJECT_SOURCE, type, payload }, window.location.origin);
  }

  // Emit the visit boundary at most once per visit, on the SAME socket as the
  // throws, so it is correctly ordered with them — it arrives before the next
  // visit's first dart. `Visit ready` means "this visit's darts are final and
  // takeout has begun"; the app arms a pending submit on it and commits on the
  // cloud `Takeout finished` event (or on the next dart, if that races ahead).
  // Keying the boundary off this in-order signal — rather than the cloud
  // `boards` "Takeout" events, which ride a second, slower socket and arrive
  // late — is what stops the next player's first throw being attributed to the
  // previous visit and dropped.
  function closeVisit(reason) {
    if (bmVisitClosed) return;
    bmVisitClosed = true;
    debug('emit Visit ready', reason);
    emit('board-event', { event: 'Visit ready' });
  }

  // The board-manager `type:"state"` frame carries the full, cumulative throws
  // array for the current visit plus a `status` field, and is re-sent on every
  // camera frame. Observed status lifecycle per visit:
  //   "Throw"  (a dart landed)  ->  "Takeout" (board full / visit complete,
  //   darts STILL on the board)  ->  "Takeout in progress" (player pulling) ->
  //   "Throw" (next visit).
  // So `Takeout` is NOT a takeout — only `Takeout in progress` is. We submit on
  // that, and re-emit each dart exactly once per visit.
  function handleBoardThrows(throws, status) {
    if (!Array.isArray(throws)) return;
    const s = typeof status === 'string' ? status.toLowerCase() : '';
    // The player is physically pulling the darts right now.
    const removing = s.includes('takeout') && s.includes('progress');

    // Start of a new visit: the board returned to throwing after a takeout, or
    // the throw count dropped below what we've emitted. Reset the per-visit emit
    // index so the new darts emit from index 0 (the count alone can't catch a
    // 1 -> 1 visit change, hence the takeout->throw transition). Flush the prior
    // visit first in case its physical takeout status was never observed.
    if ((bmRemoving && !removing) || throws.length < bmEmitted) {
      closeVisit('new visit started');
      bmEmitted = 0;
      bmVisitClosed = false;
    }
    bmRemoving = removing;

    for (let i = bmEmitted; i < throws.length; i++) {
      const t = throws[i];
      const seg = t && t.segment;
      if (!seg) continue;
      const c = (t && t.coords) || {};
      if (i === 0) bmVisitClosed = false; // a fresh visit is now in progress
      const payload = {
        segment: {
          name: seg.name,
          number: seg.number,
          bed: seg.bed,
          multiplier: seg.multiplier,
        },
        coords: c.x != null ? { x: c.x, y: c.y } : undefined,
        // Stable per dart per visit; the app dedupes on it and the loop bound
        // already prevents re-emitting a re-sent frame.
        throwId: `${i}#${seg.name}:${seg.number}:${seg.multiplier}:${c.x},${c.y}`,
        seq: throwSeq++,
      };
      debug('emit throw', payload);
      emit('throw', payload);
    }
    bmEmitted = throws.length;

    // Submit the visit the instant the player starts pulling the darts —
    // in-order with the throws on this same socket.
    if (removing) closeVisit('takeout in progress');
  }

  // All access to the (private, unversioned) autodarts frame shape is isolated
  // here. If autodarts renames fields, only this function needs updating, and a
  // throw never escapes to break the socket.
  function handleFrame(msg) {
    if (!msg || typeof msg !== 'object') return;
    const data = msg.data;
    if (!data || typeof data !== 'object') return;

    // Two sockets carry useful frames:
    //
    // 1. The board-manager socket — frames are tagged by `type` with NO
    //    `channel`. Its `type:"state"` frame carries the live, *classified*
    //    throws array (segment + coords) and is the sole source of dart values;
    //    it works on the board page WITHOUT an autodarts match running. Other
    //    types (motion_state / stats / cam_stats) are camera telemetry.
    //
    // 2. The cloud subscribe socket — frames are tagged by `channel`. We use it
    //    only for board lifecycle events (`autodarts.boards`), which drive the
    //    app's takeout-based turn submit. Match throws are intentionally NOT
    //    read here: the board-manager feed already reports every throw, so
    //    parsing the match channel too would double-count.
    if (typeof msg.channel !== 'string') {
      if (msg.type === 'state' && Array.isArray(data.throws)) {
        debug('board-manager state', data.status, data.numThrows, data.throws.length);
        handleBoardThrows(data.throws, data.status);
      }
      return;
    }

    // Log every cloud frame so the (private, unversioned) schema can be
    // inspected live. Behind the debug flag — verbose by design.
    debug('raw frame', msg);
    const channel = msg.channel;

    if (channel.includes('boards') && typeof data.event === 'string') {
      debug('board-event', data.event, 'channel', channel);
      emit('board-event', { event: data.event });
    }
  }

  function Wrapped(url, protocols) {
    const ws = protocols === undefined ? new OrigWS(url) : new OrigWS(url, protocols);
    try {
      // Every autodarts socket feeds `handleFrame`. The board-manager socket
      // carries the classified throws (`type:"state"`); the cloud subscribe
      // socket carries board lifecycle events. `handleFrame` distinguishes them
      // by the presence of a `channel` field, so we don't need to know either
      // socket's URL up front.
      ws.addEventListener('message', (ev) => {
        try {
          handleFrame(JSON.parse(ev.data));
        } catch (err) {
          // Non-JSON or unexpected shape — ignore, never throw.
          debug('frame parse error (ignored)', err);
        }
      });

      // The cloud subscribe socket also drives the connection heartbeat that
      // backs the app's "Connected" indicator.
      if (String(url).includes(SUBSCRIBE_MATCH)) {
        debug('subscribe socket detected', String(url));
        let heartbeat;
        const announce = () => emit('ready', { version: VERSION });
        ws.addEventListener('open', () => {
          debug('subscribe socket open');
          announce();
          heartbeat = setInterval(announce, HEARTBEAT_MS);
        });
        const stop = () => {
          if (heartbeat) clearInterval(heartbeat);
          debug('subscribe socket closed');
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
