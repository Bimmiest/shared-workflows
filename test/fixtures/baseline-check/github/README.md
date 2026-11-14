# A GitHub repository that does not use Claude Code

The baseline check must pass here with `stacks: docs-only`. The directory has
the GitHub core set, except `.claude/settings.json`, and
`.baseline-exceptions.json` gives the reason for that file. With a config
file that does not exist, the check must fail on `.claude/settings.json` only.
