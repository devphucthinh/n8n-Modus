import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWorkflowError } from '../../src/error-handler/normalize-error.mjs';
import { FIXED_NOW } from '../fixtures/config/valid-config.mjs';

test('redacts nested secret-like keys and returns a safe error reference', () => {
  const result = normalizeWorkflowError({
    error: {
      code: 'CONFIG_COLUMN_MISSING',
      message: 'Missing CONFIG_BRANCH.timezone',
      credential: 'do-not-copy',
      context: { authorization: 'Bearer hidden', sheet: 'CONFIG_BRANCH' },
    },
    context: { request_id: 'req-001', operation_id: 'op-001', workflow: 'WF01_V2_CONFIG_GATEWAY' },
    now: FIXED_NOW,
  });

  assert.equal(result.response.ok, false);
  assert.match(result.response.message_safe, /error_id/);
  assert.doesNotMatch(JSON.stringify(result), /do-not-copy|Bearer hidden/);
});

test('classifies transient errors as retryable and caps persisted text', () => {
  const result = normalizeWorkflowError({
    error: { code: 'ETIMEDOUT', message: 'x'.repeat(5000) },
    context: { request_id: 'req-001', operation_id: 'op-001', workflow: 'WF01_V2_CONFIG_GATEWAY', node: 'Google Sheets' },
    now: FIXED_NOW,
  });

  assert.equal(result.response.retryable, true);
  assert.equal(result.error_row.error_class, 'TRANSIENT');
  assert.ok(result.error_row.message_safe.length <= 256);
  assert.ok(result.error_row.workflow.length <= 256);
});

test('returns a stable fingerprint for the same sanitized failure context', () => {
  const input = {
    error: { code: 'CONFIG_COLUMN_MISSING', message: 'Missing CONFIG_BRANCH.timezone', credential: 'secret-a' },
    context: { request_id: 'req-001', operation_id: 'op-001', workflow: 'WF01_V2_CONFIG_GATEWAY' },
    now: FIXED_NOW,
  };
  const first = normalizeWorkflowError(input);
  const second = normalizeWorkflowError({ ...input, error: { ...input.error, credential: 'secret-b' } });
  assert.equal(first.error_row.fingerprint, second.error_row.fingerprint);
  assert.equal(first.response.error_id, second.response.error_id);
});

test('renders the configured message for a shared error code', () => {
  const result = normalizeWorkflowError({
    error: { error_code: 'DISPATCH_ACTIVE_SESSION_EXISTS', message_key: 'DISPATCH_ACTIVE_SESSION_EXISTS' },
    context: { request_id: 'req-dispatch-1', operation_id: 'op-dispatch-1', workflow: 'WF04_V2_DISPATCHER' },
    messages: { DISPATCH_ACTIVE_SESSION_EXISTS: 'Đã có phiên hoạt động. Mã lỗi: {error_id}' },
    now: FIXED_NOW,
  });

  assert.match(result.response.message_safe, /^Đã có phiên hoạt động\. Mã lỗi: err-/);
});
