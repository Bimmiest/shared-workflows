// The second test passes only after the first: it reads the state that the
// first test leaves. Thus the file passes in file order, and fails with a seed
// that runs the second test first. ci.yml gives such a seed.
import { expect, test } from 'vitest';

let ready = false;

test('sets up', () => {
  ready = true;
  expect(ready).toBe(true);
});

test('needs the setup', () => {
  expect(ready).toBe(true);
});
