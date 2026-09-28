import { describe, expect, it } from 'vitest';
import { createPingJobRequest, parseJsonBody, problem, validationProblem } from '../src/index.js';

describe('http helpers', () => {
  it('builds RFC 9457 problems', () => {
    const res = problem(404, 'Not found', { requestId: 'r1' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toBe('application/problem+json');
    expect(JSON.parse(res.body)).toEqual({
      type: 'about:blank',
      title: 'Not found',
      status: 404,
      requestId: 'r1',
    });
  });

  it('lists validation issues without echoing input', () => {
    const parsed = createPingJobRequest.safeParse({ fail: 'yes', extra: 1 });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const body = JSON.parse(validationProblem(parsed.error).body);
    expect(body.status).toBe(400);
    expect(body.errors.length).toBeGreaterThan(0);
  });

  it('parses bodies safely', () => {
    expect(parseJsonBody(undefined)).toEqual({});
    expect(parseJsonBody('{"fail":true}')).toEqual({ fail: true });
    expect(parseJsonBody(Buffer.from('{"a":1}').toString('base64'), true)).toEqual({ a: 1 });
    expect(parseJsonBody('{not json')).toBeUndefined();
  });
});
