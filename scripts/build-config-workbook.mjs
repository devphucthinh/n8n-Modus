import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { CORE_SHEET_DEFINITIONS, CORE_SHEET_NAMES } from '../src/contracts/core-sheet-schema.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'outputs', 'issue-2');
const outputPath = path.join(outputDir, 'KKB_V2_CONFIG_BASELINE.xlsx');
const artifactRoot = process.env.KKB_ARTIFACT_TOOL_ROOT || 'C:/Users/TD-996/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool';
const { Workbook, SpreadsheetFile } = await import(pathToFileURL(path.join(artifactRoot, 'dist', 'artifact_tool.mjs')).href);

const header = (sheetName) => CORE_SHEET_DEFINITIONS[sheetName];
const row = (sheetName, values) => header(sheetName).map((column) => values[column] ?? '');
const schemas = {
  CONFIG_SCHEMA: CORE_SHEET_NAMES.flatMap((sheetName) => header(sheetName).map((columnName, ordinal) => row('CONFIG_SCHEMA', {
    schema_rule_id: `rule-${sheetName}-${columnName}`,
    schema_version: '1.0',
    sheet_name: sheetName,
    column_name: columnName,
    data_type: 'STRING',
    required: 'NO',
    unique_group: ['config_version', 'config_key', 'branch_id', 'user_id', 'message_key'].includes(columnName) ? `${sheetName}_KEY` : '',
    reference_sheet: sheetName === 'CONFIG_USER' && columnName === 'branch_id' ? 'CONFIG_BRANCH' : '',
    reference_column: sheetName === 'CONFIG_USER' && columnName === 'branch_id' ? 'branch_id' : '',
    allowed_values: '',
    ordinal: String(ordinal + 1),
    description_vi: `Cấu hình schema ${sheetName}.${columnName}`,
    trang_thai: 'ACTIVE',
  }))),
  CONFIG_VERSION: [row('CONFIG_VERSION', {
    config_version: 'v1', schema_version: '1.0', maintenance_mode: 'NO', changed_by: 'SET_IN_GOOGLE_SHEET', changed_at: '2026-09-19T01:00:00.000Z', change_note: 'Baseline V2 - thay đổi trực tiếp trên Google Sheet', trang_thai: 'ACTIVE',
  })],
  CONFIG_GLOBAL: [
    row('CONFIG_GLOBAL', { config_key: 'DEFAULT_TIMEZONE', config_value: 'Asia/Ho_Chi_Minh', value_type: 'STRING', description_vi: 'Múi giờ mặc định', trang_thai: 'ACTIVE' }),
    row('CONFIG_GLOBAL', { config_key: 'DEFAULT_LOCALE', config_value: 'vi-VN', value_type: 'STRING', description_vi: 'Locale hiển thị mặc định', trang_thai: 'ACTIVE' }),
  ],
  CONFIG_BRANCH: [row('CONFIG_BRANCH', { branch_id: 'CN_HN_TEST', branch_name: 'Chi nhánh mẫu - cần cấu hình', forum_chat_id: 'CHAT_ID_CONFIGURE', owner_chat_id: 'CHAT_ID_CONFIGURE', timezone: 'Asia/Ho_Chi_Minh', trang_thai: 'ACTIVE' })],
  CONFIG_USER: [row('CONFIG_USER', { user_id: 'USER_ID_CONFIGURE', display_name: 'Người dùng mẫu - cần cấu hình', branch_id: 'CN_HN_TEST', trang_thai: 'ACTIVE' })],
  CONFIG_THONG_BAO: [
    ['STATUS_HEADER', 'Trạng thái Kiểm kê bia V2'],
    ['STATUS_CONFIG_LINE', 'Cấu hình: {config_version}'],
    ['STATUS_BRANCH_COUNT_LINE', 'Chi nhánh hoạt động: {active_branch_count}'],
    ['STATUS_BRANCH_LINE', '- {branch_name} ({branch_id})'],
    ['STATUS_MAINTENANCE_LINE', 'Bảo trì cấu hình: {maintenance_mode}'],
    ['ERROR_GENERIC', 'Không thể hoàn tất thao tác. Mã lỗi: {error_id}'],
    ['USER_NOT_ACTIVE', 'Tài khoản chưa được cấp quyền hoạt động. Mã lỗi: {error_id}'],
    ['COMMAND_NOT_AVAILABLE', 'Lệnh này chưa được bật. Mã lỗi: {error_id}'],
  ].map(([message_key, message_text]) => row('CONFIG_THONG_BAO', { message_key, message_text, locale: 'vi-VN', trang_thai: 'ACTIVE' })),
  CONFIG_SNAPSHOT: [],
  OPERATION: [],
  ERROR_BIA: [],
};

function styleSheet(sheet, sheetName, rowCount, columnCount) {
  sheet.showGridLines = false;
  const used = sheet.getRangeByIndexes(0, 0, Math.max(rowCount, 1), columnCount);
  used.format.font = { name: 'Arial', size: 10, color: '#1F2937' };
  used.format.verticalAlignment = 'center';
  const headings = sheet.getRangeByIndexes(0, 0, 1, columnCount);
  headings.format = {
    fill: '#1F4E78',
    font: { name: 'Arial', size: 10, bold: true, color: '#FFFFFF' },
    horizontalAlignment: 'center',
    verticalAlignment: 'center',
    wrapText: true,
    borders: { preset: 'all', style: 'thin', color: '#FFFFFF' },
  };
  if (rowCount > 1) {
    const body = sheet.getRangeByIndexes(1, 0, rowCount - 1, columnCount);
    body.format.wrapText = false;
    body.format.borders = { preset: 'insideHorizontal', style: 'thin', color: '#D9E2F3' };
    if (['CONFIG_VERSION', 'CONFIG_GLOBAL', 'CONFIG_BRANCH', 'CONFIG_USER', 'CONFIG_THONG_BAO'].includes(sheetName)) body.format.fill = '#FFF2CC';
  }
  headings.format.rowHeight = 32;
  sheet.freezePanes.freezeRows(1);
  used.format.autofitColumns();
  for (let index = 0; index < columnCount; index += 1) {
    const width = Math.max(14, Math.min(42, String(header(sheetName)[index]).length + 4));
    sheet.getRangeByIndexes(0, index, rowCount, 1).format.columnWidth = width;
  }
  const changedAtColumn = header(sheetName).indexOf('changed_at');
  if (changedAtColumn >= 0 && rowCount > 1) sheet.getRangeByIndexes(1, changedAtColumn, rowCount - 1, 1).format.numberFormat = 'yyyy-mm-dd hh:mm';
}

function addValidation(sheet, sheetName) {
  const count = Math.max(schemas[sheetName].length + 1, 2);
  if (sheetName === 'CONFIG_VERSION') {
    sheet.getRange(`C2:C${count}`).dataValidation = { rule: { type: 'list', values: ['YES', 'NO'] } };
    sheet.getRange(`G2:G${count}`).dataValidation = { rule: { type: 'list', values: ['ACTIVE', 'INACTIVE'] } };
  }
  if (sheetName === 'CONFIG_SCHEMA') {
    sheet.getRange(`E2:E${count}`).dataValidation = { rule: { type: 'list', values: ['STRING', 'INTEGER', 'NUMBER', 'BOOLEAN', 'DATE', 'DATETIME'] } };
    sheet.getRange(`F2:F${count}`).dataValidation = { rule: { type: 'list', values: ['YES', 'NO'] } };
    sheet.getRange(`M2:M${count}`).dataValidation = { rule: { type: 'list', values: ['ACTIVE', 'INACTIVE'] } };
  }
  if (['CONFIG_GLOBAL', 'CONFIG_BRANCH', 'CONFIG_USER', 'CONFIG_THONG_BAO'].includes(sheetName)) {
    const statusColumn = header(sheetName).indexOf('trang_thai');
    const letter = String.fromCharCode(65 + statusColumn);
    sheet.getRange(`${letter}2:${letter}${count}`).dataValidation = { rule: { type: 'list', values: ['ACTIVE', 'INACTIVE'] } };
  }
}

const workbook = Workbook.create();
for (const sheetName of CORE_SHEET_NAMES) {
  const sheet = workbook.worksheets.add(sheetName);
  const columns = header(sheetName);
  const values = [columns, ...schemas[sheetName]];
  sheet.getRangeByIndexes(0, 0, values.length, columns.length).values = values;
  styleSheet(sheet, sheetName, values.length, columns.length);
  addValidation(sheet, sheetName);
}

workbook.recalculate();
const inspection = await workbook.inspect({ kind: 'workbook,sheet,table', maxChars: 12000, tableMaxRows: 3, tableMaxCols: 5, tableMaxCellChars: 80 });
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, 'inspect.json'), JSON.stringify(inspection, null, 2));
const preview = await workbook.render({ sheetName: 'CONFIG_VERSION', autoCrop: 'all', scale: 1, format: 'png' });
await fs.writeFile(path.join(outputDir, 'CONFIG_VERSION_preview.png'), new Uint8Array(await preview.arrayBuffer()));
const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(outputPath);
console.log(`Built ${outputPath}`);
