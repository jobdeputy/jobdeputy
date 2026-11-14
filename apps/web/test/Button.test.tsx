import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
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
    render(<Button className="h-14">Wide</Button>);
    const button = screen.getByRole('button', { name: 'Wide' });
    expect(button.className).toContain('h-14');
    expect(button.className).not.toContain('h-10');
  });
});
