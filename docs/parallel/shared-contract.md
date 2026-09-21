# V2 shared contract — integration decision

Base: `d199eca` plus the four lane commits on `codex/issue-2-v2-integration`.

This contract is the integration seam. It does not activate production workflows and it does not implement `WF07` or `WF10`.

## Canonical configuration

`CONFIG_BIA.item_id` is the stable Mã mặt hàng. `item_code` and `item_name` are display/source-facing fields; `inventory_unit` is the only Đơn vị kiểm kê used by reconciliation. Gateway catalog rows include compatibility display fields (`ma_bia`, `ten_bia`, `don_vi_dem`) for the current worker modules without changing the Sheet schema.

The shared schema declares:

- `CONFIG_LICH` and `DISPATCH_HISTORY` for the ten-minute Dispatcher.
- `CONFIG_BIA`, `CONFIG_QUY_DOI`, `CONFIG_MAPPING_NHAP`, `CONFIG_MAPPING_BAN`.
- `CONFIG_NGUON_BAN` and `CONFIG_NGUON_BAN_COT` for configurable sales sources.
- `CONFIG_TOPIC`, `CONFIG_DRIVE`, `CONFIG_ROLE_PERMISSION`, and `CONFIG_USER_ROLE`.

`CONFIG_SCHEMA` rules may describe every table in `ALL_SHEET_DEFINITIONS`. A worker asking the Gateway for extended tables must include `payload.required_sheet_names`; the Gateway validates that those sheets exist, validates their declared schema coverage, includes them in the config fingerprint, and returns only the requested business configuration.

The Dispatcher requests `CONFIG_LICH`, `CONFIG_BRANCH`, and `CONFIG_GLOBAL`. Catalog workers request `CONFIG_BIA` plus their mappings and conversions. Credentials, tokens and private payloads are never returned as part of this contract.

## Canonical ledgers

The V2 spec fixes the physical names:

- `LOG_NHAP` is Sổ nhập bia. Only confirmed Dòng nhập bia may produce a row.
- `LOG_BAN` is Sổ bán bia. A new active version supersedes the prior version without deleting history.
- `BIA_LOG` stores revisioned count entries for a Phiên kiểm kê.
- `DIEU_CHINH_SO` stores corrections; committed rows are never edited in place.

Each business write retains `config_snapshot_id` where the source workflow has a configuration snapshot. Multi-sheet writes use `OPERATION` and the existing `PREPARED → COMMITTED` protocol.

## Dispatcher claim protocol

`dispatch_key` is the unique key for one scheduled job occurrence. A decision produces an `atomic_claim` request with:

```text
unique_key = DISPATCH:<dispatch_key>
claim_token = operation_id
status = CLAIMED
```

The shadow adapter must implement `tryClaim` as a compare-and-set under a lock (Apps Script `LockService` or an equivalent atomic endpoint): read the key, insert exactly once when empty, and return false when another owner already claimed it. The caller reads the key again and invokes the worker only when the stored `claim_token` matches. A Google Sheets `append` node by itself is not an atomic claim and must not be used as the production implementation.

The inactive WF04 export emits `ATOMIC_CLAIM` write-plan entries and `atomic_claims` for the adapter. It does not invoke a worker or enable a production write path in this task.

## Verification boundary

The integration branch must pass the full local test suite, regenerate all inactive workflow exports, validate the JSON artifacts, and run shadow fixtures for Gateway/catalog/Dispatcher claim behavior. A real Google Sheet/n8n shadow run needs dedicated non-production credentials and will be performed only after those fixtures are green; production remains off.
