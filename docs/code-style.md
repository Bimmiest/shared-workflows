---
type: reference
---

# Code style

The rules for the scripts and for code comments, with their reasons. CONTRIBUTING.md has the summary.

## Scripts

- **Use plain Node, with no dependencies.** A script is importable for its
  test, and runnable as a command. The floor is Node 22, for
  `path.matchesGlob` and `parseArgs`.
- **Give each input through an argument or an environment variable.** Do not
  put `${{ }}` in a `run:` block. The inputs of a composite action are text
  that a caller wrote.
- **Each failure is an `::error::` line** that says what to change. A script
  returns its exit code from one function, so that the test can measure it in
  the same process.
- **An allowlist or exceptions file fails on an entry that nothing needs.**
  Thus the file cannot rot.

## Code comments

The code tells the reader what it does. A comment tells the reader what the
code cannot tell. These rules apply to new code and to the code that you
change. They come from the Google style guides, *Clean Code*, *Code Complete*,
*A Philosophy of Software Design* and the Stack Overflow guide to code
comments (2021).

1. **A comment says why:** the constraint, the rule from a specification, or
   the failure that the code prevents. Do not repeat what the code does.
2. **Write the comment for the code as it is now.** Do not tell the history
   of a change ("now", "before", "changed to"). The commit message has the
   history. If the history explains a decision, link it: `(#123)` or
   `See docs/adr/NNNN-title.md.`
3. **Each exported function, class and constant has a JSDoc comment**
   (`/** … */`). It says what the export does for the caller, and what it
   promises. It does not say how.
4. **If a comment is difficult to write, make the code clearer first.** Then
   write the comment for the part that is still not clear.
5. **Use the same quantity of comments as the file that you change.**
6. **Put the reason next to the code that it explains.** The comment at the
   top of a file says what the file is for, and what it does not do.
7. **Link the source of a fact:** the section of a specification, the origin
   of copied code, or the issue of the bug that the code prevents.
8. **Do not keep code in a comment.** Git keeps the old version.
9. **A TODO names its issue:** `TODO(#123): what is not done.`
10. **A shortcut with a known limit says so:**
    `shortcut: <the limit>, <when to change it>.`
11. **When your change makes a comment false, change the comment in the same
    commit.**

This repository has no lint
([ADR 0002](adr/0002-the-repository-follows-the-template-standard-without-a-toolchain.md)).
A reviewer checks all the rules. In the repositories that have a lint,
`scripts/eslint-comments.mjs` from repo-template checks the rules 8 and 9.
