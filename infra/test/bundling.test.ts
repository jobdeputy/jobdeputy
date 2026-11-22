import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { build } from 'esbuild';
import { afterAll, describe, expect, it } from 'vitest';
import {
  BUNDLING,
  RENDER_BANNER,
  REPO_ROOT,
  renderFiles,
} from '../lib/constructs/node-function.js';

// #51: the résumé renderers run from a Lambda bundle, not from node_modules. A dependency that
// reads a file beside its own code (unicode-properties' data.trie) works in tests and fails in
// Lambda unless the file is copied beside the bundle (AppFunction's rendersResumes). This bundles
// them exactly as AppFunction does and runs the bundle alone, in an empty folder.

const out = mkdtempSync(join(tmpdir(), 'jd-bundle-'));
afterAll(() => rmSync(out, { recursive: true, force: true }));

/** esbuild's own options from the CDK ones (the subset BUNDLING uses). */
const options = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: BUNDLING.target,
  minify: BUNDLING.minify,
  external: BUNDLING.externalModules,
  banner: { js: BUNDLING.banner },
  loader: BUNDLING.loader,
  logLevel: 'silent',
} as const;

/** Bundles `contents` as a function that renders résumés (AppFunction rendersResumes). */
async function bundle(contents: string, copy: readonly string[]): Promise<string> {
  await build({
    ...options,
    banner: { js: RENDER_BANNER },
    stdin: {
      contents,
      resolveDir: join(REPO_ROOT, 'apps/worker/src'),
      loader: 'ts',
      sourcefile: 'entry.ts',
    },
    outfile: join(out, 'index.mjs'),
  });
  for (const file of copy) copyFileSync(file, join(out, basename(file)));
  return execFileSync(process.execPath, [join(out, 'index.mjs')], {
    cwd: out,
    encoding: 'utf8',
    timeout: 30_000,
  });
}

const entry = `
import { renderResumeDocx } from './tailoring/render-docx.js';
import { renderResumePdf } from './tailoring/render-pdf.js';
const resume = {
  contact: { name: 'Łukasz Example', links: [] },
  skills: [{ group: 'Tools', items: ['Go'] }],
  experience: [{ id: 'e1', employer: 'Acme', title: 'Engineer', bullets: ['Certified the workflow.'] }],
  education: [], certifications: [], projects: [],
};
const pdf = await renderResumePdf(resume);
const docx = await renderResumeDocx(resume);
console.log(JSON.stringify({ pdf: pdf.subarray(0, 5).toString(), pdfBytes: pdf.length, docx: docx.subarray(0, 2).toString() }));
`;

describe('Lambda bundling (#51)', () => {
  it('runs the résumé renderers from the bundle, with the files they read beside it', async () => {
    const result = JSON.parse(await bundle(entry, renderFiles())) as Record<string, unknown>;
    expect(result).toMatchObject({ pdf: '%PDF-', docx: 'PK' });
    expect(result.pdfBytes).toBeGreaterThan(5_000);
  }, 60_000);

  it('needs those files: without them the PDF cannot be laid out', async () => {
    rmSync(out, { recursive: true, force: true });
    await expect(bundle(entry, [])).rejects.toThrow(/data\.trie/);
  }, 60_000);

  it('gives __dirname without an end slash, as CommonJS does', async () => {
    const dir = await bundle('console.log(JSON.stringify([__dirname, __filename]));', []);
    const [dirname, filename] = JSON.parse(dir) as [string, string];
    expect(dirname.endsWith('/')).toBe(false);
    expect(filename).toBe(join(dirname, 'index.mjs'));
  }, 60_000);

  it('keeps every function parseable: the banners clash with nothing bundled', async () => {
    // Every `entry: 'apps/…'` in infra/lib, bundled as its function is, then parsed by Node.
    const entries = new Set<string>();
    const scan = (dir: string) => {
      for (const f of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, f.name);
        if (f.isDirectory()) scan(path);
        else
          for (const m of readFileSync(path, 'utf8').matchAll(/entry: '([^']+)'/g))
            entries.add(m[1] as string);
      }
    };
    scan(join(REPO_ROOT, 'infra/lib'));
    expect(entries.size).toBeGreaterThan(10);
    for (const entry of entries) {
      const outfile = join(out, 'check', `${entry.replace(/\W/g, '_')}.mjs`);
      for (const banner of [BUNDLING.banner, RENDER_BANNER]) {
        await build({
          ...options,
          banner: { js: banner },
          entryPoints: [join(REPO_ROOT, entry)],
          outfile,
        });
        execFileSync(process.execPath, ['--check', outfile]);
      }
    }
  }, 120_000);
});
