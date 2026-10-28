---
type: reference
---

# Documentation

The rules for the documents, and their reasons. CONTRIBUTING.md has the summary.

## Where each text goes

Each Markdown file has one class. The docs check holds each class to a line
limit (`maxLines` in `.docs-check.json`). When a file is over its limit, the
message says where the text goes.

| Class | Files | Limit | Holds |
|---|---|---|---|
| Entry | `README.md` | 200 | The fundamentals: what the product is, and how to start |
| Agent rules | `CLAUDE.md`, `AGENTS.md` | 80 | Only the rules that people break, and the expensive mistakes |
| Rules | `CONTRIBUTING.md` | 300 | What a contributor must do, with a summary and a link for each area |
| Policy | `SECURITY.md`, `.github/**/*.md` | 80 | The report path, and the pull request and issue forms |
| Decision | `docs/adr/*.md` | 300 | One decision: the context, the decision and the consequences |
| Topic | Each other `*.md`, mostly `docs/*.md` | 500 | One topic, with its `type:` in the frontmatter |
| Record | `CHANGELOG.md`, `CODE_OF_CONDUCT.md` | none | A log that only grows, or third-party text |

Each topic file in `docs/` opens with frontmatter that gives its type
(`docTypes` in `.docs-check.json`):

```markdown
---
type: how-to
---
```

| Type | Answers | Example |
|---|---|---|
| `tutorial` | "Teach me, from the start." | A first contribution, step by step |
| `how-to` | "How do I do this task?" | `development.md`: set up, run, and the traps |
| `reference` | "What are the facts and the rules?" | `ci.md`, `testing.md`, `code-style.md`, `dependencies.md`, this file |
| `explanation` | "Why is it like this?" | A design rationale |

Each repository has the same six topic files: `development.md`, `ci.md`,
`testing.md`, `code-style.md`, `dependencies.md` and `documentation.md`. A
repository adds other topic files for its own areas. A recipe, a trap or a
troubleshooting step goes in the topic file of its area, not in
`CONTRIBUTING.md`. If a topic file gets to its limit, split it by subtopic.

## The index

`docs/README.md` lists each topic file in `docs/`, with one row for each
file, in path order. GitHub shows it when a reader opens `docs/`. When you
add, rename or remove a topic file, change its row there, and only there.
The docs check fails a file that has no row, a row that has no file, and a
row out of order (`docsIndex` in `.docs-check.json`). The documents at the
root (`CONTRIBUTING.md`, `CHANGELOG.md`, `SECURITY.md` and
`CODE_OF_CONDUCT.md`) are listed in the README.

## ASD-STE100

Write each new or changed text in ASD-STE100 Simplified Technical English
(template [ADR 0002](https://github.com/Bimmiest/repo-template/blob/main/docs/adr/0002-documentation-is-simplified-technical-english-and-a-readme-keeps-to-the-fundamentals.md)).
It does not apply to an accepted ADR, or to third-party text such as the
Contributor Covenant. The main rules:

- One topic in each sentence, and one instruction in each procedure step.
- A maximum of 20 words in a procedure step, and 25 words in descriptive
  text. A maximum of six sentences in a paragraph.
- Use the active voice, and the imperative for an instruction.
- Do not use "-ing" forms, except in technical names.
- Use "must", "can" and "do not". Do not use `should`, `may`, `might` or
  `would`.
- Do not use phrasal verbs, contractions, semicolons in prose, or `e.g.`,
  `i.e.` and `etc.`. The docs check warns on these words in the files that
  `ste` names in `.docs-check.json`.
- Do not change code, commands, file names or product names.

## The README

**The README keeps to the fundamentals, in a maximum of 200 lines.** The
docs check enforces the limit, from `.docs-check.json`. Put each topic that
needs more than a few lines in `docs/`, and give it a row in the index,
`docs/README.md`. Do not use a wiki.
