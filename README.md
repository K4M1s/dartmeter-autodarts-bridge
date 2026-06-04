# DartMeter ↔ autodarts bridge

A small, open-source browser extension that forwards camera-detected dart
throws from your [play.autodarts.io](https://play.autodarts.io) session into
[DartMeter](https://dartmeter.com), so you can use DartMeter's game modes with
autodarts' camera scoring.

It is published as a **separate, auditable repo on purpose**: the extension is
the only piece that touches your autodarts session, so you can read exactly what
it does before trusting it. DartMeter itself never sees your autodarts login.

## Trust model — what it does and does not do

- **Rides your existing login.** It reads the throw data flowing over the
  WebSocket that play.autodarts.io *already opened* after you logged in. It does
  **not** ask for, read, store, or transmit your autodarts password, cookies, or
  auth tokens. There is no separate sign-in and no `client_secret`.
- **Forwards only throw data.** The only thing sent to the DartMeter tab is the
  parsed throw (`segment.{name, number, bed, multiplier}` + normalized board
  coordinates) and board lifecycle events (takeout, manual reset, etc.). See
  [`src/inject-autodarts.js`](src/inject-autodarts.js) — all field access is in
  one `handleFrame` function.
- **No network of its own.** It makes no outbound requests. It only relays
  messages between your two open tabs, in your browser.
- **Off by default in DartMeter.** Nothing happens unless you enable “Camera
  scoring (autodarts)” in DartMeter’s Settings.

## How it works

```
[play.autodarts.io tab]                          [dartmeter.com tab]
 inject-autodarts.js (page context)
   wraps window.WebSocket, parses throws
     -> window.postMessage
        -> content-autodarts.js (isolated world)
             -> chrome.runtime.sendMessage
                  -> background.js (relay + cache "ready")
                       -> chrome.tabs.sendMessage
                            -> content-dartmeter.js
                                 -> window.postMessage(origin-scoped)
                                      -> DartMeter app listener
```

Both tabs must be open in the **same browser profile** — the background worker
bridges them. DartMeter shows a connection indicator in Settings.

### Files

| File | Runs in | Role |
| --- | --- | --- |
| `src/inject-autodarts.js` | autodarts.io **page** context | Wraps `WebSocket`, parses throw/board frames, dedupes repeated frames |
| `src/content-autodarts.js` | autodarts.io isolated world | Injects the page script, relays its messages to the background |
| `src/background.js` | service worker | Fans out throws to dartmeter tab(s); caches last “ready” for handshake |
| `src/content-dartmeter.js` | dartmeter.com isolated world | Posts throws into the page with the page origin; answers the app handshake |
| `src/shared.js` | both isolated worlds | Shared constants (mirrored in DartMeter’s `lib/autodarts.ts`) |

## Install (unpacked)

1. Clone this repo.
2. Open `chrome://extensions` (or `edge://extensions`), enable **Developer
   mode**.
3. **Load unpacked** → select this folder.
4. Open `https://play.autodarts.io` (logged in) and `https://dartmeter.com` in
   the same browser.
5. In DartMeter → Settings → **Camera scoring (autodarts)** → On. It should show
   **Connected**.

## Status & caveats

- The autodarts WebSocket message schema is **reverse-engineered and
  unversioned** — an autodarts update can rename fields and temporarily break
  parsing. When that happens, throws simply stop arriving and DartMeter falls
  back to manual input; the fix is localized to `handleFrame` in
  `inject-autodarts.js`.
- This project is unaffiliated with autodarts.
- Firefox port is untested (MV3 service-worker + `chrome.*` APIs).

## Releases

Versioning and changelog are automated with
[release-please](https://github.com/googleapis/release-please). Commits on `main`
**must** follow [Conventional Commits](https://www.conventionalcommits.org)
(`feat:` → minor bump, `fix:` → patch). release-please opens a release PR; merging
it tags the version, publishes a GitHub Release, and the workflow attaches a
packaged `dartmeter-autodarts-bridge-<tag>.zip` (build = zip of the static files;
no bundler). The version is kept in sync across `package.json`, `manifest.json`,
and the `VERSION` constants in `src/shared.js` + `src/inject-autodarts.js`.

## License

[MIT](LICENSE).
