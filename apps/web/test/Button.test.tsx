import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
});
