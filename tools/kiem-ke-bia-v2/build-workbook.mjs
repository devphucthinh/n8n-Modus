import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";
import { schemaManifest } from "./schema-manifest.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const defaultOutput = path.join(repoRoot, "outputs", "kiem-ke-bia-v2-2026-09-29", "KKB_V2_WORKBOOK_TEMPLATE.xlsx");
const outputPath = path.resolve(process.argv[2] ?? defaultOutput);

const COLORS = {
  body: "#1F1F1F",
  lightBorder: "#D9E2F3",
  input: "#FFF2CC",
  protected: "#F2F2F2",
  docs: "#EAF2F8",
};

function columnLetter(index) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function widthFor(field) {
  const base = field.length + 2;
  if (field.endsWith("_json") || field === "description" || field === "purpose" || field === "template_text") return Math.min(30, Math.max(18, base));
  return Math.min(24, Math.max(12, base));
}

function formatFieldColumns(sheet, entry, rowCount) {
  entry.fields.forEach((field, index) => {
    const range = sheet.getRangeByIndexes(1, index, Math.max(rowCount, 2), 1);
    if (field.type === "number") range.format.numberFormat = "0.00";
    if (field.type === "date") range.format.numberFormat = "yyyy-mm-dd";
    if (field.type === "datetime") range.format.numberFormat = "yyyy-mm-dd hh:mm";
    if (field.type === "boolean") range.format.horizontalAlignment = "center";
    if (field.name === "status" || field.name === "trang_thai") {
      range.dataValidation = { rule: { type: "list", values: schemaManifest.statusValues } };
    }
    let width = widthFor(field.name);
    if (entry.name === "README" && field.name === "value") width = 52;
    if (entry.name === "TAB_CATALOG" && ["runtime_role", "writer_workflows", "reader_workflows", "notes"].includes(field.name)) width = 28;
    if (entry.name === "DATA_DICTIONARY" && field.name === "sheet_name") width = 24;
    if (entry.name === "DATA_DICTIONARY" && field.name === "field_name") width = 30;
    if (entry.name === "DATA_DICTIONARY" && field.name === "allowed_values_or_format") width = 30;
    if (entry.name === "DATA_DICTIONARY" && field.name === "purpose") width = 34;
    if (entry.name === "COPY_HEADERS" && field.name === "copy_instruction") width = 44;
    const columnRange = sheet.getRangeByIndexes(0, index, Math.max(rowCount, 2), 1);
    columnRange.format.columnWidth = width;
    if (field.type === "json" || ["value", "description", "notes", "allowed_values_or_format", "purpose", "copy_instruction", "template_text"].includes(field.name)) {
      range.format.wrapText = true;
      range.format.verticalAlignment = "top";
    }
  });
}

function styleSheet(sheet, entry, rowCount) {
  const totalRows = Math.max(rowCount, 2);
  const totalCols = entry.headers.length;
  const used = sheet.getRangeByIndexes(0, 0, totalRows, totalCols);
  const header = sheet.getRangeByIndexes(0, 0, 1, totalCols);

  sheet.tabColor = entry.tabColor;
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(1);

  used.format.font = { name: "Arial", size: 10, color: COLORS.body };
  used.format.verticalAlignment = "center";
  used.format.wrapText = false;
  header.format.fill = entry.tabColor;
  header.format.font = { name: "Arial", size: 10, bold: true, color: "#FFFFFF" };
  header.format.horizontalAlignment = "center";
  header.format.verticalAlignment = "center";
  header.format.wrapText = true;
  header.format.rowHeight = 36;
  header.format.borders = { preset: "outside", style: "thin", color: COLORS.lightBorder };

  if (entry.protection === "CONFIG_INPUT") {
    sheet.getRangeByIndexes(1, 0, Math.max(rowCount - 1, 1), totalCols).format.fill = COLORS.input;
  } else if (entry.protection === "PROTECTED_RUNTIME") {
    sheet.getRangeByIndexes(1, 0, Math.max(rowCount - 1, 1), totalCols).format.fill = COLORS.protected;
  } else if (entry.group === "docs") {
    sheet.getRangeByIndexes(1, 0, Math.max(rowCount - 1, 1), totalCols).format.fill = COLORS.docs;
  }

  if (entry.group === "docs") {
    sheet.getRangeByIndexes(1, 0, Math.max(rowCount - 1, 1), totalCols).format.rowHeight = entry.name === "DATA_DICTIONARY" ? 22 : 28;
  }

  formatFieldColumns(sheet, entry, totalRows);
}

async function main() {
  if (schemaManifest.sheetCount !== 50) throw new Error(`Expected 50 sheets, got ${schemaManifest.sheetCount}`);

  const workbook = Workbook.create();
  for (const entry of schemaManifest.sheets) {
    const sheet = workbook.worksheets.add(entry.name);
    const matrix = [entry.headers, ...entry.rows];
    sheet.getRangeByIndexes(0, 0, matrix.length, entry.headers.length).values = matrix;
    styleSheet(sheet, entry, matrix.length);
  }

  await workbook.recalculate();

  const outputDir = path.dirname(outputPath);
  await fs.mkdir(outputDir, { recursive: true });
  const renderDir = await fs.mkdtemp(path.join(os.tmpdir(), "kkb-v2-workbook-render-"));
  let rendered = 0;
  for (const entry of schemaManifest.sheets) {
    const lastColumn = columnLetter(entry.headers.length - 1);
    const lastRow = Math.min(entry.rows.length + 1, 30);
    const preview = await workbook.render({
      sheetName: entry.name,
      range: `A1:${lastColumn}${lastRow}`,
      scale: 1,
      format: "png",
    });
    await fs.writeFile(path.join(renderDir, `${String(rendered + 1).padStart(2, "0")}-${entry.name}.png`), new Uint8Array(await preview.arrayBuffer()));
    rendered += 1;
  }

  const inspect = await workbook.inspect({ kind: "sheet", include: "id,name", maxChars: 12000 });
  const errors = await workbook.inspect({
    kind: "match",
    searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",
    options: { useRegex: true, maxResults: 300 },
    summary: "final formula error scan",
  });

  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(outputPath);
  console.log(JSON.stringify({
    outputPath,
    sheetCount: schemaManifest.sheets.length,
    rendered,
    renderDir,
    inspect: inspect.ndjson,
    formulaErrors: errors.ndjson,
  }, null, 2));
}

await main();
