---
type: reference
---

# Documentation

Each topic file in `docs/`, in path order. When you add, rename or remove a
file, change its row here: the docs check fails a file that has no row. The
documents at the root are listed in the [README](../README.md#documentation).

| Document | What it holds |
|---|---|
| [adr/README.md](adr/README.md) | The decisions, and why we made them |
| [catalogue.md](catalogue.md) | Each workflow and action: what it checks, what it reads, and what the caller gives it |
| [ci.md](ci.md) | Each workflow of this repository, and what makes it fail |
| [code-style.md](code-style.md) | The rules for the scripts and the code comments |
| [consuming.md](consuming.md) | How to pin, call and update the checks, and how to run them on your own machine |
| [dependencies.md](dependencies.md) | Why there are no npm dependencies, and how each `uses:` is pinned |
| [development.md](development.md) | How to run the tests, try a change in a consumer, and the layout of the repository |
| [documentation.md](documentation.md) | Where each text goes, the line limits, the topic types and the STE rules |
| [principles.md](principles.md) | The rules that all the checks follow, and why |
| [testing.md](testing.md) | The rules for the tests and the fixtures |
