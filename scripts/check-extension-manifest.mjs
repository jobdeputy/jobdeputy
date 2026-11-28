// #54 (decision 0020): the built extension asks for exactly what src/manifest.ts gives for the
// same build settings, so the least-privilege test on that file covers what ships. Run after
// `wxt build`, with the build's environment (the CI variables, or apps/extension/.env.local).
import { readFileSync } from 'node:fs';

const built = JSON.parse(
  readFileSync(new URL('../apps/extension/.output/chrome-mv3/manifest.json', import.meta.url)),
);
const { manifestFor } = await import('../apps/extension/src/manifest.ts');
const { readSettings } = await import('../apps/extension/src/settings.ts');
const { buildEnv } = await import('../apps/extension/build-env.ts');
const env = buildEnv();
const manifest = manifestFor(readSettings(env), { store: env.JD_STORE_BUILD === '1' });
const same = (a = [], b = []) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const keys = [
  'permissions',
  'host_permissions',
  'optional_permissions',
  'optional_host_permissions',
];
const wrong = keys.filter((key) => !same(built[key], manifest[key]));
// The fixed ID's public key in a dev build only; a store build has none.
if (built.key !== manifest.key) wrong.push('key');
// A static content script's matches are granted at install: they must be hosts granted at
// install too. Content scripts for optional hosts are registered at runtime, once granted.
const granted = new Set(manifest.host_permissions ?? []);
const strays = (built.content_scripts ?? []).flatMap((script) =>
  script.matches.filter((match) => !granted.has(match)),
);
// Any other way to reach pages or be reached (web_accessible_resources, externally_connectable,
// content script globs, …) is refused until a decision allows it here.
const KNOWN = new Set([
  'manifest_version',
  'key',
  'name',
  'description',
  'version',
  'version_name',
  'icons',
  'action',
  'background',
  'content_scripts',
  ...keys,
]);
const unknown = Object.keys(built).filter((key) => !KNOWN.has(key));
// Each content script only says where (matches), what (js, css) and when (run_at), and (0020,
// #54 PR C) whether it runs in frames too: a company site embeds Greenhouse's form in a frame of
// a host it already matches. No globs, page world, or about:/blob: fallbacks until a decision
// allows them.
const SCRIPT_KEYS = new Set(['matches', 'js', 'css', 'run_at', 'all_frames']);
const globs = (built.content_scripts ?? []).filter((script) =>
  Object.keys(script).some((key) => !SCRIPT_KEYS.has(key)),
);
if (wrong.length > 0 || strays.length > 0 || unknown.length > 0 || globs.length > 0) {
  console.error('Built manifest differs from src/manifest.ts:', { wrong, strays, unknown, globs });
  process.exit(1);
}
console.log(
  'Built manifest matches src/manifest.ts:',
  keys.map((k) => `${k}=${JSON.stringify(built[k] ?? [])}`).join(' '),
);
