// Font files bundled as bytes: esbuild's `binary` loader in the Lambda bundle
// (infra/lib/constructs/node-function.ts), and the same in tests (vitest.config.ts).
declare module '*.ttf' {
  const bytes: Uint8Array;
  export default bytes;
}
