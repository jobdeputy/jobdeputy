import { describe, expect, it } from 'vitest';
import {
  confirmationPosting,
  contentPosting,
  fromOwnPage,
  fromSite,
  isConfirmationRequest,
  isContentRequest,
  isExternalRequest,
  isRequest,
} from '../src/messages.ts';

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
    expect(contentPosting({ id: ID, url: FORM, tab: {} }, ID)).toEqual({
      companyKey: 'greenhouse:acme',
      postingId: '4001001',
    });
    expect(contentPosting({ id: 'someone-else', url: FORM, tab: {} }, ID)).toBeNull();
    expect(contentPosting({ id: ID, url: FORM }, ID)).toBeNull();
    expect(
      contentPosting({ id: ID, url: 'https://evil.test/acme/jobs/1', tab: {} }, ID),
    ).toBeNull();
    expect(contentPosting({ id: ID, tab: {} }, ID)).toBeNull();
  });

  it("follows the board's in-page navigation in the top frame (the tab's address)", () => {
    const board = 'https://job-boards.greenhouse.io/acme';
    // Opened on the board, then a job without a page load: Chrome's sender.url is still the board.
    expect(contentPosting({ id: ID, url: board, frameId: 0, tab: { url: FORM } }, ID)).toEqual({
      companyKey: 'greenhouse:acme',
      postingId: '4001001',
    });
    expect(contentPosting({ id: ID, url: FORM, frameId: 0, tab: { url: board } }, ID)).toBeNull();
    // Without the tab's address (no host permission for it), nothing: the loaded address may be
    // another job.
    expect(contentPosting({ id: ID, url: FORM, frameId: 0, tab: {} }, ID)).toBeNull();
    // In a company site's frame, the frame's own address: the tab is the company's site.
    expect(
      contentPosting(
        { id: ID, url: FORM, frameId: 7, tab: { url: 'https://careers.acme.test/jobs' } },
        ID,
      ),
    ).toEqual({ companyKey: 'greenhouse:acme', postingId: '4001001' });
  });

  it('asks only for fill data', () => {
    expect(isContentRequest({ type: 'fill-data' })).toBe(true);
    for (const other of [{ type: 'status' }, { type: 'sign-in' }, null, 'fill-data']) {
      expect(isContentRequest(other)).toBe(false);
    }
  });
});

describe('the web app (#54 PR D, decision 0020)', () => {
  const SITE = 'https://app.jobdeputy.test';
  const JOB = 'a'.repeat(32);
  const URL = 'https://job-boards.greenhouse.io/acme/jobs/1';

  it("answers only the site's origins, in a tab's top frame", () => {
    expect(fromSite({ origin: SITE, frameId: 0, tab: {} }, [SITE])).toBe(true);
    expect(fromSite({ origin: 'https://evil.example', frameId: 0, tab: {} }, [SITE])).toBe(false);
    expect(fromSite({ origin: SITE, frameId: 3, tab: {} }, [SITE])).toBe(false);
    expect(fromSite({ origin: SITE, frameId: 0 }, [SITE])).toBe(false);
    expect(fromSite({ frameId: 0, tab: {} }, [SITE])).toBe(false);
    expect(fromSite({ origin: SITE, frameId: 0, tab: {} }, [])).toBe(false);
  });

  it('knows only hello and auto-apply, exactly as sent', () => {
    expect(isExternalRequest({ type: 'hello' })).toBe(true);
    expect(isExternalRequest({ type: 'auto-apply', jobId: JOB, url: URL })).toBe(true);
    for (const value of [
      null,
      'hello',
      { type: 'hello', extra: 1 },
      { type: 'status' },
      { type: 'fill-data' },
      { type: 'auto-apply', jobId: JOB },
      { type: 'auto-apply', jobId: 'A'.repeat(32), url: URL },
      { type: 'auto-apply', jobId: JOB, url: 7 },
      { type: 'auto-apply', jobId: JOB, url: `${URL}?${'x'.repeat(2048)}` },
      { type: 'auto-apply', jobId: JOB, url: URL, tabId: 1 },
    ]) {
      expect(isExternalRequest(value), JSON.stringify(value)?.slice(0, 80)).toBe(false);
    }
  });
});

describe('confirmation pages (#54 PR D)', () => {
  const DONE = 'https://job-boards.greenhouse.io/acme/jobs/4001001/confirmation';

  it('knows its requests apart from the forms', () => {
    for (const type of ['auto-fill', 'application', 'record-application']) {
      expect(isContentRequest({ type })).toBe(true);
    }
    expect(isConfirmationRequest({ type: 'application' })).toBe(true);
    expect(isConfirmationRequest({ type: 'record-application' })).toBe(true);
    expect(isConfirmationRequest({ type: 'fill-data' })).toBe(false);
    expect(isConfirmationRequest({ type: 'auto-fill' })).toBe(false);
  });

  it("answers only the tab's own address in its top frame", () => {
    const posting = { companyKey: 'greenhouse:acme', postingId: '4001001' };
    expect(confirmationPosting({ id: ID, frameId: 0, tab: { url: DONE } }, ID)).toEqual(posting);
    expect(confirmationPosting({ id: ID, frameId: 2, tab: { url: DONE } }, ID)).toBeNull();
    expect(confirmationPosting({ id: 'other', frameId: 0, tab: { url: DONE } }, ID)).toBeNull();
    expect(confirmationPosting({ id: ID, frameId: 0 }, ID)).toBeNull();
    // The form itself is not a confirmation.
    expect(
      confirmationPosting(
        { id: ID, frameId: 0, tab: { url: 'https://job-boards.greenhouse.io/acme/jobs/4001001' } },
        ID,
      ),
    ).toBeNull();
  });
});
