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
  `security-events: write`. `open-or-update-issue` needs `issues: write`. The
  other checks need only `contents: read`.
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
places that use each package. The comment is never a check result, and
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
      - uses: actions/setup-node@<sha> # vX.Y.Z
        with:
          node-version: lts/*
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
  `https://token.actions.githubusercontent.com`, with the subject prefix
  `repo:<owner>/<repo>:pull_request`, the audience `https://api.anthropic.com`,
  and the claims `repository_owner` and `workflow`. The IDs are not secrets.
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
  call as "not found".
- **Each release has two tags:** `vX.Y.Z`, and a major tag `vX` that moves to
  the newest release. Dependabot needs the tags to find a version behind a
  SHA. A `vX.Y.Z` tag cannot move or be deleted, because a ruleset refuses it
  and the release is immutable. Thus the commit behind a version stays the
  same. To check a release, run `gh release verify vX.Y.Z -R Bimmiest/shared-workflows`.
