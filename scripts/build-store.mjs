// Builds the store packages into dist/chrome/ and dist/firefox/.
//
// The committed manifest.json keeps http://localhost + http://127.0.0.1 host
// permissions so that "Load unpacked → select this folder" works for local
// development against `npm run dev` (:3000) out of the box. The published store
// builds must NOT ship those localhost permissions (reviewers flag them), so this
// script copies the extension into per-browser dist folders and strips them.
//
// manifest.json is Chrome-shaped (background.service_worker). Chrome uses it
// almost verbatim; Firefox needs background.scripts (it has no service worker)
// plus browser_specific_settings.gecko (required by AMO).
//
// Usage: node scripts/build-store.mjs
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const LOCALHOST = ['http://localhost/*', 'http://127.0.0.1/*'];
const DIST = 'dist';
const GECKO_ID = 'dartmeter-autodarts-bridge@k4m1s';
// 128 (ESR) is the floor for optional_host_permissions, which the "allow a local
// board-manager site" popup relies on. Also covers MV3 + storage.session.
const FIREFOX_MIN_VERSION = '128.0';

rmSync(DIST, { recursive: true, force: true });

const strip = (arr) => (Array.isArray(arr) ? arr.filter((m) => !LOCALHOST.includes(m)) : arr);

// Start from the committed Chrome manifest, with localhost host permissions /
// content-script matches stripped — shared by both targets.
function baseManifest() {
  const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
  manifest.host_permissions = strip(manifest.host_permissions);
  for (const cs of manifest.content_scripts ?? []) {
    cs.matches = strip(cs.matches);
  }
  return manifest;
}

// Firefox has no background service worker: load shared.js + background.js as an
// event page, in order, and declare the AMO extension id / minimum version.
function toFirefox(manifest) {
  const ff = structuredClone(manifest);
  ff.background = { scripts: ['src/shared.js', 'src/background.js'] };
  ff.browser_specific_settings = {
    gecko: {
      id: GECKO_ID,
      strict_min_version: FIREFOX_MIN_VERSION,
      // This bridge relays throw data tab-to-tab and stores nothing about the
      // user; declare no data collection (now required by AMO).
      data_collection_permissions: { required: ['none'] },
    },
  };
  return ff;
}

function build(target, manifest) {
  const out = `${DIST}/${target}`;
  mkdirSync(out, { recursive: true });

  // Copy the static extension payload verbatim.
  for (const entry of ['src', 'icons', 'LICENSE', 'README.md']) {
    cpSync(entry, `${out}/${entry}`, { recursive: true });
  }
  writeFileSync(`${out}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);

  // Fail the build loudly rather than ship a bad package: no localhost may
  // survive, and every icon the manifest references must actually exist.
  const serialized = JSON.stringify(manifest);
  const leaked = LOCALHOST.filter((m) => serialized.includes(m));
  if (leaked.length) {
    throw new Error(`[${target}] manifest still references localhost: ${leaked.join(', ')}`);
  }
  const missingIcons = Object.values(manifest.icons ?? {}).filter(
    (rel) => !existsSync(`${out}/${rel}`),
  );
  if (missingIcons.length) {
    throw new Error(`[${target}] manifest references missing icons: ${missingIcons.join(', ')}`);
  }

  console.log(`Built ${out}/ — "${manifest.name}" v${manifest.version}`);
  console.log(`  host_permissions: ${manifest.host_permissions.join(', ')}`);
}

const chrome = baseManifest();
build('chrome', chrome);
build('firefox', toFirefox(chrome));
