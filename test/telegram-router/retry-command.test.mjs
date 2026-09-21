import test from 'node:test';
import assert from 'node:assert/strict';
import { planRetry } from '../../src/telegram-router/retry-command.mjs';
import { FIXED_NOW, validConfigWithRouterTables } from '../fixtures/config/valid-config.mjs';

test('retry keeps the original operation key and rejects non-retryable errors', () => {
  const tables = validConfigWithRouterTables();
  const result = planRetry({ actorUserId: 'admin-1', errorId: 'err-42', tables, now: FIXED_NOW });
  assert.equal(result.ok, true);
  assert.equal(result.retry.operation_id, 'op-original-42');
  assert.equal(result.retry.idempotency_key, 'tg-original-42');

  tables.ERROR_BIA[0].retryable = 'NO';
  const denied = planRetry({ actorUserId: 'admin-1', errorId: 'err-42', tables, now: FIXED_NOW });
  assert.equal(denied.ok, false);
  assert.equal(denied.response.error_code, 'ERROR_NOT_RETRYABLE');
});
