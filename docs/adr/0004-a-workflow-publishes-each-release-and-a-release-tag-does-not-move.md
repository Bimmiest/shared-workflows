# 0004. A workflow publishes each release, and a release tag does not move

- **Status:** Accepted
- **Date:** 2026-10-25
- **Issue:** [#17](https://github.com/Bimmiest/shared-workflows/issues/17)

## Context

A consumer pins a commit SHA, but Dependabot finds the version of a SHA from
the tags ([ADR 0001](0001-checks-are-composite-actions-pinned-by-commit.md)).
Thus a tag is part of what a consumer trusts. If somebody moves `v1.1.0` to
another commit, Dependabot proposes that commit to each consumer as
`v1.1.0`, and a reviewer sees a version that they know.

Until 2026-10-25, a person tagged each release with four commands. Nothing
stopped a later push from moving or deleting a release tag. The force push of
the major tag needed a permission bypass on 2026-10-25.

## Decision

- **A ruleset refuses to update or delete a `v*.*.*` tag**, with no bypass.
  The major tag `vX` is not in the ruleset, because it moves with each
  release.
- **Releases are immutable.** GitHub locks the tag of a published release.
- **`release.yml` publishes each release.** When a change to `version` in
  `package.json` merges, the workflow tags the merge commit with an annotated
  `vX.Y.Z`, publishes a GitHub Release with the CHANGELOG section, and moves
  `vX` to the same commit. If the CHANGELOG has no section for the version,
  the workflow fails.
- The releases before this record (1.0.0, 1.0.1 and 1.1.0) were published as
  GitHub Releases by hand, so that their tags are locked too.

## Consequences

- A version that a consumer pins cannot point at a different commit later.
  GitHub also records a release attestation, and
  `gh release verify vX.Y.Z` checks it.
- A release is one pull request. Nobody needs a force push or a bypass.
- A wrong release cannot be corrected in place. The fix is a new patch
  release. An administrator can delete a release and then its tag, but
  GitHub does not let the tag name be used again.
- The release job holds `contents: write`. It runs only on `main`, after
  review, and it runs no dependency code.
- What to check when you change it: if a consumer starts to pin a tag and not
  a SHA, the major tag becomes what the consumer runs, and it needs the same
  protection.
