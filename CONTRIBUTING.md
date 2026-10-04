# Contributing

Short on purpose. Every rule here cites the reason beside it; a rule without one is a reminder, and reminders are not followed.

## What belongs here

A workflow or action belongs here when a second repository would run it unchanged. A step that only one repository needs stays in that repository, even if it is pinned and documented the same way. The test: if a consumer would have to fork it to use it, it is not shared yet.

Two shapes, chosen by one rule:

- **A reusable workflow** (`on: workflow_call`) when the unit is a whole job with its own runner, permissions and timeout, and it needs no files from this repository beyond the YAML itself. `security.yml` and `workflow-lint.yml` are this shape.
- **A composite action** (`.github/actions/<name>/action.yml`) when the unit is a step, or when it runs a script from this repository. A composite action's files are checked out with it at the caller's pin, so the script and the YAML move together. A reusable workflow cannot reference a sibling action at the caller's pin (a `uses:` inside it needs a hard-coded ref), which is why the script-backed checks are all actions.

## Scripts

- Plain Node, no dependencies, importable for the test and runnable as a command. Node 22 or newer; `path.matchesGlob` and `parseArgs` are the floor.
- Every input through an argument or an environment variable. Nothing read from `${{ }}` inside a `run:` block: a composite action's inputs are text a caller wrote.
- Every script has a `*.test.mjs` beside it, run with `node --test`. A rule the test does not pin is a rule the next edit can quietly change.
- A check prints `::error::` lines a reader can act on, each saying what to change, and returns its exit code from one function so the test can measure it in-process.
- An allowlist or exceptions file a check reads must fail on an entry nothing needs any more, so the file cannot rot.

## Pins

Every `uses:` is `owner/action@<40-hex sha> # vX.Y.Z`. A tag is a pointer its owner can move over a job holding a checkout; the comment is not decoration, Dependabot reads it and rewrites both halves. Container images, where used, are `image@sha256:… # tag` for the same reason.

## Branches, commits, pull requests

- Branch `<type>/<short-description>-<issue-number>`, type one of `feature`, `fix`, `refactor`, `docs`, `ci`, `chore`. The `pr-hygiene` action enforces it here as it does everywhere else. Label a typo-sized change `no-issue`.
- Commit subject in the imperative, body says **why**, including what the choice cost.
- Before opening a pull request: `npm test`, and run the changed action or workflow from a branch of a consuming repository pinned to your branch's sha. The unit tests prove the script; only a real run proves the YAML around it.
- Add a line under `Unreleased` in `CHANGELOG.md` saying what a consumer gets from bumping.

## Releasing

Consumers pin a commit sha; the tag is how Dependabot learns that commit has a version, and how a human reads the pin.

1. Move `Unreleased` in `CHANGELOG.md` to `## x.y.z — YYYY-MM-DD`, bump `version` in `package.json`, and merge that through a pull request.
2. Tag the merge commit and move the major tag:

   ```bash
   git tag -a vx.y.z <sha> -m "Release x.y.z"
   git tag -f vx <sha>
   git push origin vx.y.z
   git push -f origin vx
   ```

3. Dependabot proposes the bump in every consumer over the following week (the cooldown is seven days on purpose).

Versioning is SemVer over the inputs, outputs and verdicts: a new input with a default is a minor; a check that newly fails on something it passed before is a major, because every consumer's `main` can go red on the bump.
