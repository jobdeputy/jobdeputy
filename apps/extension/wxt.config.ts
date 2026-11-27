import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';
import { manifest } from './src/manifest.ts';

// #54 (decision 0020): the Chrome extension, Manifest V3, built with WXT (Firefox and Safari
// later, #55). The manifest lives in src/manifest.ts so a test holds it to least privilege.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest,
  vite: () => ({ plugins: [tailwindcss()] }),
});
