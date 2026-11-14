import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from '../src/components/ui/button.tsx';

afterEach(cleanup);

describe('Button', () => {
  it('renders a native button by default', () => {
    render(<Button>Sign in</Button>);
    expect(screen.getByRole('button', { name: 'Sign in' }).tagName).toBe('BUTTON');
  });

  it('renders its child instead when asChild is set, keeping the button look', () => {
    render(
      <Button asChild>
        <a href="/signup">Get started</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Get started' });
    expect(link.getAttribute('data-slot')).toBe('button');
    expect(link.className).toContain('rounded-full');
  });

  it('lets a caller class override a variant class', () => {
    render(<Button className="min-h-14">Wide</Button>);
    const button = screen.getByRole('button', { name: 'Wide' });
    expect(button.className).toContain('min-h-14');
    expect(button.className).not.toContain('min-h-10');
  });

  it('does not submit a form unless it is the submit button', () => {
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
    render(
      <form onSubmit={(event) => onSubmit(event.nativeEvent as SubmitEvent)}>
        <Button>Cancel</Button>
        <Button type="submit">Save</Button>
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('lets a caller remove the control shadow', () => {
    render(<Button className="shadow-none">Flat</Button>);
    const button = screen.getByRole('button', { name: 'Flat' });
    expect(button.className).toContain('shadow-none');
    expect(button.className).not.toContain('shadow-control');
  });

  describe('pending and success', () => {
    function pendingButton(props: { pending?: boolean; success?: boolean; onClick?: () => void }) {
      return (
        <Button pendingLabel="Signing in…" successLabel="Signed in" {...props}>
          Sign in
        </Button>
      );
    }

    afterEach(() => vi.useRealTimers());

    it('ignores presses at once, but shows the spinner and pending label only after 300 ms', () => {
      vi.useFakeTimers();
      const onClick = vi.fn();
      render(pendingButton({ pending: true, onClick }));
      const button = screen.getByRole('button');
      expect(button.getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(button);
      expect(onClick).not.toHaveBeenCalled();
      expect(button.textContent).toBe('Sign in');
      expect(button.hasAttribute('aria-busy')).toBe(false);

      act(() => vi.advanceTimersByTime(300));
      expect(button.textContent).toBe('Signing in…');
      expect(button.getAttribute('aria-busy')).toBe('true');
      expect(button.hasAttribute('data-pending')).toBe(true);
      expect(button.querySelector('[data-slot="spinner"]')).not.toBeNull();
    });

    it('keeps focus while pending: aria-disabled, never the disabled attribute', () => {
      vi.useFakeTimers();
      const { rerender } = render(pendingButton({}));
      const button = screen.getByRole('button');
      button.focus();
      rerender(pendingButton({ pending: true }));
      act(() => vi.advanceTimersByTime(300));
      expect(button.hasAttribute('disabled')).toBe(false);
      expect(document.activeElement).toBe(button);
    });

    it('does not submit its form while pending', () => {
      const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
      render(
        <form onSubmit={(event) => onSubmit(event.nativeEvent as SubmitEvent)}>
          <Button type="submit" pending>
            Save
          </Button>
        </form>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('takes presses again as soon as the work ends, while the spinner finishes its hold', () => {
      vi.useFakeTimers();
      const onClick = vi.fn();
      const { rerender } = render(pendingButton({ pending: true, onClick }));
      act(() => vi.advanceTimersByTime(350));
      rerender(pendingButton({ onClick }));
      const button = screen.getByRole('button');
      expect(button.hasAttribute('data-pending')).toBe(true);
      expect(button.hasAttribute('aria-disabled')).toBe(false);
      fireEvent.click(button);
      expect(onClick).toHaveBeenCalledOnce();
    });

    it('shows a ✓ and the success label, and ignores presses, on success', () => {
      const onClick = vi.fn();
      render(pendingButton({ success: true, onClick }));
      const button = screen.getByRole('button', { name: 'Signed in' });
      expect(button.textContent).toBe('✓Signed in');
      expect(button.hasAttribute('data-success')).toBe(true);
      expect(button.hasAttribute('aria-busy')).toBe(false);
      fireEvent.click(button);
      expect(onClick).not.toHaveBeenCalled();
    });

    it('does not go back to pending when success clears during the spinner hold', () => {
      vi.useFakeTimers();
      const { rerender } = render(pendingButton({ pending: true }));
      act(() => vi.advanceTimersByTime(350));
      rerender(pendingButton({ success: true }));
      rerender(pendingButton({}));
      const button = screen.getByRole('button');
      expect(button.textContent).toBe('Sign in');
      expect(button.hasAttribute('data-pending')).toBe(false);
      expect(button.hasAttribute('aria-busy')).toBe(false);
      // New work after that shows pending again.
      rerender(pendingButton({ pending: true }));
      act(() => vi.advanceTimersByTime(300));
      expect(button.textContent).toBe('Signing in…');
    });

    it('ignores presses and dims while the caller marks it unavailable', () => {
      const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
      render(
        <form onSubmit={(event) => onSubmit(event.nativeEvent as SubmitEvent)}>
          <Button type="submit" aria-disabled>
            Save
          </Button>
        </form>,
      );
      const button = screen.getByRole('button', { name: 'Save' });
      fireEvent.click(button);
      expect(onSubmit).not.toHaveBeenCalled();
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.hasAttribute('data-unavailable')).toBe(true);
      expect(button.hasAttribute('disabled')).toBe(false);
    });

    it('keeps a blocked press from its other handlers and from a clickable parent', () => {
      const onPointerDown = vi.fn();
      const onKeyDown = vi.fn();
      const onParentClick = vi.fn();
      render(
        // biome-ignore lint/a11y/noStaticElementInteractions: a stand-in for a clickable row.
        // biome-ignore lint/a11y/useKeyWithClickEvents: the test only needs the click.
        <div onClick={onParentClick}>
          <Button pending onPointerDown={onPointerDown} onKeyDown={onKeyDown}>
            Open menu
          </Button>
        </div>,
      );
      const button = screen.getByRole('button');
      fireEvent.pointerDown(button);
      fireEvent.keyDown(button, { key: 'Enter' });
      fireEvent.click(button);
      expect(onPointerDown).not.toHaveBeenCalled();
      expect(onKeyDown).not.toHaveBeenCalled();
      expect(onParentClick).not.toHaveBeenCalled();
    });

    it('stops a blocked press bubbling, but lets Tab and Escape through', () => {
      const parentKeys: string[] = [];
      const onParentPointerDown = vi.fn();
      render(
        // biome-ignore lint/a11y/noStaticElementInteractions: a stand-in for a row or dialog.
        <div onKeyDown={(event) => parentKeys.push(event.key)} onPointerDown={onParentPointerDown}>
          <Button pending>Save</Button>
        </div>,
      );
      const button = screen.getByRole('button');
      for (const key of ['Enter', ' ', 'Tab', 'Escape']) fireEvent.keyDown(button, { key });
      fireEvent.pointerDown(button);
      expect(parentKeys).toEqual(['Tab', 'Escape']);
      // Reaches the document, so an open popover still closes.
      expect(onParentPointerDown).toHaveBeenCalledOnce();
    });

    it('passes a rendered child its own aria-disabled, without taking over its presses', () => {
      const onClick = vi.fn((event: React.MouseEvent) => event.preventDefault());
      render(
        <Button asChild aria-disabled>
          <a href="/x" onClick={onClick}>
            Docs
          </a>
        </Button>,
      );
      const link = screen.getByRole('link');
      expect(link.getAttribute('aria-disabled')).toBe('true');
      expect(link.hasAttribute('data-unavailable')).toBe(false);
      fireEvent.click(link);
      expect(onClick).toHaveBeenCalledOnce();
    });

    it('shows only the spinner, then only the ✓, on a round icon button', () => {
      vi.useFakeTimers();
      const { rerender } = render(
        <Button size="icon" aria-label="Close" pending>
          ×
        </Button>,
      );
      act(() => vi.advanceTimersByTime(300));
      const button = screen.getByRole('button', { name: 'Close' });
      expect(button.textContent).toBe('');
      expect(button.querySelector('[data-slot="spinner"]')).not.toBeNull();
      rerender(
        <Button size="icon" aria-label="Close" success>
          ×
        </Button>,
      );
      expect(button.textContent).toBe('✓');
    });

    it('keeps its label when no pending label is given', () => {
      vi.useFakeTimers();
      render(<Button pending>Save</Button>);
      act(() => vi.advanceTimersByTime(300));
      expect(screen.getByRole('button').textContent).toBe('Save');
    });

    it('cannot be pending when it renders its child', () => {
      // @ts-expect-error: a link has no pending state; the types forbid it.
      const element = <Button asChild pending />;
      expect(element).toBeTruthy();
    });
  });
});
