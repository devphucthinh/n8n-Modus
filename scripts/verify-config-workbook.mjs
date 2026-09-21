import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { ALL_SHEET_DEFINITIONS, ALL_SHEET_NAMES } from '../src/contracts/core-sheet-schema.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workbookPath = path.join(root, 'outputs', 'issue-2', 'KKB_V2_CONFIG_BASELINE.xlsx');
const artifactRoot = process.env.KKB_ARTIFACT_TOOL_ROOT || 'C:/Users/TD-996/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool';
const { FileBlob, SpreadsheetFile } = await import(pathToFileURL(path.join(artifactRoot, 'dist', 'artifact_tool.mjs')).href);
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));
const evidence = { workbook: workbookPath, sheets: [], errors: [] };
for (const sheetName of ALL_SHEET_NAMES) {
  const sheet = workbook.worksheets.getItem(sheetName);
  const values = sheet.getUsedRange()?.values ?? [];
  const columns = values[0] ?? [];
  const expected = ALL_SHEET_DEFINITIONS[sheetName];
  if (JSON.stringify(columns) !== JSON.stringify(expected)) evidence.errors.push(`${sheetName}: header mismatch`);
  const flat = values.flat().map((value) => String(value ?? ''));
  if (flat.some((value) => /#(?:REF|DIV\/0|VALUE|NAME|N\/A)!/i.test(value))) evidence.errors.push(`${sheetName}: formula error token found`);
  evidence.sheets.push({ name: sheetName, rows: values.length, columns: columns.length });
}
await fs.writeFile(path.join(root, 'outputs', 'issue-2', 'verification.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
if (evidence.errors.length) {
  console.error(evidence.errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Verified ${evidence.sheets.length} sheets with no formula errors`);
}
