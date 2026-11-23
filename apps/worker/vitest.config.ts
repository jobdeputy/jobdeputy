import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Font files load as bytes, as esbuild's `binary` loader does in the Lambda bundle
// (src/fonts.d.ts), so the renderers run the same code in tests and in Lambda.
export default defineConfig({
  plugins: [
    {
      name: 'binary-fonts',
      enforce: 'pre',
      load(id) {
        if (!id.endsWith('.ttf')) return null;
        const base64 = readFileSync(id).toString('base64');
        return `export default new Uint8Array(Buffer.from(${JSON.stringify(base64)}, 'base64'));`;
      },
    },
  ],
});
