# CLAUDE.md

The conventions are in [CONTRIBUTING.md](./CONTRIBUTING.md). Read it before
your first change. This file does not summarise it. It names the rules that
people break, and the rules where a mistake is expensive and not obvious.

## Each change reaches each consumer

A consumer runs what you merge here when it bumps its pin. Thus:

- **A check that fails on something that it passed before is a major
  version.** Say so in the CHANGELOG. A new input with a default is a minor
  version.
- **A new action gets a fixture that must pass and one that must fail**, in
  `test/fixtures/`, and steps in the `actions` job of `ci.yml`. `npm test`
  proves the script, not the YAML around it.
- **Do not add a dependency to a script.** A consumer runs the scripts with
  no install. [ADR 0002](docs/adr/0002-the-repository-follows-the-template-standard-without-a-toolchain.md)
  gives the reason.

## Before you write code

**Open an issue first** for each change that is larger than a typo. The
branch is `<type>/<short-description>-<issue-number>`, and CI refuses a pull
request that breaks the pattern. If your session got a branch name that does
not conform, rename it, and open the pull request from the new name.

## Expensive to get wrong

- **Do not put `${{ }}` in a `run:` block.** The inputs of an action and the
  text of a pull request get to a shell through `env:`.
- **Pin each `uses:` to a full SHA, with `# vX.Y.Z` after it.** In this
  repository, call its own actions with `./`, not `$/`.
- **Do not write a SHA or a version in an example in the documents.** Use
  `<sha> # vX.Y.Z`. An example with a real SHA is wrong after the next
  release.
- **Do not tag a release by hand.** Set `version` and the CHANGELOG section
  in one pull request. `release.yml` tags, publishes and moves `vx`. A
  release tag cannot move later, so a wrong release needs a new patch.

## Code comments

Follow [the rules](./docs/code-style.md#code-comments). A comment says why, for
the code as it is now. For history, link the issue or the ADR. No lint checks
them here, so check your own diff for code in a comment and a TODO with no
issue.

## Documentation

Write all documentation in ASD-STE100. Keep the README to the fundamentals,
in a maximum of 200 lines. Put each text in its class: a rule in CONTRIBUTING,
in one or two sentences, and its detail in the topic file of its area in
`docs/` ([the classes](./docs/documentation.md#where-each-text-goes)). When you
add an action or change its inputs, update `docs/catalogue.md` in the same
change.

## Not in this file

This file has no status, no plan and no test counts. Status goes in issues.
Keep this file to one screen.
