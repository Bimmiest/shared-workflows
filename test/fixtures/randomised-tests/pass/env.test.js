// Each test holds without the others, so it passes in each order. The
// expected values are the defaults of the action, so the test also fails
// when the tz or lang input does not get to the test.
import { expect, test } from 'vitest';

test('TZ is the zone of the tz input', () => {
  expect(process.env.TZ).toBe('America/Los_Angeles');
  expect(new Date('2026-01-15T12:00:00Z').getTimezoneOffset()).toBe(480);
});

test('LANG is the locale of the lang input', () => {
  expect(process.env.LANG).toBe('de_DE.UTF-8');
});
