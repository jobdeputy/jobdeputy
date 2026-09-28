import type { PingJob } from '@jobdeputy/db';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { type Deps, route } from '../src/ping-jobs.js';

const JOB: PingJob = {
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  type: 'ping',
  status: 'queued',
  attempts: 0,
  sideEffectCount: 0,
  createdAt: 't',
  updatedAt: 't',
  schemaVersion: 1,
  ttl: 1,
};

function event(routeKey: string, extra: Partial<APIGatewayProxyEventV2> = {}) {
  return {
    routeKey,
    requestContext: { requestId: 'req-1' },
    isBase64Encoded: false,
    ...extra,
  } as unknown as APIGatewayProxyEventV2;
}

function deps(
  stage = 'dev',
): Deps & { repo: { create: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> } } {
  return { stage, repo: { create: vi.fn(async () => JOB), get: vi.fn(async () => JOB) } };
}

describe('POST /ping-jobs', () => {
  it('queues a job and returns 202 with its ID', async () => {
    const d = deps();
    const res = await route(event('POST /ping-jobs'), d);
    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body)).toEqual({ id: JOB.id, status: 'queued' });
    expect(d.repo.create).toHaveBeenCalledWith({});
  });

  it('passes the dev-only fail flag', async () => {
    const d = deps();
    await route(event('POST /ping-jobs', { body: '{"fail":true}' }), d);
    expect(d.repo.create).toHaveBeenCalledWith({ fail: true });
  });

  it('rejects the fail flag outside dev', async () => {
    const d = deps('prod');
    const res = await route(event('POST /ping-jobs', { body: '{"fail":true}' }), d);
    expect(res.statusCode).toBe(400);
    expect(d.repo.create).not.toHaveBeenCalled();
  });

  it.each([['{bad'], ['{"fail":"yes"}'], ['{"unknown":1}']])('rejects body %s', async (body) => {
    const res = await route(event('POST /ping-jobs', { body }), deps());
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toBe('application/problem+json');
  });
});

describe('GET /ping-jobs/{id}', () => {
  it('returns the status', async () => {
    const res = await route(
      event('GET /ping-jobs/{id}', { pathParameters: { id: JOB.id } }),
      deps(),
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ id: JOB.id, status: 'queued', attempts: 0 });
  });

  it('rejects IDs that are not UUIDs', async () => {
    const res = await route(
      event('GET /ping-jobs/{id}', { pathParameters: { id: '../x' } }),
      deps(),
    );
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for unknown jobs', async () => {
    const d = deps();
    d.repo.get.mockResolvedValueOnce(undefined);
    const res = await route(event('GET /ping-jobs/{id}', { pathParameters: { id: JOB.id } }), d);
    expect(res.statusCode).toBe(404);
  });
});
