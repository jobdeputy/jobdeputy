import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmPanel, untilText } from '../src/greenhouse/confirm.tsx';
import type { Application } from '../src/record.ts';

afterEach(() => {
  cleanup();
});

const answer = (application: Application | null) => vi.fn(async () => application);

describe('the panel on a confirmation page (#54 PR D)', () => {
  it('asks to mark a New job as applied, and records it on one click', async () => {
    const read = answer({ state: 'ask', title: 'Senior Engineer', companyName: 'Acme' });
    const record = answer({ state: 'saved' });
    render(<ConfirmPanel trusted={() => true} read={read} record={record} />);
    expect(screen.getByText('Checking your JobDeputy list…')).toBeTruthy();
    expect(
      await screen.findByText(
        'You applied to Senior Engineer at Acme. Mark it as applied in JobDeputy?',
      ),
    ).toBeTruthy();
    expect(record).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Mark as applied' }));
    expect(
      await screen.findByText('Marked as applied. You’ll find it in Applications in JobDeputy.'),
    ).toBeTruthy();
    expect(record).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Mark as applied' })).toBeNull();
  });

  it('without a company name, asks about the title alone', async () => {
    render(
      <ConfirmPanel
        trusted={() => true}
        read={answer({ state: 'ask', title: 'SRE' })}
        record={answer(null)}
      />,
    );
    expect(
      await screen.findByText('You applied to SRE. Mark it as applied in JobDeputy?'),
    ).toBeTruthy();
  });

  it.each([
    [{ state: 'moved-on' }, 'Already marked in JobDeputy, so there’s nothing to record.'],
    [
      { state: 'not-listed' },
      'This job isn’t in your JobDeputy list, so there’s nothing to record.',
    ],
  ] as const)('says there is nothing to record: %o', async (application, line) => {
    render(<ConfirmPanel trusted={() => true} read={answer(application)} record={answer(null)} />);
    expect(await screen.findByRole('status')).toHaveProperty('textContent', line);
    expect(screen.queryByRole('button', { name: 'Mark as applied' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('a cooldown says until when, and records nothing', async () => {
    const until = '2026-12-20T15:30:00.000Z';
    render(
      <ConfirmPanel
        trusted={() => true}
        read={answer({ state: 'ask', title: 'SRE', companyName: 'Acme' })}
        record={answer({ state: 'cooling-down', until })}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Mark as applied' }));
    expect(
      await screen.findByText(
        `Not recorded: you’ve reached your application limit for this company until ${untilText(until) ?? ''}.`,
      ),
    ).toBeTruthy();
  });

  it('a failed record can be tried again, as the record (not the read)', async () => {
    const read = answer({ state: 'ask', title: 'SRE' });
    const record = vi
      .fn<() => Promise<Application | null>>()
      .mockResolvedValueOnce({ state: 'offline' })
      .mockResolvedValueOnce({ state: 'saved' });
    render(<ConfirmPanel trusted={() => true} read={read} record={record} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Mark as applied' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Couldn’t reach JobDeputy. Check your connection and try again.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/Marked as applied/)).toBeTruthy();
    expect(read).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(2);
  });

  it('signed out, or the worker failing, says so; trying again reads again', async () => {
    const read = vi
      .fn<() => Promise<Application | null>>()
      .mockResolvedValueOnce({ state: 'signed-out' })
      .mockResolvedValueOnce(null);
    render(<ConfirmPanel trusted={() => true} read={read} record={answer(null)} />);
    // Signed out is not an error: said, not alerted.
    expect((await screen.findByRole('status')).textContent).toMatch(
      /Sign in from the JobDeputy button/,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Couldn’t record this application. Try again.',
    );
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('Not now hides it to a small button that brings it back', async () => {
    render(
      <ConfirmPanel
        trusted={() => true}
        read={answer({ state: 'ask', title: 'SRE' })}
        record={answer(null)}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('region')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'JobDeputy' }));
    expect(screen.getByRole('button', { name: 'Mark as applied' })).toBeTruthy();
  });
});

describe('the confirmation panel guards (#54 PR D review)', () => {
  it("never records from a click the page's scripts made", async () => {
    const record = answer({ state: 'saved' });
    render(<ConfirmPanel read={answer({ state: 'ask', title: 'SRE' })} record={record} />);
    // Testing Library's click is untrusted, as a page script's would be.
    fireEvent.click(await screen.findByRole('button', { name: 'Mark as applied' }));
    expect(record).not.toHaveBeenCalled();
  });

  it("nor from Try again after a failed record, when the page's scripts click it", async () => {
    let trust = true;
    const record = vi
      .fn<() => Promise<Application | null>>()
      .mockResolvedValue({ state: 'offline' });
    render(
      <ConfirmPanel
        trusted={() => trust}
        read={answer({ state: 'ask', title: 'SRE' })}
        record={record}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Mark as applied' }));
    await screen.findByRole('alert');
    trust = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('shows nothing in a build that cannot sign in', async () => {
    const read = answer({ state: 'unconfigured' });
    const { container } = render(<ConfirmPanel read={read} record={answer(null)} />);
    await vi.waitFor(() => expect(read).toHaveBeenCalled());
    await vi.waitFor(() => expect(container.innerHTML).toBe(''));
  });

  it('a cooldown with an unreadable date says so without one', async () => {
    expect(untilText('soon')).toBeNull();
    render(
      <ConfirmPanel
        trusted={() => true}
        read={answer({ state: 'ask', title: 'SRE' })}
        record={answer({ state: 'cooling-down', until: 'soon' })}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Mark as applied' }));
    expect(
      await screen.findByText(
        'Not recorded: you’ve reached your application limit for this company.',
      ),
    ).toBeTruthy();
  });
});
