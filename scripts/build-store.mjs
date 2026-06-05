// Builds the Chrome Web Store package into dist/.
//
// The committed manifest.json keeps http://localhost + http://127.0.0.1 host
// permissions so that "Load unpacked → select this folder" works for local
// development against `npm run dev` (:3000) out of the box. The published store
// build must NOT ship those localhost permissions (reviewers flag them), so this
// script copies the extension into dist/ and strips them from dist/manifest.json.
//
// Usage: node scripts/build-store.mjs
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const LOCALHOST = ['http://localhost/*', 'http://127.0.0.1/*'];
const DIST = 'dist';

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// Copy the static extension payload verbatim.
for (const entry of ['src', 'icons', 'LICENSE', 'README.md']) {
  cpSync(entry, `${DIST}/${entry}`, { recursive: true });
}

// Copy the manifest with localhost host permissions / content-script matches stripped.
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const strip = (arr) => (Array.isArray(arr) ? arr.filter((m) => !LOCALHOST.includes(m)) : arr);

manifest.host_permissions = strip(manifest.host_permissions);
for (const cs of manifest.content_scripts ?? []) {
  cs.matches = strip(cs.matches);
}

writeFileSync(`${DIST}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);

// Fail the build loudly rather than ship a bad package: no localhost may survive,
// and every icon the manifest references must actually exist in dist/.
const serialized = JSON.stringify(manifest);
const leaked = LOCALHOST.filter((m) => serialized.includes(m));
if (leaked.length) {
  throw new Error(`Store manifest still references localhost: ${leaked.join(', ')}`);
}
const missingIcons = Object.values(manifest.icons ?? {}).filter(
  (rel) => !existsSync(`${DIST}/${rel}`),
);
if (missingIcons.length) {
  throw new Error(`Manifest references missing icons: ${missingIcons.join(', ')}`);
}

console.log(`Built ${DIST}/ — store manifest "${manifest.name}" v${manifest.version}`);
console.log(`host_permissions: ${manifest.host_permissions.join(', ')}`);
