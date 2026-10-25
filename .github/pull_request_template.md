<!--
Delete each section that does not apply. An empty heading is worse than no
heading.
-->

## What and why

<!--
Say what changed and why, and what it cost. A change here goes to each
repository that bumps its pin, so say what a consumer sees.
-->

Closes #

## Decisions

<!--
Did this change settle something that stays true after the merge? Then it
goes in `docs/adr/` as a record of its own, with a row in the index, and this
section links to it. Delete this section if the change made no decision.
-->

## Verification

<!--
Say what you ran, and what it said. "Tests pass" is a claim. The output is
the evidence. Paste the important lines.
-->

- [ ] `npm test`
- [ ] Each changed action or workflow ran from a branch of a consumer, pinned to the SHA of this branch
- [ ] Each new `uses:` is `owner/action@<sha> # vX.Y.Z`
- [ ] The documents that this change makes wrong are updated in this change, in ASD-STE100 ([CONTRIBUTING](../CONTRIBUTING.md#documentation)):
  - `CHANGELOG.md`, under `Unreleased`, for a change that a consumer gets from the bump
  - `docs/catalogue.md`, where an action or its inputs changed
  - An ADR and its index row, where a decision was made

## Not done

<!--
Say what a reader can expect to find here that is not here: scope that you
left out on purpose, limits that are still true, and gaps that you know
about.
-->
