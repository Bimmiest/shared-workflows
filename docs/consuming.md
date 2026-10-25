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
- **A schedule.** Security and supply-chain checks can fail with no push. Run
  them each week, or each month for `node-patch-check`.
- **The files that a check reads.** [catalogue.md](catalogue.md) names them.
  Each file is optional, except where the catalogue says otherwise.

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
  SHA. [CONTRIBUTING](../CONTRIBUTING.md#releases) tells you how to tag a
  release.
