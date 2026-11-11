# 0005. The mutation workflow takes its scripts from the commit of its call

- **Status:** Accepted
- **Date:** 2026-11-11
- **Issue:** [#37](https://github.com/Bimmiest/shared-workflows/issues/37)

## Context

[#37](https://github.com/Bimmiest/shared-workflows/issues/37) asks for a
reusable workflow, `mutation.yml`, that runs Stryker. Repo-template
[ADR 0004](https://github.com/Bimmiest/repo-template/blob/main/docs/adr/0004-one-point-of-coverage-slack-tests-next-to-the-code-and-mutation-on-the-changed-files.md)
gives its rules. On a pull request, the run mutates only the changed files
in scope. The full run is divided across the jobs of a matrix when one job
does not fit, and a last job holds the combined score to the floor. Each of
these rules needs a script: to read the `mutate` list, to select and divide
the files, and to merge the reports.

[ADR 0001](0001-checks-are-composite-actions-pinned-by-commit.md) gives two
shapes. A check that runs a script of this repository is a composite action,
because GitHub gets an action at the pin of its caller. A complete job that
needs no file of this repository is a reusable workflow. The mutation run is
the two at once. It is a complete job, with a matrix, artifacts and a last
job, and it runs scripts.

A reusable workflow cannot get the files of its own commit in a direct way:

- In a reusable workflow, `uses: ./…` is a path in the checkout of the
  caller, not in this repository.
- GitHub accepts `uses: $/…` since 2026-07-30. actionlint 1.7.12 refuses it
  ([`ci.yml`](../../.github/workflows/ci.yml) gives the detail). This
  repository has no test of what `$/` names in a reusable workflow.
- No expression gives the commit of a reusable workflow. `github.sha` and
  `github.workflow_sha` give the commit of the caller.
- The record of a run, `GET /repos/{owner}/{repo}/actions/runs/{run_id}`,
  lists each reusable workflow that the run calls, with its commit, in
  `referenced_workflows`. A token with `actions: read` can read it.

## Decision

- `mutation.yml` is a reusable workflow that runs scripts of this
  repository.
- Its `plan` job reads the commit of
  `Bimmiest/shared-workflows/.github/workflows/mutation.yml` from
  `referenced_workflows`. Then it checks out this repository at that commit.
  Thus the scripts are those of the pin of the caller. The `score` job checks
  out the same commit.
- The mutation jobs get no script. The `plan` job gives each job its files
  in the matrix. Thus the checkout of this repository is never in the tree
  that Stryker and the test runner of the caller read.
- The jobs call `setup-node-project` pinned to a release, as a consumer pins
  it, and as `settings.yml` calls `open-or-update-issue`.
- The scripts are in `.github/actions/mutation-ratchet/`, beside the script
  of the action, so that `npm test` and the coverage floor get to them.

## Consequences

- The caller gives `actions: read`, and `contents: read`.
- The runner needs `gh`, and access to `github.com`. A runner that GitHub
  hosts has both.
- The step names `Bimmiest/shared-workflows`. A fork of this repository must
  change the name. If this repository becomes private, the checkout of the
  scripts fails, because the token of the caller cannot read it.
- `setup-node-project` in the workflow can be one release behind the
  workflow, until Dependabot moves the pin.
- The `ci.yml` of this repository calls the workflow with `./`, so CI proves
  that the record names a local call too. CI cannot prove the call from a
  consumer. Run the workflow from a branch of a consumer before a release.
- What to check when you change it: if actionlint accepts `$/`, and `$/` in
  a reusable workflow names this repository at the commit of the call, call
  the scripts through an action with `$/`. Then remove `actions: read` and
  the step that reads the record.
