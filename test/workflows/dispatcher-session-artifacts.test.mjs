import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function workflow(name) {
  return JSON.parse(await readFile(path.join(root, 'workflows', `${name}.json`), 'utf8'));
}

test('WF04 has only a ten-minute technical tick and keeps business schedule in CONFIG_LICH', async () => {
  const dispatcher = await workflow('WF04_V2_DISPATCHER');
  const tick = dispatcher.nodes.find((node) => node.name === 'Technical Tick 10 Minutes');
  assert.deepEqual(tick.parameters.rule.interval, [{ field: 'minutes', minutesInterval: 10 }]);
  assert.match(tick.notes, /CONFIG_LICH/);
  assert.ok(dispatcher.nodes.some((node) => node.name === 'Claim DISPATCH_HISTORY'));
  assert.ok(dispatcher.nodes.some((node) => node.name === 'Record Dispatch Outcome'));
  assert.ok(dispatcher.nodes.some((node) => node.name === 'Finalize Dispatch History'));
  assert.ok(dispatcher.nodes.some((node) => node.name === 'Critical or recovery notice?'));
  assert.ok(dispatcher.nodes.some((node) => node.name === 'Call Error Handler'));
  assert.match(dispatcher.nodes.find((node) => node.name === 'Decide Dispatcher Actions').parameters.jsCode, /buildDispatchKey|CONFIG_LICH/);
});

test('WF05 writes one session and audit contract while preserving snapshot and date', async () => {
  const worker = await workflow('WF05_V2_MO_PHIEN_KIEM_KE');
  assert.ok(worker.nodes.some((node) => node.name === 'Call Config Gateway'));
  assert.ok(worker.nodes.some((node) => node.name === 'Write PHIEN_KIEM_KE'));
  assert.ok(worker.nodes.some((node) => node.name === 'Write EVENT_LOG'));
  const code = worker.nodes.find((node) => node.name === 'Open or Reuse Inventory Session').parameters.jsCode;
  assert.match(code, /business_date/);
  assert.match(code, /config_snapshot_id/);
  assert.match(code, /ACTIVE/);
});
