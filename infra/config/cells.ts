/**
 * Region cells (decision 0004). Each cell is a self-contained deployment;
 * user data never leaves its cell's Region.
 */
export const CELLS = {
  iad: { region: 'us-east-1', label: 'United States' },
  bom: { region: 'ap-south-1', label: 'India' },
  lhr: { region: 'eu-west-2', label: 'United Kingdom' },
} as const;

export type CellId = keyof typeof CELLS;

export const ALL_REGIONS: readonly string[] = Object.values(CELLS).map((c) => c.region);
