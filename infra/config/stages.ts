import type { CellId } from './cells.js';

export type StageName = 'dev' | 'prod';

export interface StageConfig {
  readonly name: StageName;
  readonly cells: readonly CellId[];
}

/** Dev runs only in the US; prod runs in all three cells (created at launch). */
export const STAGES: Record<StageName, StageConfig> = {
  dev: { name: 'dev', cells: ['iad'] },
  prod: { name: 'prod', cells: ['iad', 'bom', 'lhr'] },
};

export function isStageName(value: unknown): value is StageName {
  return value === 'dev' || value === 'prod';
}

/**
 * Account IDs are never committed (the repo is public). They come from
 * environment variables such as JD_ACCOUNT_DEV_IAD.
 */
export function accountEnvVar(stage: StageName, cell: CellId): string {
  return `JD_ACCOUNT_${stage.toUpperCase()}_${cell.toUpperCase()}`;
}
