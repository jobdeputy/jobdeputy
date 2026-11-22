import { describe, expect, it } from 'vitest';
import { printable, RESUME_HEADINGS, resumeBlocks, type StructuredResume } from '../src/resume.js';

const full: StructuredResume = {
  contact: {
    name: 'Sam Example',
    headline: 'Backend engineer',
    email: 'sam@example.com',
    phone: '(555) 010-1234',
    location: 'Leeds, UK',
    links: ['github.com/sam-example'],
  },
  summary: 'Backend engineer with 5 years on AWS.',
  skills: [
    { group: 'Languages', items: ['TypeScript', 'SQL'] },
    { group: 'Cloud', items: ['AWS Lambda'] },
  ],
  experience: [
    {
      id: 'e1',
      employer: 'Example Logistics',
      title: 'Software Engineer',
      location: 'Leeds, UK',
      start: 'Mar 2022',
      end: 'Present',
      bullets: ['Built REST APIs.', 'Cut latency by 40%.'],
    },
    { id: 'e2', employer: 'Example Agency', title: 'Junior Developer', bullets: [] },
  ],
  education: [
    {
      id: 'd1',
      school: 'University of Example',
      degree: 'BSc',
      field: 'Computer Science',
      end: '2019',
      details: ['First-class honours'],
    },
    {
      id: 'd2',
      school: 'Example College',
      degree: 'MSc in Data Science',
      field: 'Data Science',
      details: [],
    },
  ],
  certifications: [{ id: 'c1', name: 'AWS Certified Developer', issuer: 'AWS', date: '2023' }],
  projects: [{ id: 'p1', name: 'Queue monitor', link: 'github.com/sam/qm', bullets: ['A CLI.'] }],
};

describe('resumeBlocks', () => {
  it('lays out every section in order, one block per line', () => {
    expect(resumeBlocks(full)).toEqual([
      { kind: 'name', text: 'Sam Example' },
      { kind: 'line', text: 'Backend engineer' },
      {
        kind: 'line',
        text: 'sam@example.com | (555) 010-1234 | Leeds, UK | github.com/sam-example',
      },
      { kind: 'heading', text: 'Summary' },
      { kind: 'paragraph', text: 'Backend engineer with 5 years on AWS.' },
      { kind: 'heading', text: 'Skills' },
      { kind: 'skills', group: 'Languages', items: 'TypeScript, SQL' },
      { kind: 'skills', group: 'Cloud', items: 'AWS Lambda' },
      { kind: 'heading', text: 'Experience' },
      { kind: 'entry', text: 'Software Engineer, Example Logistics' },
      { kind: 'meta', text: 'Leeds, UK | Mar 2022 – Present' },
      { kind: 'bullet', text: 'Built REST APIs.' },
      { kind: 'bullet', text: 'Cut latency by 40%.' },
      { kind: 'entry', text: 'Junior Developer, Example Agency' },
      { kind: 'heading', text: 'Education' },
      { kind: 'entry', text: 'BSc in Computer Science, University of Example' },
      { kind: 'meta', text: '2019' },
      { kind: 'bullet', text: 'First-class honours' },
      { kind: 'entry', text: 'MSc in Data Science, Example College' },
      { kind: 'heading', text: 'Certifications' },
      { kind: 'paragraph', text: 'AWS Certified Developer, AWS, 2023' },
      { kind: 'heading', text: 'Projects' },
      { kind: 'entry', text: 'Queue monitor' },
      { kind: 'meta', text: 'github.com/sam/qm' },
      { kind: 'bullet', text: 'A CLI.' },
    ]);
  });

  it('leaves out empty sections and contact lines', () => {
    const blocks = resumeBlocks({
      contact: { name: 'Sam Example', links: [] },
      skills: [],
      experience: [{ id: 'e1', employer: 'Acme', title: 'Dev', bullets: [] }],
      education: [],
      certifications: [],
      projects: [],
    });
    expect(blocks).toEqual([
      { kind: 'name', text: 'Sam Example' },
      { kind: 'heading', text: RESUME_HEADINGS.experience },
      { kind: 'entry', text: 'Dev, Acme' },
    ]);
  });
});

describe('printable', () => {
  it('removes what XML 1.0 forbids, keeping every other character', () => {
    expect(printable('Ada\u0002 Love\u0007lace￾')).toBe('Ada Lovelace');
    expect(printable('a\tb\nc')).toBe('a b c');
    expect(printable('lone \uD800 surrogate')).toBe('lone  surrogate');
    expect(printable('Łukasz 😀 “quotes” – é')).toBe('Łukasz 😀 “quotes” – é');
  });

  it('is applied to every block', () => {
    const blocks = resumeBlocks({
      contact: { name: 'Sam\u0002 Example', headline: '\u0007', links: [] },
      summary: 'Sum\u0000mary',
      skills: [{ group: 'To\u0001ols', items: ['G\u0003o'] }],
      experience: [
        { id: 'e1', employer: 'Ac\u0004me', title: 'Dev', bullets: ['Bu\u0005ilt', '\u0006'] },
      ],
      education: [],
      certifications: [],
      projects: [],
    });
    expect(JSON.stringify(blocks)).not.toMatch(/\\u000[0-7]/);
    expect(blocks).toContainEqual({ kind: 'name', text: 'Sam Example' });
    expect(blocks.filter((b) => b.kind === 'bullet')).toEqual([{ kind: 'bullet', text: 'Built' }]);
    expect(blocks.some((b) => b.kind === 'line')).toBe(false);
  });
});
