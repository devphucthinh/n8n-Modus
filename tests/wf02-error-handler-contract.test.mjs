import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildWorkflow } from '../tools/kiem-ke-bia-v2/build-workflows.mjs';
import { schemaManifest } from '../tools/kiem-ke-bia-v2/schema-manifest.mjs';
import { evaluateConfigGateway } from '../src/kiem-ke-bia-v2/logic/wf01-config-gateway.mjs';

const inputFields = [
  { name: 'error', type: 'object' },
  { name: 'context', type: 'object' },
  { name: 'reply_target', type: 'object' },
];

test('generated WF02 declares typed inputs and WF01 maps exactly those inputs', () => {
  const wf01 = buildWorkflow('WF01');
  const wf02 = buildWorkflow('WF02');
  const trigger = wf02.nodes.find((node) => node.name === 'Execute Workflow Trigger');
  const call = wf01.nodes.find((node) => node.name === 'Call Error Handler');
  assert.deepEqual(trigger?.parameters?.workflowInputs?.values, inputFields);
  assert.deepEqual(call?.parameters?.workflowInputs?.schema?.map(({ id, type }) => ({ id, type })), inputFields.map(({ name, type }) => ({ id: name, type })));
  assert.deepEqual(Object.keys(call?.parameters?.workflowInputs?.value ?? {}).sort(), ['context', 'error', 'reply_target']);
  assert.equal(wf02.active, false);
  assert.equal(wf02._kkb_v2.implementation_status, 'IMPLEMENTED_TEST_ONLY');
});

test('generated WF02 obtains notification config through WF01 and has safe audit/notification branches', () => {
  const wf02 = buildWorkflow('WF02');
  const sheets = wf02.nodes.filter((node) => node.type === 'n8n-nodes-base.googleSheets');
  assert.deepEqual(sheets.map((node) => [node.parameters.operation, node.parameters.sheetName.value]).sort(), [['append', 'ERROR_BIA'], ['append', 'EVENT_LOG'], ['append', 'EVENT_LOG'], ['append', 'OPERATION'], ['append', 'OPERATION'], ['read', 'ERROR_BIA'], ['read', 'EVENT_LOG'], ['read', 'OPERATION']]);
  assert.ok(wf02.nodes.some((node) => node.name === 'Call WF01 Config Gateway'));
  assert.ok(wf02.nodes.some((node) => node.name === 'Send Error Notification'));
  assert.ok(wf02.nodes.some((node) => node.name === 'WF02 Safe SYSTEM Fallback'));
  assert.equal(wf02.nodes.filter((node) => node.type === 'n8n-nodes-base.executeWorkflow' && node.name !== 'Call WF01 Config Gateway').length, 0);
});

test('generated WF02 Code nodes compile and every graph edge resolves', () => {
  const wf02 = buildWorkflow('WF02');
  const names = new Set(wf02.nodes.map((node) => node.name));
  for (const node of wf02.nodes) {
    if (node.type === 'n8n-nodes-base.code') assert.doesNotThrow(() => new vm.Script(`(function () { ${node.parameters.jsCode} })`), node.name);
  }
  for (const [source, outputs] of Object.entries(wf02.connections)) {
    assert.ok(names.has(source), source);
    for (const links of outputs.main ?? []) for (const link of links ?? []) assert.ok(names.has(link.node), `${source} -> ${link.node}`);
  }
  for (const node of wf02.nodes.filter((entry) => ['Append ERROR_BIA', 'Append EVENT_LOG', 'Send Error Notification'].includes(entry.name))) {
    assert.equal(node.onError, 'continueErrorOutput');
    assert.ok(wf02.connections[node.name].main[1].some((link) => link.node === 'WF02 Safe SYSTEM Fallback'));
  }
});

test('generated WF02 policy request contains only config sheets WF01 allows', () => {
  const wf02 = buildWorkflow('WF02');
  const normalizeNode = wf02.nodes.find((node) => node.name === 'Normalize Workflow Error');
  const requestNode = wf02.nodes.find((node) => node.name === 'Request WF02 Policy');
  const initial = { error: { error_code: 'TEST_FAILURE', error_class: 'SYSTEM' }, context: { request_id: 'req-policy', operation_id: 'op-policy', workflow_code: 'WF03', branch_id: 'BR1', config_snapshot_id: 'cfg-1' }, reply_target: { chat_id: '-100123', message_thread_id: '55' } };
  const normalized = vm.runInNewContext(`(function () { ${normalizeNode.parameters.jsCode} })()`, { $input: { first: () => ({ json: initial }) } })[0].json;
  const request = vm.runInNewContext(`(function () { ${requestNode.parameters.jsCode} })()`, { $: () => ({ first: () => ({ json: normalized }) }), $json: normalized })[0].json;
  const coreNames = ['CONFIG_SCHEMA', 'CONFIG_VERSION', 'CONFIG_GLOBAL', 'CONFIG_BRANCH', 'CONFIG_USER', 'CONFIG_THONG_BAO', 'CONFIG_SNAPSHOT', 'OPERATION', 'ERROR_BIA'];
  const tables = Object.fromEntries([...coreNames, 'CONFIG_TOPIC'].map((name) => [name, []]));
  const gateway = evaluateConfigGateway({ envelope: request, tables, now: '2026-09-29T00:00:00.000Z' });
  assert.equal(JSON.stringify(request.payload.required_sheet_names), JSON.stringify(['CONFIG_THONG_BAO', 'CONFIG_TOPIC']));
  assert.equal(gateway.response.error_code, 'CONFIG_SCHEMA_EMPTY');
  assert.notEqual(gateway.response.error_code, 'CONFIG_SHEET_NOT_ALLOWED');
});

test('WF01 preserves sanitized caller identity and recognized failure class in its WF02 mapping', () => {
  const wf01 = buildWorkflow('WF01');
  const returnNode = wf01.nodes.find((node) => node.name === 'Return WF01 Result');
  const errorCall = wf01.nodes.find((node) => node.name === 'Call Error Handler');
  const payload = {
    caller_context: { execution_id: 'exec-9', request_id: 'req-caller', operation_id: 'op-caller', workflow_code: 'WF03', node_name: 'Authorize User', branch_id: 'BR1', config_snapshot_id: 'snap-9', actor_user_id: 'user-9', business_date: '2026-09-28', authorization: 'private-auth-marker' },
    caller_reply_target: { chat_id: '-100987', message_thread_id: '73', token: 'private-token-marker' },
  };
  const returned = vm.runInNewContext(`(function () { ${returnNode.parameters.jsCode} })()`, {
    $: (name) => ({ first: () => ({ json: name === 'Evaluate WF01 Configuration'
      ? { ok: false, response: { status: 'ERROR', error_code: 'USER_NOT_ACTIVE', error_class: 'AUTHORIZATION', request_id: 'req-gateway', operation_id: 'op-gateway', message_safe: 'not active' } }
      : { payload } }) }),
  })[0].json;
  const resolve = (expression) => vm.runInNewContext(`(${expression.slice(3, -2)})`, { $json: returned });
  const mappedError = resolve(errorCall.parameters.workflowInputs.value.error);
  const mappedContext = resolve(errorCall.parameters.workflowInputs.value.context);
  const mappedReplyTarget = resolve(errorCall.parameters.workflowInputs.value.reply_target);
  assert.equal(mappedError.error_code, 'USER_NOT_ACTIVE');
  assert.equal(mappedError.error_class, 'AUTHORIZATION');
  assert.deepEqual(JSON.parse(JSON.stringify(mappedContext)), { execution_id: 'exec-9', request_id: 'req-caller', operation_id: 'op-caller', workflow_code: 'WF03', node_name: 'Authorize User', branch_id: 'BR1', config_snapshot_id: 'snap-9', actor_user_id: 'user-9', business_date: '2026-09-28' });
  assert.deepEqual(JSON.parse(JSON.stringify(mappedReplyTarget)), { chat_id: '-100987', message_thread_id: '73' });
  assert.equal(JSON.stringify({ returned, mappedError, mappedContext, mappedReplyTarget }).includes('private-auth-marker'), false);
  assert.equal(JSON.stringify({ returned, mappedError, mappedContext, mappedReplyTarget }).includes('private-token-marker'), false);
});

test('generated WF02 reads runtime state and stages audit rows before the committed visibility gate', () => {
  const wf02 = buildWorkflow('WF02');
  const reads = wf02.nodes.filter((node) => node.type === 'n8n-nodes-base.googleSheets' && node.parameters.operation === 'read');
  assert.deepEqual(reads.map((node) => node.parameters.sheetName.value).sort(), ['ERROR_BIA', 'EVENT_LOG', 'OPERATION']);
  for (const name of ['Prepare WF02 Error Transaction', 'WF02 Has Prepared Operation', 'Append WF02 Prepared Operation', 'WF02 Has ERROR_BIA Row', 'WF02 Has EVENT_LOG Row', 'WF02 Has Committed Operation', 'Append WF02 Committed Operation']) {
    assert.ok(wf02.nodes.some((node) => node.name === name), name);
  }
  assert.equal(wf02.connections['Apply WF02 Policy'].main[0][0].node, 'Prepare WF02 Error Transaction');
  assert.equal(wf02.connections['Append WF02 Prepared Operation'].main[0][0].node, 'WF02 Has ERROR_BIA Row');
  assert.equal(wf02.connections['Append ERROR_BIA'].main[0][0].node, 'WF02 Has EVENT_LOG Row');
  assert.equal(wf02.connections['Append EVENT_LOG'].main[0][0].node, 'WF02 Has Committed Operation');
  assert.equal(wf02.connections['Append WF02 Committed Operation'].main[0][0].node, 'Prepare Error Notification');
});

test('generated WF02 records notification delivery only after Telegram succeeds', () => {
  const wf02 = buildWorkflow('WF02');
  const telegram = wf02.nodes.find((node) => node.name === 'Send Error Notification');
  const delivered = wf02.nodes.find((node) => node.name === 'Project WF02 Notification Delivered');
  const append = wf02.nodes.find((node) => node.name === 'Append WF02 Notification Delivered');
  assert.ok(delivered);
  assert.ok(append);
  assert.equal(append.type, 'n8n-nodes-base.googleSheets');
  assert.equal(append.parameters.operation, 'append');
  assert.equal(append.parameters.sheetName.value, 'EVENT_LOG');
  assert.equal(wf02.connections['Send Error Notification'].main[0][0].node, 'Project WF02 Notification Delivered');
  assert.equal(wf02.connections['Project WF02 Notification Delivered'].main[0][0].node, 'Append WF02 Notification Delivered');
  assert.equal(wf02.connections['Append WF02 Notification Delivered'].main[0][0].node, 'Return WF02 Result');
  assert.ok(wf02.connections['Append WF02 Notification Delivered'].main[1].some((link) => link.node === 'WF02 Safe SYSTEM Fallback'));
  assert.equal(telegram.onError, 'continueErrorOutput');
});

test('generated WF02 notification cooldown reader ignores uncommitted EVENT_LOG rows', () => {
  const wf02 = buildWorkflow('WF02');
  const apply = wf02.nodes.find((node) => node.name === 'Apply WF02 Policy');
  assert.match(apply.parameters.jsCode, /visibleCommittedRows\(priorEvents, priorOperations\)/);
});
