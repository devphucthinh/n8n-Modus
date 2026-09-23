import test from 'node:test';
import assert from 'node:assert/strict';
import { requiredSheetNames } from '../../src/telegram-router/required-sheet-names.mjs';

test('/help reads only the catalog and authorization context, not the audit log', () => {
  assert.deepEqual(requiredSheetNames('/help'), ['CONFIG_ROLE', 'CONFIG_PERMISSION', 'CONFIG_USER_ROLE', 'CONFIG_ROLE_PERMISSION', 'CONFIG_TOPIC', 'CONFIG_LENH']);
});

test('/trangthai remains core-only while operational commands request the full router context', () => {
  assert.deepEqual(requiredSheetNames('/trangthai'), []);
  assert.deepEqual(requiredSheetNames('/kiemke'), [
    'CONFIG_ROLE',
    'CONFIG_PERMISSION',
    'CONFIG_USER_ROLE',
    'CONFIG_ROLE_PERMISSION',
    'CONFIG_TOPIC',
    'CONFIG_LENH',
    'EVENT_LOG',
  ]);
});

test('/retry requests operational replay context while help and status do not', () => {
  assert.ok(requiredSheetNames('/retry').includes('RETRY_CONTEXT'));
  assert.equal(requiredSheetNames('/help').includes('RETRY_CONTEXT'), false);
  assert.deepEqual(requiredSheetNames('/trangthai'), []);
});
