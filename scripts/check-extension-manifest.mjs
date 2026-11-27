// #54 (decision 0020): the built extension asks for exactly what src/manifest.ts lists, so the
// least-privilege test on that file covers what ships. Run after `wxt build`.
import { readFileSync } from 'node:fs';

const built = JSON.parse(
  readFileSync(new URL('../apps/extension/.output/chrome-mv3/manifest.json', import.meta.url)),
);
const { manifest } = await import('../apps/extension/src/manifest.ts');
const same = (a = [], b = []) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const keys = [
  'permissions',
  'host_permissions',
  'optional_permissions',
  'optional_host_permissions',
];
const wrong = keys.filter((key) => !same(built[key], manifest[key]));
// A static content script's matches are granted at install: they must be hosts granted at
// install too. Content scripts for optional hosts are registered at runtime, once granted.
const granted = new Set(manifest.host_permissions ?? []);
const strays = (built.content_scripts ?? []).flatMap((script) =>
  script.matches.filter((match) => !granted.has(match)),
);
if (wrong.length > 0 || strays.length > 0) {
  console.error('Built manifest differs from src/manifest.ts:', { wrong, strays });
  process.exit(1);
}
console.log(
  'Built manifest matches src/manifest.ts:',
  keys.map((k) => `${k}=${JSON.stringify(built[k] ?? [])}`).join(' '),
);
