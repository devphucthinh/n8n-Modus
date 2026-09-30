import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORE_SHEET_DEFINITIONS, DISPATCHER_SHEET_DEFINITIONS, INVENTORY_SHEET_DEFINITIONS, OPERATIONAL_SHEET_DEFINITIONS } from '../../src/contracts/core-sheet-schema.mjs';
import { expectedLedgerSchemaRule } from '../../src/contracts/validate-ledger-schema.mjs';
import { loadArtifactToolRuntime } from '../../scripts/lib/artifact-tool-runtime.mjs';

const outputDir = path.dirname(fileURLToPath(import.meta.url));
const { Workbook, SpreadsheetFile } = await loadArtifactToolRuntime();
const definitions = {
  ...DISPATCHER_SHEET_DEFINITIONS,
  ...INVENTORY_SHEET_DEFINITIONS,
  ...OPERATIONAL_SHEET_DEFINITIONS,
};
const ruleHeader = CORE_SHEET_DEFINITIONS.CONFIG_SCHEMA;
const globalHeader = CORE_SHEET_DEFINITIONS.CONFIG_GLOBAL;
const messageHeader = CORE_SHEET_DEFINITIONS.CONFIG_THONG_BAO;
const source = 'https://github.com/devphucthinh/n8n-Modus/issues/4';
const schemaUpdateHeader = ['sheet_name', 'column_name', 'active_rule_count', 'new_schema_version', 'new_data_type', 'new_unique_group'];
const schemaUpdateRows = [
  ['OPERATION', 'operation_id', '1', 'NEXT_SCHEMA_VERSION', 'STRING', 'OPERATION_KEY'],
  ['OPERATION', 'created_at', '1', 'NEXT_SCHEMA_VERSION', 'DATETIME', ''],
  ['OPERATION', 'updated_at', '1', 'NEXT_SCHEMA_VERSION', 'DATETIME', ''],
  ['EVENT_LOG', 'event_id', '1', 'NEXT_SCHEMA_VERSION', 'STRING', 'EVENT_LOG_KEY'],
  ['EVENT_LOG', 'created_at', '1', 'NEXT_SCHEMA_VERSION', 'DATETIME', ''],
];

function schemaRule(sheetName, column, ordinal) {
  const schema = expectedLedgerSchemaRule(sheetName, column);
  const reference = column === 'branch_id' && sheetName !== 'CONFIG_BIA' ? ['CONFIG_BRANCH', 'branch_id'] : ['', ''];
  return {
    schema_rule_id: `rule-${sheetName}-${column}`,
    schema_version: 'NEXT_SCHEMA_VERSION',
    sheet_name: sheetName,
    column_name: column,
    data_type: schema.data_type,
    required: ['CONFIG_LICH', 'CONFIG_BIA'].includes(sheetName) ? 'YES' : 'NO',
    unique_group: schema.unique_group,
    reference_sheet: reference[0],
    reference_column: reference[1],
    allowed_values: '',
    ordinal: String(ordinal + 1),
    description_vi: `${sheetName}.${column}`,
    trang_thai: 'ACTIVE',
  };
}

const schemaRows = Object.entries(definitions).flatMap(([sheetName, columns]) => columns.map((column, ordinal) => schemaRule(sheetName, column, ordinal)));
const globalRows = [
  ['DISPATCH_CLAIM_LEASE_MINUTES', 'SET_POSITIVE_MINUTES', 'INTEGER', 'Thời hạn claim trước khi đối soát/phát lại an toàn', 'ACTIVE'],
  ['DISPATCHER_HEARTBEAT_THRESHOLD', '3', 'INTEGER', 'Số heartbeat lỗi liên tiếp trước cảnh báo', 'ACTIVE'],
  ['DISPATCHER_NOTIFICATION_CHAT_ID', 'SET_CHAT_ID', 'STRING', 'Chat nhận cảnh báo Dispatcher', 'ACTIVE'],
  ['DISPATCHER_NOTIFICATION_THREAD_ID', 'SET_THREAD_ID', 'STRING', 'Topic nhận cảnh báo Dispatcher', 'ACTIVE'],
  ['INVENTORY_PAGE_SIZE', '8', 'INTEGER', 'Số bia hiển thị trên một trang bubble', 'ACTIVE'],
];
const messageRows = [
  ['DISPATCH_OUTSIDE_GRACE_WINDOW', 'Lịch kiểm kê đã quá thời hạn; cần xử lý vận hành. Mã lỗi: {error_id}', 'vi-VN', 'ACTIVE'],
  ['DISPATCH_BRANCH_INACTIVE', 'Chi nhánh đang tắt nên lịch kiểm kê được bỏ qua. Mã lỗi: {error_id}', 'vi-VN', 'ACTIVE'],
  ['DISPATCH_ACTIVE_SESSION_EXISTS', 'Chi nhánh đã có phiên kiểm kê hoạt động. Mã lỗi: {error_id}', 'vi-VN', 'ACTIVE'],
  ['DISPATCH_RECONCILIATION_REQUIRED', 'Lịch kiểm kê cần đối soát trước khi chạy lại. Mã lỗi: {error_id}', 'vi-VN', 'ACTIVE'],
  ['DISPATCHER_CRITICAL', 'Dispatcher lỗi liên tiếp; cần kiểm tra vận hành. Mã lỗi: {error_id}', 'vi-VN', 'ACTIVE'],
  ['DISPATCHER_RECOVERY', 'Dispatcher đã hoạt động trở lại. Mã lỗi: {error_id}', 'vi-VN', 'ACTIVE'],
];

const workbook = Workbook.create();
const readme = workbook.worksheets.add('README');
readme.showGridLines = false;
readme.getRange('A1:B9').values = [
  ['Mục', 'Nội dung'],
  ['Phạm vi', 'Bổ sung cấu trúc cho Issue #4. Không phải bản sao dữ liệu live.'],
  ['Bước 1', 'Sao lưu workbook hiện hành và bật bảo trì trước migration.'],
  ['Bước 2', 'Tạo 5 tab theo đúng hàng tiêu đề; không điền dòng nghiệp vụ mẫu.'],
  ['Bước 3', 'Chốt NEXT_SCHEMA_VERSION; đưa mọi rule CONFIG_SCHEMA hiện hành sang version mới, giữ nguyên schema_rule_id và nội dung; sau đó nối CONFIG_SCHEMA_ADD vào CONFIG_SCHEMA.'],
  ['Bước 4', 'Áp dụng CONFIG_SCHEMA_UPDATE: mỗi cặp sheet_name/column_name phải khớp đúng một rule ACTIVE; chỉ đổi schema_version, data_type, unique_group theo bảng, giữ nguyên ID và trường khác. Nếu số rule không bằng active_rule_count thì dừng migration.'],
  ['Bước 5', 'Chỉ thêm CONFIG_GLOBAL_ADD và CONFIG_THONG_BAO_ADD nếu khóa chưa tồn tại; thay các giá trị SET_... bằng ID/giá trị thật.'],
  ['Bước 6', 'Kiểm tra CONFIG_TOPIC có KIEM_KE ACTIVE cho chi nhánh; hoàn thành kiểm tra Gateway rồi mới tắt bảo trì.'],
  ['Nguồn', source],
];
readme.getRange('A1:B1').format = { fill: '#1F4E78', font: { name: 'Arial', size: 10, bold: true, color: '#FFFFFF' }, wrapText: true };
readme.getRange('A2:B9').format.font = { name: 'Arial', size: 10, color: '#1F2937' };
readme.getRange('B2:B9').format.wrapText = true;
readme.getRange('A1:A9').format.columnWidth = 18;
readme.getRange('B1:B9').format.columnWidth = 82;
readme.getRange('A2:B9').format.rowHeight = 42;
readme.freezePanes.freezeRows(1);

function addSheet(name, headers, rows = []) {
  const sheet = workbook.worksheets.add(name);
  sheet.showGridLines = false;
  sheet.getRangeByIndexes(0, 0, 1 + rows.length, headers.length).values = [headers, ...rows];
  const heading = sheet.getRangeByIndexes(0, 0, 1, headers.length);
  heading.format = { fill: '#1F4E78', font: { name: 'Arial', size: 10, bold: true, color: '#FFFFFF' }, wrapText: true, horizontalAlignment: 'center', verticalAlignment: 'center', borders: { preset: 'all', style: 'thin', color: '#FFFFFF' } };
  heading.format.rowHeight = 32;
  const used = sheet.getRangeByIndexes(0, 0, Math.max(1, 1 + rows.length), headers.length);
  used.format.font = { name: 'Arial', size: 10 };
  used.format.autofitColumns();
  for (let index = 0; index < headers.length; index += 1) {
    const longest = Math.max(headers[index].length, ...rows.map((row) => String(row[index] ?? '').length));
    sheet.getRangeByIndexes(0, index, 1 + rows.length, 1).format.columnWidth = Math.min(Math.max(longest + 5, 20), 62);
  }
  if (rows.length > 0) {
    const body = sheet.getRangeByIndexes(1, 0, rows.length, headers.length);
    body.format.wrapText = true;
    body.format.rowHeight = 32;
  }
  sheet.freezePanes.freezeRows(1);
  return sheet;
}

for (const [name, headers] of Object.entries(definitions)) addSheet(name, headers);
addSheet('CONFIG_SCHEMA_ADD', ruleHeader, schemaRows.map((row) => ruleHeader.map((key) => row[key] ?? '')));
addSheet('CONFIG_SCHEMA_UPDATE', schemaUpdateHeader, schemaUpdateRows);
addSheet('CONFIG_GLOBAL_ADD', globalHeader, globalRows);
addSheet('CONFIG_THONG_BAO_ADD', messageHeader, messageRows);

for (const name of ['README', ...Object.keys(definitions), 'CONFIG_SCHEMA_ADD', 'CONFIG_SCHEMA_UPDATE', 'CONFIG_GLOBAL_ADD', 'CONFIG_THONG_BAO_ADD']) {
  const inspected = await workbook.inspect({ kind: 'region', sheetId: name, range: name === 'README' ? 'A1:B9' : name === 'CONFIG_SCHEMA_UPDATE' ? 'A1:F6' : 'A1:E3', maxChars: 1600 });
  if (!inspected.ndjson) throw new Error(`Cannot inspect ${name}`);
  const preview = await workbook.render({ sheetName: name, range: name === 'CONFIG_SCHEMA_ADD' ? 'A1:M8' : undefined, autoCrop: name !== 'CONFIG_SCHEMA_ADD' ? 'all' : undefined, scale: 1, format: 'png' });
  await fs.writeFile(path.join(outputDir, `preview-${name}.png`), new Uint8Array(await preview.arrayBuffer()));
}
const errors = await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!', options: { useRegex: true, maxResults: 50 }, summary: 'formula error scan' });
if (errors.ndjson && /#REF!|#DIV\/0!|#VALUE!|#NAME\?|#N\/A|#NUM!|#NULL!|#SPILL!|#CALC!/.test(errors.ndjson)) throw new Error('Unexpected formula error');
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(path.join(outputDir, 'Issue-4-Sheet-Migration.xlsx'));
console.log(JSON.stringify({ path: path.join(outputDir, 'Issue-4-Sheet-Migration.xlsx'), schemaRules: schemaRows.length, schemaUpdates: schemaUpdateRows.length, sheets: 1 + Object.keys(definitions).length + 4 }));
