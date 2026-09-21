# Establish the V2 shared operational contract

Status: Accepted
Date: 2026-09-21

## Context

The Dispatcher, purchase-ingestion, sales-report and inventory lanes must
exchange the same configuration snapshot, item catalog, identity keys and
operational ledger shapes. The lane branches were intentionally developed in
parallel, so their remaining gaps cannot be resolved safely by adding local
defaults or by copying configuration into individual workflows.

The V2 specification and earlier ADRs remain authoritative over the older V1
exports. The live Google Sheet is the business configuration source; exported
workbooks and local shadow fixtures are only snapshots for validation.

## Decision

The repository owns one versioned registry of shared sheet definitions in
`src/contracts/core-sheet-schema.mjs`. The original nine core tabs retain their
stable names and order. The extended registry adds the shared configuration,
dispatch history, invoice, purchase ledger, sales ledger, inventory and audit
tables required by V2.

The following rules are binding across all four lanes:

- `CONFIG_LICH` is the source for schedule and business-day timing. A schedule
  without an explicit weekday or branch reference is invalid; an empty branch
  configuration cannot silently enable dispatch.
- `DISPATCH_HISTORY` is the durable idempotency and heartbeat history. A
  dispatch claim is identified by `DISPATCH:<dispatch_key>` and must be
  compare-and-set atomic. Google Sheets append alone is not an atomic claim, so
  the eventual live adapter must use Apps Script `LockService` or an equivalent
  serialized endpoint and verify the winning `claim_token`.
- `CONFIG_BIA`, `CONFIG_QUY_DOI` and the mapping/source tables are exposed only
  through a validated Gateway snapshot. Workflows use the returned catalog and
  `config_snapshot_id`; they do not invent a current/default snapshot.
- `LOG_NHAP` (Sổ nhập bia) and `LOG_BAN` (Sổ bán bia) are the canonical
  physical-ledger names from the V2 specification. Corrections are new,
  versioned records or adjustment records; existing operational rows are not
  edited in place.
- Gateway clients request the config tables they need with
  `required_sheet_names`. The Gateway validates schema coverage, returns the
  requested `config_tables`, the derived `catalog` when requested, dispatcher
  tables when requested, and immutable snapshot metadata including
  `config_snapshot_id`, `config_version` and a fingerprint.
- The configuration workbook and workflow exports are generated from the same
  registry. A shadow build must pass workbook verification and workflow
  validation before any non-production run is considered.

The integration branch deliberately stops at the shared contract and pure
planning/validation boundaries. Real Google Sheets/Drive/Gemini adapters,
permission enforcement at each external write, and the production atomic
claim endpoint remain follow-up implementation work.

## Consequences

All four lanes can validate the same names, columns, catalog and lineage
without importing V1 or WF04 behavior. Missing configuration becomes an
explicit Gateway error instead of a fail-open default, and downstream records
retain the snapshot that produced them. The shared contract also gives the
future WF07 reconciliation/close and WF10 reporting workflows stable inputs.

The expanded workbook is larger and requires a full schema verification step.
The current atomic-claim module emits and verifies the adapter contract but is
not itself a production lock service. A real shadow run against a dedicated
non-production Google Sheet/n8n environment is still required before enabling
any V2 workflow. WF07 and WF10 are intentionally deferred until this contract
and shadow validation are accepted.
