import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';

afterEach(cleanup);

describe('App', () => {
  it('names the product in the page heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'JobDeputy' })).toBeTruthy();
  });
});
