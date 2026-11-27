import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Popup } from '../src/popup.tsx';

afterEach(cleanup);

describe('Popup (#54 shell)', () => {
  it('says what the extension is for, and its version', () => {
    render(<Popup version="0.1.0" />);
    expect(screen.getByRole('heading', { level: 1, name: 'JobDeputy' })).toBeTruthy();
    expect(screen.getByText(/You review and click Submit/)).toBeTruthy();
    expect(screen.getByText('Version 0.1.0')).toBeTruthy();
  });
});
