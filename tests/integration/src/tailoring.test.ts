import { makeDocx } from '@jobdeputy/test-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  callApi,
  createTestUser,
  stackOutputs,
  type TestUser,
  uploadDocument,
  waitFor,
  waitForMalwareScanning,
} from './stack.js';

/**
 * Deployed wiring of #51: POST /me/tailorings → a generated version in documents → the documents
 * stream → its Pipe → the tailoring worker → the résumé structured, the job's keywords, a tailored
 * draft, the PDF and DOCX in S3 → the version ready, with its scores and downloads. Uses the
 * dev-only `stub` provider (packages/llm tailoring-stub.ts: fixed rules, no call leaves AWS), so
 * the result is the same every run. Prompts, honesty checks, limits, and failures are unit-tested.
 */
let api: string;
let testSite: string;
let user: TestUser;

// Built from repeated letters, so no secret scanner mistakes it for a real key.
const STUB_KEY = `stub-tailoring-${'x'.repeat(8)}-valid`;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

beforeAll(async () => {
  const outputs = await stackOutputs();
  api = outputs.ApiUrl ?? '';
  testSite = outputs.TestSiteUrl ?? '';
  await waitForMalwareScanning(outputs);
  user = await createTestUser(outputs);
}, 360_000);

afterAll(async () => {
  await user?.delete();
});

describe('tailored résumés (deployed)', () => {
  it('makes a version for a company’s shown job: scores, the résumé, a PDF and a DOCX', async () => {
    const token = user.accessToken;
    const ok = (res: { status: number; body: unknown }, status: number) =>
      expect(res.status, JSON.stringify(res.body)).toBe(status);

    ok(
      await callApi(api, 'PUT', 'me/profile', token, {
        version: 0,
        firstName: 'Sam',
        lastName: 'Example',
        headline: 'Backend developer',
      }),
      200,
    );
    ok(await callApi(api, 'POST', 'me/roles', token, { title: 'Backend Engineer' }), 201);
    ok(
      await callApi(api, 'PUT', 'me/ai-keys/stub', token, {
        apiKey: STUB_KEY,
        modelId: 'stub-model',
        consent: true,
      }),
      202,
    );

    // A résumé in the stub's layout (one paragraph per line); the first upload is the default.
    const { documentId: baseId } = await uploadDocument(
      api,
      user,
      'cv.docx',
      DOCX,
      makeDocx([
        'Sam Example',
        'Backend developer',
        'Software Engineer, Example Logistics',
        '• Built REST APIs in TypeScript.',
        'Skills: TypeScript, Node.js',
        'Education: University of Example',
      ]),
    );
    await waitFor(
      async () => {
        const res = await callApi(api, 'GET', 'me/documents', token);
        const doc = res.body.documents?.find(
          (d: { documentId: string }) => d.documentId === baseId,
        );
        return doc?.status === 'ready' ? true : undefined;
      },
      { timeoutMs: 300_000, intervalMs: 3_000 },
    );
    await waitFor(
      async () => {
        const res = await callApi(api, 'GET', 'me/ai-keys', token);
        return res.body.keys?.[0]?.status === 'valid' ? true : undefined;
      },
      { timeoutMs: 90_000, intervalMs: 2_000 },
    );

    // A crawl scored by the stub shows the Backend Engineer job (relevance.test.ts).
    const crawl = await callApi(api, 'POST', 'me/crawls', token, {
      url: new URL('test-site/jobs-schema-org', testSite).href,
      aiSource: 'stub',
    });
    ok(crawl, 202);
    await waitFor(
      async () => {
        const res = await callApi(api, 'GET', `me/crawls/${crawl.body.crawlId}`, token);
        const done = res.body.relevance?.status === 'done' || res.body.status === 'failed';
        return done ? res.body : undefined;
      },
      { timeoutMs: 180_000, intervalMs: 3_000 },
    );
    const companies = await callApi(api, 'GET', 'me/companies', token);
    const company = companies.body.companies?.[0];
    expect(company?.jobs.map((j: { title: string }) => j.title)).toEqual(['Backend Engineer']);

    // Tailor: queued, and a second click for the same company waits for it.
    const asked = await callApi(api, 'POST', 'me/tailorings', token, {
      companyKey: company.companyKey,
      aiSource: 'stub',
    });
    ok(asked, 202);
    const documentId = asked.body.tailoring.documentId as string;
    expect(asked.body.tailoring).toMatchObject({ status: 'queued', baseDocumentId: baseId });
    const again = await callApi(api, 'POST', 'me/tailorings', token, {
      companyKey: company.companyKey,
      aiSource: 'stub',
    });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('tailoring_busy');

    const version = await waitFor(
      async () => {
        const res = await callApi(api, 'GET', `me/tailorings/${documentId}`, token);
        return res.body.status === 'ready' || res.body.status === 'failed' ? res.body : undefined;
      },
      { timeoutMs: 240_000, intervalMs: 3_000 },
    );
    // The stub keeps the résumé as it is: honest, and the same score as the base.
    expect(version).toMatchObject({
      status: 'ready',
      result: 'partial',
      fileName: 'Sam Example – Example Test Co.pdf',
      resume: {
        contact: { name: 'Sam Example', headline: 'Backend developer' },
        experience: [{ id: 'e1', employer: 'Example Logistics', title: 'Software Engineer' }],
      },
    });
    expect(version.scores).toHaveLength(1);
    expect(version.scores[0].tailored).toBe(version.scores[0].base);
    expect(version.scores[0].missingUnproven).toContain('AWS');

    // Both files download from their 5-minute links.
    const pdf = new Uint8Array(await (await fetch(version.downloads.pdf)).arrayBuffer());
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-');
    const docx = new Uint8Array(await (await fetch(version.downloads.docx)).arrayBuffer());
    expect(new TextDecoder().decode(docx.slice(0, 2))).toBe('PK');

    // Listed for its company; never with the uploads; three tasks counted on the own key.
    const list = await callApi(
      api,
      'GET',
      `me/tailorings?companyKey=${encodeURIComponent(company.companyKey)}`,
      token,
    );
    expect(list.body.tailorings.map((t: { documentId: string }) => t.documentId)).toEqual([
      documentId,
    ]);
    expect(list.body.allowance.used).toBe(0);
    const docs = await callApi(api, 'GET', 'me/documents', token);
    expect(docs.body.documents.map((d: { documentId: string }) => d.documentId)).toEqual([baseId]);
    const usage = await callApi(api, 'GET', 'me/ai-usage', token);
    const stub = usage.body.models.find((m: { provider: string }) => m.provider === 'stub');
    expect(Object.keys(stub.byTask).sort()).toEqual([
      'job-keywords',
      'relevance',
      'structure-resume',
      'tailor-resume',
    ]);
  });
});
