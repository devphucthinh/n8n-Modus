import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";
import { schemaManifest } from "./schema-manifest.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packageDir = path.join(repoRoot, "outputs", "kiem-ke-bia-v2-2026-09-29");
const workflowDir = path.join(packageDir, "workflows");
const workbookPath = path.join(packageDir, "KKB_V2_WORKBOOK_TEMPLATE.xlsx");
const expectedFiles = [
  "WF01_CONFIG_GATEWAY.json",
  "WF02_ERROR_HANDLER.json",
  "WF03_TELEGRAM_ROUTER.json",
  "WF04_DISPATCHER.json",
  "WF05_OPEN_SESSION.json",
  "WF06_COUNT_INTAKE.json",
  "WF07_RECONCILE_CLOSE.json",
  "WF08_INVOICE_INGESTION.json",
  "WF09_SALES_INGESTION.json",
  "WF10_REPORTING.json",
  "WF11_WEEKLY_ARCHIVE.json",
  "WF12_BACKUP_RECOVERY.json",
];

const failures = [];
const checks = [];

function assertCheck(condition, message) {
  if (!condition) failures.push(message);
  else checks.push(message);
}

function jsonLines(text) {
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function validateWorkflow(workflow, fileName) {
  assertCheck(workflow.active === false, `${fileName}: active=false`);
  assertCheck(Array.isArray(workflow.nodes) && workflow.nodes.length > 0, `${fileName}: has nodes`);
  const nodeNames = new Set(workflow.nodes.map((node) => node.name));
  const nodeIds = new Set(workflow.nodes.map((node) => node.id));
  assertCheck(nodeNames.size === workflow.nodes.length, `${fileName}: node names unique`);
  assertCheck(nodeIds.size === workflow.nodes.length, `${fileName}: node ids unique`);
  for (const [from, connection] of Object.entries(workflow.connections ?? {})) {
    assertCheck(nodeNames.has(from), `${fileName}: connection source exists: ${from}`);
    for (const outputs of connection.main ?? []) {
      for (const link of outputs ?? []) assertCheck(nodeNames.has(link.node), `${fileName}: connection target exists: ${link.node}`);
    }
  }

  const sheetNodes = workflow.nodes.filter((node) => node.type === "n8n-nodes-base.googleSheets");
  for (const node of sheetNodes) {
    const sheetName = node.parameters.sheetName?.value;
    assertCheck(schemaManifest.sheets.some((entry) => entry.name === sheetName), `${fileName}: sheet reference exists: ${sheetName}`);
    assertCheck(node.parameters.documentId?.value === "GOOGLE_SHEET_ID_CONFIGURE", `${fileName}: sheet ID is placeholder`);
    assertCheck(node.credentials?.googleSheetsOAuth2Api?.name === "GOOGLE_SHEETS_KKB_V2", `${fileName}: Sheets credential placeholder`);
    if (node.parameters.operation === "read") {
      assertCheck(node.executeOnce === true, `${fileName}/${node.name}: executeOnce=true`);
      assertCheck(node.alwaysOutputData === true, `${fileName}/${node.name}: alwaysOutputData=true`);
      assertCheck(node.parameters.options?.returnAll === true, `${fileName}/${node.name}: returnAll=true`);
    }
  }

  for (const node of workflow.nodes.filter((entry) => entry.type === "n8n-nodes-base.code")) {
    try {
      new Function(node.parameters.jsCode);
      assertCheck(true, `${fileName}/${node.name}: Code syntax parses`);
    } catch (error) {
      assertCheck(false, `${fileName}/${node.name}: Code syntax error: ${error.message}`);
    }
  }

  for (const node of workflow.nodes.filter((entry) => entry.type === "n8n-nodes-base.executeWorkflow")) {
    const workflowId = node.parameters.workflowId?.value;
    assertCheck(String(workflowId).includes("WORKFLOW_ID_CONFIGURE"), `${fileName}/${node.name}: workflow ID placeholder/expression`);
  }
}

async function validateWorkbook() {
  const blob = await FileBlob.load(workbookPath);
  const workbook = await SpreadsheetFile.importXlsx(blob);
  const sheetSummary = await workbook.inspect({ kind: "sheet", include: "id,name", maxChars: 20000 });
  const sheetRecords = jsonLines(sheetSummary.ndjson).filter((record) => record.kind === "sheet");
  assertCheck(sheetRecords.length === schemaManifest.sheets.length, `Workbook sheet count=${schemaManifest.sheets.length}`);
  const names = sheetRecords.map((record) => record.name);
  assertCheck(JSON.stringify(names) === JSON.stringify(schemaManifest.sheets.map((entry) => entry.name)), "Workbook sheet order matches manifest");
  for (const entry of schemaManifest.sheets) {
    const sheet = workbook.worksheets.getItem(entry.name);
    const values = sheet.getRangeByIndexes(0, 0, 1, entry.headers.length).values[0];
    assertCheck(JSON.stringify(values) === JSON.stringify(entry.headers), `${entry.name}: header row matches manifest`);
  }
  const errors = await workbook.inspect({
    kind: "match",
    searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",
    options: { useRegex: true, maxResults: 300 },
    summary: "package workbook formula error scan",
  });
  assertCheck(/matched 0 entries/i.test(errors.ndjson), "Workbook formula error scan is empty");
}

async function main() {
  const packageEntries = await fs.readdir(packageDir);
  assertCheck(packageEntries.includes("KKB_V2_WORKBOOK_TEMPLATE.xlsx"), "Workbook output exists");
  assertCheck(packageEntries.includes("WORKFLOW_MANIFEST.json"), "Workflow manifest exists");
  const workflowEntries = await fs.readdir(workflowDir);
  assertCheck(expectedFiles.every((fileName) => workflowEntries.includes(fileName)), "All 12 workflow files exist");

  const workflows = [];
  for (const fileName of expectedFiles) {
    const workflow = await readJson(path.join(workflowDir, fileName));
    workflows.push(workflow);
    validateWorkflow(workflow, fileName);
  }

  const telegramTriggers = workflows.flatMap((workflow) => workflow.nodes.filter((node) => node.type === "n8n-nodes-base.telegramTrigger").map((node) => workflow.name));
  assertCheck(telegramTriggers.length === 1 && telegramTriggers[0] === "WF03_V2_TELEGRAM_ROUTER", "Exactly one Telegram Trigger in WF03");
  const dispatcher = workflows.find((workflow) => workflow.name === "WF04_V2_DISPATCHER");
  const scheduleNodes = dispatcher.nodes.filter((node) => node.type === "n8n-nodes-base.scheduleTrigger");
  assertCheck(scheduleNodes.length === 1, "WF04 has one schedule trigger");
  assertCheck(scheduleNodes[0]?.parameters.rule.interval[0].minutesInterval === 10, "WF04 schedule interval is 10 minutes");
  assertCheck(workflows.every((workflow) => workflow.nodes.filter((node) => node.type === "n8n-nodes-base.telegramTrigger").length === (workflow.name === "WF03_V2_TELEGRAM_ROUTER" ? 1 : 0)), "No non-router Telegram trigger");

  const serialized = JSON.stringify(workflows);
  for (const forbidden of ["1wQ", "WEL", "MoG", ["BEGIN", "PRIVATE", "KEY"].join(" ")]) {
    assertCheck(!serialized.includes(forbidden), `No forbidden live/private marker: ${forbidden}`);
  }
  assertCheck(!serialized.match(/\b\d{8,}:[A-Za-z0-9_-]{20,}\b/), "No Telegram token-shaped value");

  await validateWorkbook();
  console.log(JSON.stringify({
    status: failures.length === 0 ? "PASS" : "FAIL",
    checks: checks.length,
    failures,
    workflowCount: workflows.length,
    workbookSheetCount: schemaManifest.sheets.length,
  }, null, 2));
  if (failures.length > 0) process.exitCode = 1;
}

await main();
