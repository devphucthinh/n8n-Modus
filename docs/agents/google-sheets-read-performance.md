# Google Sheets read performance

## Trigger

Read this guide whenever a workflow is slow, hangs, or shows rapidly growing item counts after a Google Sheets node.

## Rule

The shared workflow builder must emit the n8n node property `executeOnce: true` on every Google Sheets node whose operation is `read`. Keep `options.returnAll: true` for configuration tables that need every active row. `Execute Once` is the technical execution guard; it does not change the business configuration stored in Google Sheets.

## Why

n8n passes every output item to the next node. A linear chain of `returnAll` reads therefore calls the next read once per upstream row. A table with 119 rows can make the following read run 119 times and multiply later item counts. The read should make one Sheets request and return its rows once; the `Assemble Config Tables` code node then collects the rows with `$items('Read ...')`.

Router and audit reads are conditional. When a request does not include a
router table in `required_sheet_names`, its read node is intentionally not
executed. The assembly and evaluation code must therefore tolerate a missing
node output and use an empty table; direct `$items('Read CONFIG_ROLE')` calls
without a guard recreate the `Node ... hasn't been executed` failure.

## Change and verify

1. Change the shared `googleSheetNode` builder, not individual exported JSON files.
2. Regenerate all V2 artifacts with `npm run build:workflows`.
3. Run `npm run validate:workflows` and `npm test` (or `npm run verify`).
4. Inspect every generated Google Sheets read node and confirm `settings.executeOnce` is `true` and the live Sheet ID is present.
5. Re-import/update WF01 before testing `/help` or `/trangthai`; stop stale executions before measuring the new run.

Append/update nodes do not need this read guard unless a future workflow introduces a new read path. Any new workflow that reads Google Sheets must use the shared builder so validation catches a missing setting.
