import { describe, expect, it } from 'vitest';
import { parsePercent } from './parse.js';

describe('parsePercent', () => {
  it('reads a number, and keeps it from 0 to 100', () => {
    expect(parsePercent(' 42 ')).toBe(42);
    expect(parsePercent('120')).toBe(100);
    expect(parsePercent('x')).toBeNull();
  });
});
