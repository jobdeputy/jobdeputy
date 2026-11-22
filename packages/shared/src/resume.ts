import { z } from 'zod';

// #51 (decision 0015): a résumé as structured data. The base résumé is structured once (PR B),
// tailoring rewrites only its summary, skills, and bullets, and the files and the preview are
// all rendered from this one shape, so what the user previews is what they send.

const text = (max: number) => z.string().trim().min(1).max(max);
/** Short IDs (`e1`, `d1`, `c1`, `p1`) that tailoring uses to refer to base entries. */
const entryId = z.string().regex(/^[a-z]\d{1,2}$/);

export const resumeContact = z
  .object({
    name: text(120),
    headline: text(160).optional(),
    email: text(254).optional(),
    phone: text(40).optional(),
    location: text(120).optional(),
    links: z.array(text(300)).max(4),
  })
  .strict();

export const resumeSkillGroup = z
  .object({
    /** For example "Languages" or "Cloud". */
    group: text(40),
    items: z.array(text(60)).min(1).max(20),
  })
  .strict();

export const resumeExperience = z
  .object({
    id: entryId,
    employer: text(120),
    title: text(120),
    location: text(120).optional(),
    /** As the résumé writes them, for example "Mar 2021" or "2019". */
    start: text(40).optional(),
    end: text(40).optional(),
    bullets: z.array(text(400)).max(10),
  })
  .strict();

export const resumeEducation = z
  .object({
    id: entryId,
    school: text(160),
    degree: text(160).optional(),
    field: text(160).optional(),
    start: text(40).optional(),
    end: text(40).optional(),
    details: z.array(text(300)).max(4),
  })
  .strict();

export const resumeCertification = z
  .object({
    id: entryId,
    name: text(160),
    issuer: text(120).optional(),
    date: text(40).optional(),
  })
  .strict();

export const resumeProject = z
  .object({
    id: entryId,
    name: text(120),
    link: text(300).optional(),
    bullets: z.array(text(400)).max(6),
  })
  .strict();

export const structuredResume = z
  .object({
    contact: resumeContact,
    summary: text(800).optional(),
    skills: z.array(resumeSkillGroup).max(8),
    experience: z.array(resumeExperience).max(12),
    education: z.array(resumeEducation).max(6),
    certifications: z.array(resumeCertification).max(10),
    projects: z.array(resumeProject).max(8),
  })
  .strict();

export type StructuredResume = z.infer<typeof structuredResume>;
export type ResumeExperience = z.infer<typeof resumeExperience>;
export type ResumeSkillGroup = z.infer<typeof resumeSkillGroup>;

/**
 * The words a reader (or an ATS) sees, one piece per line, contact excluded: what the match
 * score reads and what the honesty checks compare against.
 */
export function resumeText(resume: StructuredResume): string {
  const optional = (...values: (string | undefined)[]) =>
    values.filter((v): v is string => v !== undefined);
  return [
    ...optional(resume.contact.headline, resume.summary),
    ...resume.skills.flatMap((g) => [g.group, ...g.items]),
    ...resume.experience.flatMap((e) => [
      ...optional(e.title, e.employer, e.location),
      ...e.bullets,
    ]),
    ...resume.education.flatMap((d) => [...optional(d.degree, d.field, d.school), ...d.details]),
    ...resume.certifications.flatMap((c) => optional(c.name, c.issuer)),
    ...resume.projects.flatMap((p) => [p.name, ...p.bullets]),
  ].join('\n');
}

/**
 * One piece of the ATS-safe template (decision 0015): a single column, standard headings,
 * plain text. The PDF, the DOCX, and the in-app preview all lay out these blocks, in order.
 */
export type ResumeBlock =
  | { kind: 'name'; text: string }
  /** The headline, then the contact line. */
  | { kind: 'line'; text: string }
  | { kind: 'heading'; text: string }
  /** An entry's first line, for example "Software Engineer, Example Logistics". */
  | { kind: 'entry'; text: string }
  /** An entry's place and dates, or a project's link. */
  | { kind: 'meta'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'paragraph'; text: string }
  /** A skills line: "Languages: TypeScript, SQL". */
  | { kind: 'skills'; group: string; items: string };

/** The section headings, in order; ATSs look for these words. */
export const RESUME_HEADINGS = {
  summary: 'Summary',
  skills: 'Skills',
  experience: 'Experience',
  education: 'Education',
  certifications: 'Certifications',
  projects: 'Projects',
} as const;

/**
 * Text a file can hold: no control characters (tabs and line breaks become spaces), no
 * U+FFFE or U+FFFF, and no lone surrogates. XML 1.0 forbids them, so a DOCX with one is
 * reported as corrupt; PDF text extraction can leave them in a résumé's text.
 */
export function printable(text: string): string {
  return (
    text
      // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point.
      .replace(/[\t\n\r\v\f]/g, ' ')
      // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point.
      .replace(/[\u0000-\u001f\u007f\ufffe\uffff]/g, '')
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
  );
}

const joined = (separator: string, ...values: (string | undefined)[]) =>
  values
    .map((v) => (v === undefined ? '' : printable(v).trim()))
    .filter((v) => v !== '')
    .join(separator);

/** "BSc in Computer Science"; the field once when the degree already names it. */
function degreeText(degree?: string, field?: string): string {
  if (degree && field && degree.toLowerCase().includes(field.toLowerCase())) return degree;
  return joined(' in ', degree, field);
}

/** The résumé as the template's blocks; empty sections are left out. */
export function resumeBlocks(resume: StructuredResume): ResumeBlock[] {
  const c = resume.contact;
  const blocks: ResumeBlock[] = [{ kind: 'name', text: joined('', c.name) }];
  const headline = joined('', c.headline);
  if (headline) blocks.push({ kind: 'line', text: headline });
  const contact = joined(' | ', c.email, c.phone, c.location, ...c.links);
  if (contact) blocks.push({ kind: 'line', text: contact });
  const section = (heading: string, body: ResumeBlock[]) => {
    if (body.length > 0) blocks.push({ kind: 'heading', text: heading }, ...body);
  };
  const dates = (start?: string, end?: string) => joined(' – ', start, end);
  const meta = (...values: (string | undefined)[]): ResumeBlock[] => {
    const text = joined(' | ', ...values);
    return text ? [{ kind: 'meta', text }] : [];
  };
  const bullets = (items: string[]): ResumeBlock[] =>
    items
      .map((item) => joined('', item))
      .filter(Boolean)
      .map((text) => ({ kind: 'bullet', text }));

  section(
    RESUME_HEADINGS.summary,
    resume.summary ? [{ kind: 'paragraph', text: joined('', resume.summary) }] : [],
  );
  section(
    RESUME_HEADINGS.skills,
    resume.skills.map((g) => ({
      kind: 'skills',
      group: joined('', g.group),
      items: joined(', ', ...g.items),
    })),
  );
  section(
    RESUME_HEADINGS.experience,
    resume.experience.flatMap((e) => [
      { kind: 'entry', text: joined(', ', e.title, e.employer) } as const,
      ...meta(e.location, dates(e.start, e.end)),
      ...bullets(e.bullets),
    ]),
  );
  section(
    RESUME_HEADINGS.education,
    resume.education.flatMap((d) => [
      { kind: 'entry', text: joined(', ', degreeText(d.degree, d.field), d.school) } as const,
      ...meta(dates(d.start, d.end)),
      ...bullets(d.details),
    ]),
  );
  section(
    RESUME_HEADINGS.certifications,
    resume.certifications.map((x) => ({
      kind: 'paragraph',
      text: joined(', ', x.name, x.issuer, x.date),
    })),
  );
  section(
    RESUME_HEADINGS.projects,
    resume.projects.flatMap((p) => [
      { kind: 'entry', text: joined('', p.name) } as const,
      ...meta(p.link),
      ...bullets(p.bullets),
    ]),
  );
  return blocks;
}
