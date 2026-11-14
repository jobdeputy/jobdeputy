import { describe, expect, it } from 'vitest';
import { fillHtmlCopy } from '../html-copy.ts';
import { en } from '../src/copy/en.ts';

describe('fillHtmlCopy', () => {
  it('fills each slot with its text from en.ts', () => {
    expect(fillHtmlCopy('<p title="{{copy.boot.progressLabel}}">{{copy.boot.status}}</p>')).toBe(
      `<p title="${en.boot.progressLabel}">${en.boot.status}</p>`,
    );
  });

  it('escapes the text, so copy cannot break the markup', () => {
    const copy = { line: `Tom & Jerry's "<b>"` };
    expect(fillHtmlCopy('<p title="{{copy.line}}">', 'test.html', copy)).toBe(
      '<p title="Tom &amp; Jerry&#39;s &quot;&lt;b&gt;&quot;">',
    );
  });

  it('reaches into lists by index', () => {
    expect(fillHtmlCopy('{{copy.landing.steps.items.0.title}}')).toBe(
      en.landing.steps.items[0].title,
    );
  });

  it('fails the build for a slot that names no text', () => {
    expect(() => fillHtmlCopy('{{copy.boot.missing}}', '/gallery.html')).toThrow(
      '/gallery.html names {{copy.boot.missing}}',
    );
    expect(() => fillHtmlCopy('{{copy.boot}}')).toThrow();
  });

  it('leaves everything else alone', () => {
    expect(fillHtmlCopy('<!-- {{copy.*}} --> {{other}}')).toBe('<!-- {{copy.*}} --> {{other}}');
  });
});
