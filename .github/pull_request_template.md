<!--
Delete any section that genuinely does not apply. An empty heading left behind
is worse than no heading.
-->

## What and why

<!--
What changed, and the reasoning, including what it cost. A change here lands
in every repository that bumps its pin, so say what a consumer will see.
-->

Closes #

## Verification

<!--
What you ran, and what it said. "Tests pass" is a claim; the output is the
evidence. Paste the interesting lines.
-->

- [ ] `npm test`
- [ ] A changed action or workflow was run from a branch of a consuming repository, pinned to this branch's sha
- [ ] `CHANGELOG.md` has an entry under `Unreleased` saying what a consumer gets from bumping
- [ ] Every new `uses:` is `owner/action@<sha> # vX.Y.Z`

## Not done

<!--
What a reader might reasonably assume is here and is not.
-->
