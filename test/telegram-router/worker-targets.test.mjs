import test from 'node:test';
import assert from 'node:assert/strict';
import { availableWorkerTargets, resolveWorkerTarget } from '../../src/telegram-router/worker-targets.mjs';

test('resolves only delivered worker workflows and preserves supported Sheet aliases', () => {
  assert.equal(resolveWorkerTarget('WF05_V2_MO_PHIEN_KIEM_KE').workflow_name, 'WF05_V2_MO_PHIEN_KIEM_KE');
  assert.equal(resolveWorkerTarget('WF08_V2_PURCHASE_INGESTION').workflow_name, 'WF08_V2_HOA_DON_NHAP');
  assert.equal(resolveWorkerTarget('WF09_V2_SALES_INGESTION').workflow_name, 'WF09_V2_BAO_CAO_BAN');
  assert.equal(resolveWorkerTarget('WF12_V2_REPORTING'), null);
  assert.equal(availableWorkerTargets().some((target) => target.workflow_name === 'WF10_V2_BAO_CAO'), false);
});
