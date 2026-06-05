// Wire contract shared by every part of this extension and mirrored by the
// DartMeter app's `lib/autodarts.ts`. Keep these constants in sync with the app.
//
// Loaded as a plain content-script file (no module system), so it just defines
// globals on `self`.

self.DM_BRIDGE = {
  // Stamped on every envelope this extension posts into the dartmeter page.
  EXT_SOURCE: 'dartmeter-autodarts-ext',
  // Stamped on messages the dartmeter app posts to us (handshake).
  APP_SOURCE: 'dartmeter-app',
  // Internal tag for page-context -> isolated-world messages on autodarts.io.
  INJECT_SOURCE: '__dm_ad_inject__',
  // Treat a cached "ready" as fresh within this window (handshake). Must exceed
  // Chrome's hidden-tab timer throttle (~60s) so the heartbeat from a
  // backgrounded autodarts tab still counts. Matches the app's heartbeat gap.
  HEARTBEAT_GAP_MS: 90_000,
  // How often the page-context script re-announces a live socket.
  HEARTBEAT_MS: 5_000,
  // Where the DartMeter app runs. Must stay in sync with the dartmeter
  // content-script matches in manifest.json. localhost/127.0.0.1 cover local
  // dev (`npm run dev` on :3000); Chrome match patterns ignore the port.
  DARTMETER_MATCHES: [
    'https://dartmeter.com/*',
    'http://localhost/*',
    'http://127.0.0.1/*',
  ],
  VERSION: '0.1.0', // x-release-please-version
};
