# DartMeter Bridge for autodarts

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
| `src/background.js` | service worker (Chrome) / event page (Firefox) | Fans out throws to dartmeter tab(s); caches last “ready” for handshake |
| `src/content-dartmeter.js` | dartmeter.com isolated world | Posts throws into the page with the page origin; answers the app handshake |
| `src/shared.js` | both isolated worlds | Shared constants (mirrored in DartMeter’s `lib/autodarts.ts`) |

## Install (unpacked)

### Chrome / Edge

1. Clone this repo.
2. Open `chrome://extensions` (or `edge://extensions`), enable **Developer
   mode**.
3. **Load unpacked** → select this folder.
4. Open `https://play.autodarts.io` (logged in) and `https://dartmeter.com` in
   the same browser. For local development, `http://localhost` and
   `http://127.0.0.1` (any port, e.g. the `npm run dev` server on `:3000`) work
   too.

> **Note on localhost permissions.** The committed `manifest.json` keeps
> `http://localhost/*` and `http://127.0.0.1/*` host permissions so unpacked
> local development works out of the box. The **published store builds strip
> them** — `npm run build:store` writes cleaned manifests into `dist/chrome/`
> and `dist/firefox/` (localhost removed) that are what get zipped and uploaded.
> The release workflow runs this automatically; the unpacked folder you load
> for dev is unaffected.
5. In DartMeter → Settings → **Camera scoring (autodarts)** → On. It should show
   **Connected**.

### Firefox

`manifest.json` is Chrome-shaped (background service worker), which Firefox does
not run. Build the Firefox package first, then load it temporarily:

1. `npm run build:store` — produces `dist/firefox/` (background event page +
   `browser_specific_settings.gecko`).
2. Open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** →
   pick `dist/firefox/manifest.json`. (Or `npm run run:firefox` to launch a
   throwaway Firefox profile with the add-on loaded.)
3. Open the two tabs and toggle the DartMeter setting as above.

> Temporary add-ons are removed when Firefox restarts. A permanent install comes
> from the signed AMO listing (see [Releases](#releases)).

## Status & caveats

- The autodarts WebSocket message schema is **reverse-engineered and
  unversioned** — an autodarts update can rename fields and temporarily break
  parsing. When that happens, throws simply stop arriving and DartMeter falls
  back to manual input; the fix is localized to `handleFrame` in
  `inject-autodarts.js`.
- Chrome and Firefox are both supported from a single source tree. The extension
  API is accessed through `globalThis.browser ?? globalThis.chrome` so the
  promise-based calls work on Firefox (where bare `chrome.*` is callback-only),
  and `npm run build:store` emits a Firefox-shaped manifest (event-page
  background + `browser_specific_settings.gecko`).

## Affiliation

DartMeter is an independent project and is not affiliated with, endorsed by,
sponsored by, or associated with Autodarts. Any references to Autodarts or
play.autodarts.io are provided solely to describe integration and compatibility.

## Debugging

Verbose logging is **off by default**. To enable it:

- On **play.autodarts.io** and **dartmeter.com** (page consoles):
  `localStorage.setItem('dm-bridge-debug', '1')` — then reload. Logs are prefixed
  `[dm-bridge][autodarts]`, `[dm-bridge][content-ad]`, `[dm-bridge][content-dm]`.
- In the **service worker** console (`chrome://extensions` → this extension →
  *service worker*): `chrome.storage.local.set({ dmBridgeDebug: true })`. Logs are
  prefixed `[dm-bridge][bg]`.

The autodarts page log dumps **every raw WS frame** (`raw frame …`), which is how
you confirm the real field names during bring-up.

## Releases

Versioning and changelog are automated with
[release-please](https://github.com/googleapis/release-please). Commits on `main`
**must** follow [Conventional Commits](https://www.conventionalcommits.org)
(`feat:` → minor bump, `fix:` → patch). release-please opens a release PR; merging
it tags the version, publishes a GitHub Release, and the workflow attaches the
packaged `dartmeter-autodarts-bridge-chrome-<tag>.zip` and
`dartmeter-autodarts-bridge-firefox-<tag>.zip`. The zips are built by
`npm run build:store` (`scripts/build-store.mjs`), which copies the static files
into `dist/chrome/` + `dist/firefox/` and strips the localhost host permissions
from each manifest — there is no bundler. The version is kept in sync across
`package.json`, `manifest.json`, and the `VERSION` constants in `src/shared.js` +
`src/inject-autodarts.js`.

The Chrome zip is uploaded to the Chrome Web Store dashboard. The Firefox zip is
listed on [addons.mozilla.org](https://addons.mozilla.org); the release workflow
also runs `web-ext lint` on it, and submits it to AMO automatically when the
`AMO_API_KEY` / `AMO_API_SECRET` repo secrets are configured (otherwise you can
run `npm run sign:firefox` locally with those credentials in the environment).

## Privacy

The extension's data handling is described in the [Trust model](#trust-model--what-it-does-and-does-not-do)
section above. The hosted privacy policy required by the Chrome Web Store lives at
<https://dartmeter.com/extension-privacy>.

## License

[MIT](LICENSE).
