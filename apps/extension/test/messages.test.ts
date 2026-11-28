import { describe, expect, it } from 'vitest';
import { contentPosting, fromOwnPage, isContentRequest, isRequest } from '../src/messages.ts';

const ID = 'pkdigeiognmabnigddaekkkmecnaiadf';

describe('messages to the service worker (#54, decision 0020)', () => {
  it("answers only the extension's own pages", () => {
    expect(fromOwnPage({ id: ID, url: `chrome-extension://${ID}/popup.html` }, ID)).toBe(true);
    // A content script in a job site's page: it has a tab.
    expect(fromOwnPage({ id: ID, url: 'https://boards.greenhouse.io/x' }, ID)).toBe(false);
    // The popup opened in a tab of its own is still one of our pages.
    expect(fromOwnPage({ id: ID, url: `chrome-extension://${ID}/popup.html` }, ID)).toBe(true);
    expect(fromOwnPage({ id: ID, url: `chrome-extension://${ID}x/popup.html` }, ID)).toBe(false);
    // Another extension, or a page claiming to be ours.
    expect(fromOwnPage({ id: 'other', url: 'chrome-extension://other/popup.html' }, ID)).toBe(
      false,
    );
    expect(fromOwnPage({ id: ID, url: 'https://evil.example/' }, ID)).toBe(false);
    expect(fromOwnPage({ id: ID }, ID)).toBe(false);
  });

  it('knows only its own requests', () => {
    for (const type of ['status', 'sign-in', 'sign-in-wait', 'sign-out', 'readiness']) {
      expect(isRequest({ type })).toBe(true);
    }
    for (const value of [null, undefined, 'status', {}, { type: 'token' }, { type: 'fill' }]) {
      expect(isRequest(value)).toBe(false);
    }
  });
});

describe('content scripts (#54 PR C)', () => {
  const FORM = 'https://job-boards.greenhouse.io/acme/jobs/4001001';

  it('answers only a tab of ours on a Greenhouse form, for the posting of its own address', () => {
    expect(contentPosting({ id: ID, url: FORM, tab: { id: 3 } }, ID)).toEqual({
      companyKey: 'greenhouse:acme',
      postingId: '4001001',
    });
    expect(contentPosting({ id: 'someone-else', url: FORM, tab: { id: 3 } }, ID)).toBeNull();
    expect(contentPosting({ id: ID, url: FORM }, ID)).toBeNull();
    expect(
      contentPosting({ id: ID, url: 'https://evil.test/acme/jobs/1', tab: {} }, ID),
    ).toBeNull();
    expect(contentPosting({ id: ID, tab: {} }, ID)).toBeNull();
  });

  it('asks only for fill data', () => {
    expect(isContentRequest({ type: 'fill-data' })).toBe(true);
    for (const other of [{ type: 'status' }, { type: 'sign-in' }, null, 'fill-data']) {
      expect(isContentRequest(other)).toBe(false);
    }
  });
});
