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
