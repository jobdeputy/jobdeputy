import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type UserManifest } from 'wxt';
import { manifestFor } from './src/manifest.ts';
import { readSettings } from './src/settings.ts';

// #54 (decision 0020): the Chrome extension, Manifest V3, built with WXT (Firefox and Safari
// later, #55). The manifest lives in src/manifest.ts so a test holds it to least privilege. WXT
// has read the `.env*` files into process.env by the time it asks for the manifest.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // Plain string lists in src/manifest.ts (held by its test); Chrome checks the names.
  manifest: () =>
    manifestFor(readSettings(process.env), {
      store: process.env.JD_STORE_BUILD === '1',
    }) as UserManifest,
  vite: () => ({
    plugins: [tailwindcss()],
    // Every build but the store's is a dev build, and says so (src/build.ts).
    define: { __JD_DEV_BUILD__: JSON.stringify(process.env.JD_STORE_BUILD !== '1') },
  }),
});
