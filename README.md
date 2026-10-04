# shared-workflows

The CI gates shared across Bimmiest repositories, as GitHub reusable workflows and composite actions. Distilled from [`propslab`](https://github.com/Bimmiest/propslab) and [`propslab-ent`](https://github.com/Bimmiest/SplunkToolkit-Ent), where each of these was first written for one repository and then wanted by the next. [`repo-template`](https://github.com/Bimmiest/repo-template) is the template repository that consumes them; start a new repository from it rather than wiring these by hand.

## How to consume

Pin a commit, with the version in a comment. Dependabot reads the comment and proposes bumps as tags are published.

```yaml
# A reusable workflow is a job.
jobs:
  security:
    uses: Bimmiest/shared-workflows/.github/workflows/security.yml@<sha> # v1.0.0
    permissions:
      contents: read
      pull-requests: read

# A composite action is a step.
    steps:
      - uses: Bimmiest/shared-workflows/.github/actions/coverage-ratchet@<sha> # v1.0.0
```

Two settings on this repository make that work, and neither is a file:

- This repository is public, so any repository can call its workflows and actions, private consumers included. If it were ever made private, **Settings → Actions → General → Access** would have to allow repositories owned by the same user, or a consumer's call is refused as not found.
- **Tags** `vX.Y.Z` and a moving `vX` are published per [CONTRIBUTING](CONTRIBUTING.md#releasing). Dependabot needs the tags to see a version behind a sha.

Composite actions run whatever `node` is on the runner's PATH, so call them after `setup-node` (or after `setup-node-project`). Node 22 or newer.

## Reusable workflows

| Workflow | What it gates | Caller needs |
|---|---|---|
| [`security.yml`](.github/workflows/security.yml) | gitleaks over the whole history; Trivy over the tree for vulnerabilities and misconfiguration (CRITICAL and HIGH, unfixed ignored, `.trivyignore.yaml` honoured when present) | `permissions: contents: read, pull-requests: read`; its own `schedule`, because both go red without a push |
| [`workflow-lint.yml`](.github/workflows/workflow-lint.yml) | actionlint and zizmor over the caller's `.github/` | a runner with Go and shellcheck (`ubuntu-latest`) |

Both take `runs-on` as a JSON array (default `["ubuntu-latest"]`) so a self-hosted label set can be passed. Neither puts its jobs in a container; a repository on a persistent runner that needs the job-container recipe keeps that job in its own workflow, as `propslab-ent`'s `ci.yml` does.

## Composite actions

| Action | What it does | Reads |
|---|---|---|
| [`setup-node-project`](.github/actions/setup-node-project/action.yml) | Node from `.nvmrc`, the npm cache, `npm ci --ignore-scripts` | `.nvmrc`, the lockfile |
| [`playwright-browser`](.github/actions/playwright-browser/action.yml) | one browser, cached on the resolved Playwright version, system packages installed either way | `@playwright/test` |
| [`coverage-ratchet`](.github/actions/coverage-ratchet/action.yml) | fails when a vitest coverage floor sits more than `slack` points under its measurement, per-glob floors included; prints the block to write | `vitest.config.ts`, `coverage/coverage-summary.json` |
| [`audit-check`](.github/actions/audit-check/action.yml) | `npm audit --omit=dev` gated at `high`, with an exceptions file whose entries carry a reason and an expiry; an expired or unneeded entry fails | `.audit-exceptions.json` |
| [`licence-check`](.github/actions/licence-check/action.yml) | every production dependency's licence is on the allowlist, read from the lockfile's `license` fields, no install | `.licence-allowlist.json`, `package-lock.json` |
| [`pr-hygiene`](.github/actions/pr-hygiene/action.yml) | the branch is `<type>/<short-description>-<issue>` and the description links the issue; `no-issue` label and `dependabot[bot]` exempt | the `pull_request` event |
| [`docs-check`](.github/actions/docs-check/action.yml) | relative Markdown links resolve; the ADR index matches `docs/adr/`, is in order, and explains numbering gaps; root `LICENSE-*` files are in the README | the Markdown tree, optional `.docs-check.json` |
| [`node-patch-check`](.github/actions/node-patch-check/action.yml) | `.nvmrc` is the newest patch of its Node line, asked of nodejs.org; `warn-only` on pull requests | `.nvmrc` |
| [`open-or-update-issue`](.github/actions/open-or-update-issue/action.yml) | one open issue per label for a scheduled check, commented on while the finding persists | `issues: write` |

Each `action.yml` documents its inputs. The scripts behind them are plain Node with no dependencies; each has a `*.test.mjs` beside it.

### Running a check locally

The scripts take the same arguments the actions pass. Either clone this repository beside the project:

```bash
node ../shared-workflows/.github/actions/coverage-ratchet/ratchet.mjs --config vitest.config.ts
```

or run one through npx from the tag you are pinned to:

```bash
npx -y -p github:Bimmiest/shared-workflows#v1 coverage-ratchet --config vitest.config.ts
```

The `bin` names are `audit-check`, `coverage-ratchet`, `docs-check`, `licence-check`, `node-patch-check` and `pr-hygiene`.

## The principles these encode

Each gate here came out of a specific failure in one of the source repositories, and the comments in the YAML and the scripts cite the issue. The rules they share:

- **A floor is a ratchet, and both pawls are enforced.** Never lower one to make a branch green; when the measurement rises past the floor, CI fails until the floor is raised to match.
- **An exception sits beside its reason**, often with an expiry, and an exception nothing needs any more fails the check, so the list cannot rot.
- **A gate has to be one people act on.** Production dependencies gate; dev-only advisories are reported. Fixed vulnerabilities gate; unfixed ones are Dependabot's. A secret in history always gates, because the remedy is to rotate it whatever the confidence.
- **Everything executed in CI is pinned by content**: actions by sha, images by digest, with the human-readable version in a comment Dependabot maintains.
- **Untrusted text reaches a shell only through the environment.** A pull request's body and branch name, and an action's inputs, are never pasted into a `run:` block.
- **The schedule is not decoration.** Security and supply-chain checks go red without a push, so they run weekly on their own.

## Repository layout

```
.github/
  workflows/
    security.yml         reusable
    workflow-lint.yml    reusable
    ci.yml               this repository's own gates (runs the two above against itself)
    pr-hygiene.yml       this repository's own, using the action below
  actions/<name>/
    action.yml           the composite action
    <name>.mjs           the script it runs, where there is one
    <name>.test.mjs      its tests, run by `npm test`
```

## Licence

[MIT](LICENSE).
