import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

// npx runs a `bin` through the `node_modules/.bin/<name>` symlink, so
// `process.argv[1]` is the link while `import.meta.url` is the real file. A
// main guard that compares the two without resolving the link skips the check
// and exits 0 in silence (#4). Each script here runs through a link, from an
// empty directory, where every one of them has something to say: either a
// finding, a failure, or a verdict. Silence means the guard skipped it.
const root = path.resolve(import.meta.dirname, '../..');
const bins = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).bin;
const scratch = mkdtempSync(path.join(tmpdir(), 'shared-workflows-bin-'));
const linkDir = path.join(scratch, 'node_modules', '.bin');
const emptyCwd = path.join(scratch, 'project');
mkdirSync(linkDir, { recursive: true });
mkdirSync(emptyCwd);

after(() => rmSync(scratch, { recursive: true, force: true }));

describe('every bin, run through a symlink as npx runs it', () => {
  for (const [name, target] of Object.entries(bins)) {
    it(`${name} runs its check rather than exiting in silence`, () => {
      const link = path.join(linkDir, name);
      symlinkSync(path.join(root, target), link);
      const env = { ...process.env };
      delete env.GITHUB_EVENT_PATH;
      const run = spawnSync(process.execPath, [link], { cwd: emptyCwd, env, encoding: 'utf8' });
      assert.notEqual(`${run.stdout}${run.stderr}`.trim(), '', `${name} printed nothing and exited ${run.status}`);
    });
  }
});
