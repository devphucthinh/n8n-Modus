import test from 'node:test';
import assert from 'node:assert/strict';
import { requiredSheetNames } from '../../src/telegram-router/required-sheet-names.mjs';

test('/help requests the command catalog and permission catalog from the Config Gateway', () => {
  assert.deepEqual(requiredSheetNames('/help'), ['CONFIG_LENH', 'CONFIG_PERMISSION']);
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
