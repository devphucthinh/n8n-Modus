# Domain Docs

## Repository layout

This is a single-context repository.

- Read `CONTEXT.md` at the repository root before exploring domain behavior.
- Read relevant records in `docs/adr/` before changing architecture, workflows, schemas or operational behavior.
- Use the glossary vocabulary from `CONTEXT.md` in issue titles, specs, tests and implementation notes.
- If a desired concept is absent from the glossary, flag it as a domain-model gap instead of inventing a competing synonym.
- If a change conflicts with an ADR, state the conflict explicitly and propose reopening the ADR before implementing.

## Source precedence for Kiểm kê bia V2

1. User-approved decisions and `CONTEXT.md`/ADRs.
2. The updated V2 brief.
3. Current workflow JSON and live Google Sheets structure as implementation evidence.
4. Older briefs for V1 behavior.
5. WF04 and its briefs for reference patterns only.
6. Mock rows and test history only as fixtures, never as production truth.

## Safety rules

- Preserve existing V1 workflow JSON and credential references unless the user explicitly requests a migration or removal.
- Keep business configuration in the live Google Sheet and technical credentials in n8n credential storage.
- Do not expose secrets in issues, documentation, test fixtures, logs, diagrams or workflow exports.
