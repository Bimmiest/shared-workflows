# Principles

Each check here came from a failure in one of the source repositories. The
comments in the YAML and in the scripts name the issue. All the checks follow
these rules.

## A floor is a ratchet, in both directions

Do not lower a floor to make a branch green. When the measurement goes above
the floor, CI fails until the floor goes up to the measurement. A floor that
goes up only when somebody remembers does not protect the coverage that the
code has now.

## An exception has its reason beside it

Each exception has a reason, and often an expiry date. A check fails on an
exception that nothing needs. Thus the list cannot rot. An exception that
nobody can explain is a finding that nobody read.

## People must act on a gate

A gate that people learn to skip is worse than no gate. Thus each gate fails
only on a finding that a pull request can fix:

- Production dependencies gate. Advisories in development dependencies are
  reported, not fatal.
- A vulnerability with a fix gates. A vulnerability with no fix goes to
  Dependabot.
- A secret in the history always gates. The fix is to rotate the secret,
  whatever the confidence of the finding.

## Everything that CI runs is pinned by content

Actions are pinned by commit SHA, and images by digest. The version that a
person reads is in a comment, and Dependabot keeps the comment correct. The
owner of a tag can move it, so a tag is not a pin.

## Untrusted text gets to a shell only through the environment

The body and the branch name of a pull request are untrusted text. The inputs
of an action are untrusted text too. A workflow gives them to a `run:` block
only through `env:`. A `${{ }}` expression in a `run:` block is template
injection.

## The schedule is part of the check

An advisory is published, or a new rule finds a secret that is old. Then a
security or supply-chain check fails with no push. A check that runs only on
a push finds the problem on the day that somebody opens a pull request. Thus
these checks run each week on their own.
