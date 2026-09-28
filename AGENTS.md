# Agent instructions

This repository contains the Kiểm kê bia V2 automation design and n8n workflow artifacts.

## Agent skills

### Issue tracker

Issues and specs for this repository live in GitHub Issues at `devphucthinh/n8n-Modus`; use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default Matt Pocock triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository. Read `CONTEXT.md` and relevant files in `docs/adr/` before exploring or changing domain behavior. See `docs/agents/domain.md`.

When a workflow is slow or hangs around Google Sheets reads, read `docs/agents/google-sheets-read-performance.md` before changing the workflow; it records the required one-execution read guard and verification loop.

## Repository-specific rules

- Treat the live Google Sheet as the authoritative business configuration; `.xlsx` files downloaded from Google Sheets are snapshots for analysis and fixtures only.
- Treat the approved Kiểm kê bia V2 decisions and ADRs as higher precedence than older briefs, V1 workflow JSON, WF04, mock data, or test history.
- Keep V2 independent from WF04. Do not import over, rename, or mutate V1 workflows while building V2.
- Do not hard-code changeable business configuration in n8n. Put schedules, TTLs, thresholds, mappings, roles, permissions, topics and retention in Google Sheets; keep only technical bootstrap and credential references in n8n.
- Never put credentials, tokens, API keys or private data in documentation, issues, logs, diagrams or exported workflow artifacts.
- Protect operational ledgers from direct edits. Corrections use versioned records or adjustment workflows.
