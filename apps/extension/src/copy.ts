/** The extension's words (as the web app's live in its copy/en.ts). */
export const copy = {
  popup: {
    title: 'JobDeputy',
    line: 'Your deputy fills in job applications with your saved answers. You review and click Submit.',
    soon: 'Sign-in comes next.',
    version: 'Version {version}',
  },
};

export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
