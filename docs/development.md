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

## Repository layout

```
.github/
  workflows/
    security.yml         reusable
    workflow-lint.yml    reusable
    scorecard.yml        reusable
    ci.yml               the gates of this repository, which run the two above on it
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
