# Issue tracker: GitHub

Issues and specs for this repository live in GitHub Issues at [devphucthinh/n8n-Modus](https://github.com/devphucthinh/n8n-Modus). Use the `gh` CLI for issue operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`.
- **Read an issue**: `gh issue view <number> --comments` and include labels/comments when context is needed.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments` with appropriate state/label filters.
- **Comment**: `gh issue comment <number> --body "..."`.
- **Apply/remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`.
- **Close**: `gh issue close <number> --comment "..."`.

Infer the repository from `git remote -v`; the configured remote is `https://github.com/devphucthinh/n8n-Modus.git`.

## Pull requests as a triage surface

**PRs as a request surface: no.** Pull requests are not included in the issue-triage queue unless this file is explicitly changed later.

## When a skill says “publish to the issue tracker”

Create a GitHub issue in `devphucthinh/n8n-Modus` and apply the appropriate triage label from `docs/agents/triage-labels.md`.

## Domain safety

Issue bodies must not include credentials, tokens, API keys, private Drive/Sheet contents or raw workflow parameters containing secrets. Link to repository documentation or sanitized evidence instead.
