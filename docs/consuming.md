---
type: how-to
---

# How to consume the checks

This file tells a consumer repository how to pin the checks, how to update
the pin, and how to run a check on your own machine. To start a new
repository, use [`repo-template`](https://github.com/Bimmiest/repo-template).
The template has all of this already.

## Pin a commit

Each `uses:` names a full commit SHA, with the version in a comment after it:

```yaml
uses: Bimmiest/shared-workflows/.github/actions/docs-check@<sha> # vX.Y.Z
```

The SHA is the pin. The owner of a tag can move the tag while a job holds a
checkout, but a SHA cannot move. The comment is for Dependabot. It reads the
comment to find the version of the pin, and it changes the SHA and the
comment together.

To find the SHA of a release:

```bash
git ls-remote https://github.com/Bimmiest/shared-workflows 'refs/tags/v1.1.0^{}'
```

Keep the `^{}`. A release tag is an annotated tag. Without `^{}`, the command
gives the SHA of the tag object, not of the commit.

## Update the pin

Dependabot proposes the bump when a release is tagged. The consumer must
have a `github-actions` entry in `.github/dependabot.yml`, and the cooldown
is seven days.

1. Read the [CHANGELOG](../CHANGELOG.md) entries between the two versions.
2. If the major version changes, expect a check to fail on something that it
   passed before. The entry says what to change.
3. Merge the bump when CI is green.

Change all the pins to this repository in the same change. Two pins to two
versions in one repository give two sets of rules.

## Give each check what it needs

- **Node.** A composite action runs the `node` on the `PATH` of the runner.
  Call it after `actions/setup-node` or `setup-node-project`. Node 22 or
  later.
- **Permissions.** The caller job gives the permissions. `security.yml` needs
  `contents: read` and `pull-requests: read`. `scorecard.yml` needs
  `contents: read`, `actions: read`, `id-token: write` and
  `security-events: write`. `mutation.yml` needs `contents: read` and
  `actions: read`. `open-or-update-issue` needs `issues: write`. The other
  checks need only `contents: read`.
- **A token for the settings check.** `repo-settings-check` needs a
  fine-grained token with "Administration: read" on the repository, as a
  secret. One token can cover each repository of an owner.
- **A schedule.** Security, supply-chain and settings checks can fail with no
  push. Run them each week, or each month for `node-patch-check`.
- **The files that a check reads.** [catalogue.md](catalogue.md) names them.
  Each file is optional, except where the catalogue says otherwise.

## Run the advisory Dependabot review

`dependabot-review-facts` and `dependabot-review` give each Dependabot pull
request one comment with advice: what in the release notes can break the
places that use each package. The review does not read the code of the
packages, and the comment says so. The comment is never a check result, and
nothing merges because of it. Use two jobs, so that the credential and the
code of the pull request are never in one job:

```yaml
name: Dependabot review
on:
  pull_request:
    types: [opened, reopened, labeled]
permissions: {}
concurrency:
  group: dependabot-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true
jobs:
  facts:
    if: >-
      (github.event.pull_request.user.login == 'dependabot[bot]' || contains(github.event.pull_request.labels.*.name, 'claude-review'))
      && !startsWith(github.head_ref, 'dependabot/github_actions/')
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@<sha> # vX.Y.Z
        with:
          fetch-depth: 2
          persist-credentials: false
      - uses: actions/setup-node@<sha> # vX.Y.Z
        with:
          node-version-file: .nvmrc
      - uses: Bimmiest/shared-workflows/.github/actions/dependabot-review-facts@<sha> # vX.Y.Z
      - uses: actions/upload-artifact@<sha> # vX.Y.Z
        with:
          name: dependabot-review-facts
          path: dependabot-review-facts.json
  review:
    needs: facts
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      id-token: write
      pull-requests: write
    steps:
      - uses: actions/download-artifact@<sha> # vX.Y.Z
        with:
          name: dependabot-review-facts
      - uses: Bimmiest/shared-workflows/.github/actions/dependabot-review@<sha> # vX.Y.Z
        with:
          federation-rule-id: fdrl_...
          organization-id: <organization ID>
          service-account-id: svac_...
```

- **The credential.** Use workload identity federation, so that no key is
  stored: the job exchanges its GitHub identity token for an access token
  that expires in minutes. In the Claude Console, use an Anthropic workspace
  that is only for CI, with a monthly spend limit. Make a service account in
  it, and a federation rule for the issuer
  `https://token.actions.githubusercontent.com`. The subject is the
  `sub_claim_prefix` from
  `gh api repos/<owner>/<repo>/actions/oidc/customization/sub`, then
  `:pull_request`. Do not write `repo:<owner>/<repo>` from memory: a
  repository with immutable subjects has
  `repo:<owner>@<owner ID>/<repo>@<repository ID>`. Set the audience
  `https://api.anthropic.com`, and the claims `event_name` (`pull_request`)
  and `workflow` (the `name:` of the workflow). The IDs are not secrets.
  A pull request from a fork gets no identity token, so nothing leaks.
- **The fallback.** `api-key` takes an API key from the same workspace. With
  a federation rule, the step uses the key only when the exchange fails, and
  gives a warning. The Console's authentication history says why. Store the
  key as a Dependabot secret named `ANTHROPIC_API_KEY`: a workflow that
  Dependabot starts gets only Dependabot secrets. Delete the key when a run on
  a Dependabot pull request says `Authenticated with workload identity
  federation`.
- **No review of a GitHub Actions update.** That pull request changes the
  workflow, and its run uses the changed file. A run on that branch puts the
  new, unreviewed actions in the job with the credential, so the `facts` job
  skips the branch.
- **The review job does not check out the pull request.** It reads the facts
  artifact, which the job with no secret wrote, as data. Do not add a
  checkout or an install to that job.
- **The cost.** One request for each pull request, on `claude-opus-5-5` by
  default. Set `model` to change it. The step logs the input and output
  tokens.

## Run the mutation workflow

`mutation.yml` runs Stryker by the rules of repo-template ADR 0004: the
changed files on a pull request, and the full list each week. Call it from a
workflow of its own, so that a red run does not look like a broken build:

```yaml
name: Mutation
on:
  schedule:
    - cron: '0 8 * * 1'
  workflow_dispatch:
  pull_request:
permissions:
  contents: read
concurrency:
  group: mutation-${{ github.ref }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
jobs:
  mutation:
    uses: Bimmiest/shared-workflows/.github/workflows/mutation.yml@<sha> # vX.Y.Z
    permissions:
      contents: read
      actions: read
    with:
      shards: 4
      canary-command: npm run test:mutation:canary
```

- **The Stryker config.** The workflow reads the config as text, and does
  not import it. Write `mutate` as a list of string literals. A glob can have
  `**`, `*` and a `!` at the start. The workflow refuses a glob with `?`,
  `[ ]`, `{ }` or `( )`, because it cannot select the same files as Stryker.
  Add `json` to the `reporters`.
- **The floor of a shard.** With `shards` above 1, each shard job sets
  `MUTATION_SHARD=1`. One shard can be below the floor while the full run is
  not. Thus the config must turn the floor off for a shard, and the `score`
  job holds the shards together to the floor:

  ```js
  thresholds: { high: 85, low: 83, break: process.env.MUTATION_SHARD === '1' ? null : 81 },
  ```

  The workflow reads the one number in the `break` expression.
- **The command.** The workflow adds `--mutate <files>` at the end of
  `command`. npm reads each option before `--` as its own, so the workflow
  adds `--` first when the command starts with `npm` and has no ` -- `.
- **The time limit.** Each job writes its time to the job summary. When a
  job gets near `timeout-minutes`, add a shard. Do not raise the limit:
  GitHub stops a job after 6 hours, and a job that stops gives no score.
- **The permission `actions: read`.** A `./` path in a reusable workflow
  names the checkout of the caller. Thus the `plan` job reads the commit of
  the workflow from the record of the run, and checks out the scripts at that
  commit ([ADR 0005](adr/0005-the-mutation-workflow-takes-its-scripts-from-the-commit-of-its-call.md)).
- **Not a required check.** A required check makes each merge wait for the
  run, which is slow. The reviewer decides if a red run can merge.

## Check a pin that Dependabot cannot read

Dependabot does not read a version that a script or a config file pins.
`upstream-release-check` compares that version with the releases of the
upstream on GitHub. Add a job to `supply-chain.yml`, on the same schedule as
`node-patch-check`. Add the file of the pin to the `paths` of its
`pull_request` trigger. This example is the pin of PCRE2 in `build/build.sh`
of `pcre2-wasm-utf16`, which has the line `PCRE2_VERSION=10.48`:

```yaml
  pcre2-release:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@<sha> # vX.Y.Z
        with:
          persist-credentials: false
      - uses: actions/setup-node@<sha> # vX.Y.Z
        with:
          node-version-file: .nvmrc
      - uses: Bimmiest/shared-workflows/.github/actions/upstream-release-check@<sha> # vX.Y.Z
        with:
          repository: PCRE2Project/pcre2
          file: build/build.sh
          pattern: '^PCRE2_VERSION=(.+)$'
          tag-pattern: '^pcre2-(.+)$'
          warn-only: ${{ github.event_name == 'pull_request' }}
```

- **Releases, not tags.** The check reads the releases API, because only a
  release tells if it is a draft or a prerelease. The check skips drafts and
  prereleases. An upstream can also tag a release candidate, for example
  `pcre2-10.48-RC1`.
- **The newest version, not the latest release.** The check reads the 100
  newest releases, by creation date, and finds the highest version. It does
  not use `/releases/latest`, because that release can be a backport on an
  older line.
- **The two patterns.** `pattern` must match exactly one line of the file,
  and `^` and `$` match at each line. `tag-pattern` must match the tag. In
  each pattern, capture group 1 is the version. The check skips a release
  whose tag does not match `tag-pattern`.
- **How versions compare.** A version is numbers with a dot between each two,
  with an optional `v`. The check compares the numbers part by part. A
  missing part is 0. Thus `10.48` is equal to `10.48.0`, and `10.100` is
  newer than `10.99`.
- **A version with other text.** The check skips a release whose version has
  other text, for example `10.48-RC1`, and names it in the log. A pin with
  other text fails.
- **Failures.** The check fails when the request fails, and when no release
  is left to compare. With `warn-only`, it only writes a warning.
- **The token.** `GITHUB_TOKEN` can read the releases of a public upstream.
  For a private upstream, give a `token` with "Contents: read" on it.
- **The pin does not change.** The check only tells you about the release.
  Read the release notes, change the version and its checksum, and run the
  build again.

## Run the tests in a shuffled order

`randomised-tests` finds a test that passes only after another test, or
only in one time zone or locale. Run it in a job of your `ci.yml`, on the
schedule only. On each pull request, a new order makes one hidden dependency
fail unrelated changes:

```yaml
  randomised:
    if: github.event_name == 'schedule'
    name: unit tests, randomised
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@<sha> # vX.Y.Z
        with:
          persist-credentials: false
      - uses: Bimmiest/shared-workflows/.github/actions/setup-node-project@<sha> # vX.Y.Z
      - uses: Bimmiest/shared-workflows/.github/actions/randomised-tests@<sha> # vX.Y.Z
```

- **The seed.** With no `seed`, the action makes a new seed of 30 bits for
  each run. A `seed` must be a whole number of 1 to 15 digits. The action
  writes the seed to the log and the job summary, and gives it as the `seed`
  output.
- **Run the same order again.** The summary gives the command, with `TZ`,
  `LANG` and the seed. Run it on your machine. To run it in CI, give the
  seed as the `seed` input.
- **The command.** The action adds `--sequence.shuffle` and
  `--sequence.seed=<seed>` at the end of `command`. It splits `command` into
  words at spaces, and runs the words as one program with its arguments, with
  no shell. Thus quotes, `$`, `;`, `&&`, `|` and a `NAME=value` prefix do not
  work. Put a longer command in an npm script, and end `command` with `--`,
  for example `npm run test:unit --`. Without `--`, npm reads the two options
  as its own.
- **The environment.** Give a variable for the test run in the `env` of the
  step. `tz` and `lang` set `TZ` and `LANG`. Each input must be one line.

## Run a check on your own machine

The scripts take the same arguments as the actions. Use one of two methods.

**With npx**, from the tag of your pin:

```bash
npx -y -p github:Bimmiest/shared-workflows#v1 docs-check
npx -y -p github:Bimmiest/shared-workflows#v1 coverage-ratchet --config vitest.config.ts
```

**From a clone** beside the project:

```bash
node ../shared-workflows/.github/actions/docs-check/docs-check.mjs
```

The exit code is the result: 0 when the check passes, and 1 when it fails.

## The settings of this repository

Two facts make the pins work. Neither is a file.

- **This repository is public.** Thus each repository can call its workflows
  and actions, and a private repository can too. If this repository becomes
  private, set **Settings, Actions, General, Access** to allow the
  repositories of the same owner. Without that setting, GitHub refuses each
  call as "not found". `mutation.yml` also checks out this repository with
  the token of the caller, and that token cannot read a private repository
  of another name.
- **Each release has two tags:** `vX.Y.Z`, and a major tag `vX` that moves to
  the newest release. Dependabot needs the tags to find a version behind a
  SHA. A `vX.Y.Z` tag cannot move or be deleted, because a ruleset refuses it
  and the release is immutable. Thus the commit behind a version stays the
  same. To check a release, run `gh release verify vX.Y.Z -R Bimmiest/shared-workflows`.
