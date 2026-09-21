# Inventory lane handoff

Branch: `codex/issue-2-inventory-session-counts`

This lane contains the pure V2 planning logic and inactive workflow exports for:

- `WF05_V2_MO_PHIEN_KIEM_KE`: open or reuse one active inventory session per branch and business date.
- `WF06_V2_NHAN_SO_DEM`: save revisioned count entries, review the session, and finalize with explanation for red variances.

The worker expects its catalog and count rules from the immutable configuration snapshot supplied by the Config Gateway. It does not read live configuration directly and its exports contain no credentials or production identifiers.

Shared-contract dependencies to settle during integration:

- `CONFIG_BIA` and the catalog/item-key contract used by `ma_bia`.
- `CONFIG_QUY_DOI` and count-unit precision/step rules.
- `PHIEN_KIEM_KE`, `BIA_LOG`, `DIEU_CHINH_SO`, and `EVENT_LOG` schemas.
- Gateway response fields for `config_snapshot`, catalog, and required extended tables.
- A future close/reconciliation worker must consume committed count rows; this lane does not implement `WF07`.

The workflows remain inactive and are intended for shadow validation only.
