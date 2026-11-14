---
type: how-to
---

# Development

How to work on a check: run the tests, try a change in a consumer, and find your way around the repository. The rules are in [CONTRIBUTING.md](../CONTRIBUTING.md).

## Run the tests

The scripts need Node 22 or later, and no install.

```bash
npm test                # every *.test.mjs
npm run test:coverage   # the same, with the coverage floors that CI enforces
node --test .github/actions/docs-check/docs-check.test.mjs   # one file
```

## Try a change in a consumer

The unit tests prove the script. Only a real run proves the YAML around it. Push your branch, then in a branch of a consumer repository pin the changed action or workflow to the SHA of your branch, and run its CI. To run a script directly against a consumer checkout, run it from that checkout:

```bash
node ../shared-workflows/.github/actions/docs-check/docs-check.mjs
```

## The Claude Code settings

`.claude/settings.json` has deny rules only. They stop Claude Code before it makes, deletes or moves a tag, or force-pushes, because `release.yml` makes each tag ([CONTRIBUTING](../CONTRIBUTING.md#releases)). The file has no hooks: the hooks of repo-template run `scripts/check.mjs` and `npm run gates`, and this repository has neither ([ADR 0002](adr/0002-the-repository-follows-the-template-standard-without-a-toolchain.md)).

A deny rule matches the text of the command, so it is a guard against mistakes, not against attacks. A ruleset protects the release tags. Review a change to `.claude/` as you review a workflow, because Claude Code reads it on the computer of each contributor.

## Repository layout

```
.github/
  workflows/
    security.yml         reusable
    workflow-lint.yml    reusable
    scorecard.yml        reusable
    mutation.yml         reusable, with its scripts in actions/mutation-ratchet/
    ci.yml               the gates of this repository, which run the four above on it
    pr-hygiene.yml       the PR hygiene of this repository, from the action below
    release.yml          tags and publishes a release when `version` changes
    settings.yml         the weekly settings check of this repository
  actions/<name>/
    action.yml           the composite action
    <name>.mjs           the script that it runs, where there is one
    <name>.test.mjs      the tests of the script, which `npm test` runs
test/fixtures/           the projects that the actions job in ci.yml runs each action on
docs/                    the catalogue, how to consume the checks, the principles, the ADRs
```
