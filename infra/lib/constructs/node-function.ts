import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { type BundlingOptions, NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** How every function is bundled (esbuild); infra/test/bundling.test.ts runs a bundle made with it. */
export const BUNDLING = {
  format: OutputFormat.ESM,
  target: 'node22',
  sourceMap: true,
  minify: true,
  // The AWS SDK v3 ships with the Lambda runtime.
  externalModules: ['@aws-sdk/*'],
  // `require` for packages that call it in an ES module bundle.
  banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  // #51: fonts imported as bytes (the résumé PDF embeds Roboto; apps/worker/src/fonts.d.ts).
  loader: { '.ttf': 'binary' } as const,
} satisfies BundlingOptions;

/**
 * #51: the banner of functions that render résumés (AppFunction `banner`): also CommonJS's
 * `__filename` and `__dirname` (no end slash, as in CommonJS), which pdfkit reads when it
 * loads. Only these functions get them, so no other function's dependencies see them.
 */
export const RENDER_BANNER = [
  "import { createRequire } from 'module';",
  "import { fileURLToPath as __jdFileURLToPath } from 'url';",
  "import { dirname as __jdDirname } from 'path';",
  'const require = createRequire(import.meta.url);',
  'const __filename = __jdFileURLToPath(import.meta.url);',
  'const __dirname = __jdDirname(__filename);',
].join(' ');

/**
 * A file inside a dependency's dependency, found the way Node finds it from `from` (a package
 * directory in the repo): `chain` names each package in turn, the last with the file's path.
 */
export function packageFile(from: string, chain: readonly string[]): string {
  let at = join(REPO_ROOT, from, 'package.json');
  for (const name of chain) at = createRequire(at).resolve(name);
  return at;
}

/**
 * #51: files the résumé renderers read from disk beside their code, which esbuild leaves out:
 * fontkit's line-breaking data (`unicode-properties` reads `./data.trie` next to the module, so
 * next to the bundle). For AppFunction `copyFiles`.
 */
export function renderFiles(): string[] {
  return [
    packageFile('apps/worker', ['pdfmake', 'pdfkit', 'fontkit', 'unicode-properties/data.trie']),
  ];
}

/**
 * #51: what a function that renders résumés needs, both together: spread it into its
 * AppFunction props (`...RENDERS_RESUMES`). pdfkit reads `__dirname` and fontkit reads
 * `data.trie` beside the bundle; one without the other fails at cold start.
 */
export const RENDERS_RESUMES = { banner: RENDER_BANNER, copyFiles: renderFiles } as const;

export interface AppFunctionProps {
  /** Path from the repo root, for example `apps/api/src/ping-jobs.ts`. */
  readonly entry: string;
  readonly timeout: Duration;
  readonly memorySize?: number;
  readonly environment?: Record<string, string>;
  readonly removalPolicy: RemovalPolicy;
  /**
   * Replaces BUNDLING's banner (#51: RENDERS_RESUMES). It must still define `require`
   * (createRequire), as BUNDLING's does: the constructor refuses one that does not.
   */
  readonly banner?: string;
  /**
   * Files copied beside the bundle, for code that reads them at run time (#51:
   * renderFiles()). A function, so the paths are resolved only when this function is built.
   */
  readonly copyFiles?: () => readonly string[];
}

/** Node 22 on ARM64, bundled with esbuild, logs kept 14 days (decision 0005). */
export class AppFunction extends Construct {
  readonly fn: NodejsFunction;

  constructor(scope: Construct, id: string, props: AppFunctionProps) {
    super(scope, id);
    if (props.banner !== undefined && !props.banner.includes('createRequire(import.meta.url)')) {
      throw new Error(`${id}: a banner must define require (see BUNDLING.banner)`);
    }
    const logGroup = new LogGroup(this, 'Logs', {
      retention: RetentionDays.TWO_WEEKS,
      removalPolicy: props.removalPolicy,
    });
    this.fn = new NodejsFunction(this, 'Fn', {
      entry: join(REPO_ROOT, props.entry),
      projectRoot: REPO_ROOT,
      depsLockFilePath: join(REPO_ROOT, 'pnpm-lock.yaml'),
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: props.memorySize ?? 256,
      timeout: props.timeout,
      logGroup,
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        POWERTOOLS_LOG_LEVEL: 'INFO',
        ...props.environment,
      },
      bundling: {
        ...BUNDLING,
        ...(props.banner ? { banner: props.banner } : {}),
        ...(props.copyFiles
          ? {
              commandHooks: {
                beforeBundling: () => [],
                beforeInstall: () => [],
                // Paths from the input directory, so this works in Docker bundling too.
                afterBundling: (inputDir: string, outputDir: string) =>
                  (props.copyFiles?.() ?? []).map(
                    (file) => `cp "${join(inputDir, relative(REPO_ROOT, file))}" "${outputDir}/"`,
                  ),
              },
            }
          : {}),
      },
    });
  }
}
