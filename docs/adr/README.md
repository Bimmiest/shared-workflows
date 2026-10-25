# Architecture decision records

An ADR records one decision: the context that forced a choice, the choice,
and what it costs. An ADR that lists only benefits is marketing. Each ADR
keeps the history and the issues behind a choice, so that the code and the
CHANGELOG do not have to keep them.

- **Code comments** say what the code does now, and which constraint makes
  it not obvious. When the reason needs history ("we tried X, and #123
  showed Y"), the comment ends with a pointer: `See docs/adr/0003-title.md.`
- **`CHANGELOG.md`** says what a consumer gets from a release, in one or two
  sentences. It links here when an ADR records the reason.
- **ADRs** hold the context and the trade-off.

## Conventions

- Name each file `NNNN-kebab-case-title.md`. Number the files in the order
  that you write them, from `0001`. Do not use a number again. Explain each
  number with no file under
  [Numbers with no record](#numbers-with-no-record).
- Do not rewrite an ADR when a decision changes. Write a new ADR, set the
  status of the old one to `Superseded by NNNN`, and link the two. Do not
  edit an ADR to record the status of the work: status goes in issues.
- A choice that stays true after the pull request gets a record. A choice
  that nobody has made yet stays an issue, with the label `decision`, until
  somebody makes it. An ADR records a decision. An issue records that there
  is no decision yet.
- Keep an ADR short, and keep to the facts. Link the issues and pull requests
  that the decision came from, and name the files that it controls.
- Write a new ADR in ASD-STE100, as CONTRIBUTING says.
- Each record has a row in the index below, in ascending order. CI's docs
  check holds the index and the directory to each other.

## Template

```markdown
# NNNN. Title in sentence case

- **Status:** Proposed | Accepted | Superseded by [NNNN](NNNN-title.md)
- **Date:** YYYY-MM-DD
- **Issue:** #n

## Context

The problem and the constraints, with the issues that showed them. The
constraints, not the solution.

## Decision

What the code does, as a rule.

## Consequences

What follows, good and bad: what the rule costs, what it prevents, and what
to check when you change it.
```

## Index

| # | Decision | Status |
|---|---|---|
| [0001](0001-checks-are-composite-actions-pinned-by-commit.md) | Checks are composite actions, pinned by commit | Accepted |
| [0002](0002-the-repository-follows-the-template-standard-without-a-toolchain.md) | The repository follows the template standard, without a toolchain | Accepted |

## Numbers with no record

None. When a number is not used, or a record is withdrawn, add a bullet
here: `- **N**: why there is no file.`
