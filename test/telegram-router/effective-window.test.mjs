import test from 'node:test';
import assert from 'node:assert/strict';
import { isWithinEffectiveWindow } from '../../src/telegram-router/effective-window.mjs';

test('effective role windows include both configured endpoints and treat blank bounds as open', () => {
  const from = '2026-09-20T00:00:00.000Z';
  const to = '2026-09-22T00:00:00.000Z';
  const assignment = { effective_from: from, effective_to: to };

  assert.equal(isWithinEffectiveWindow(assignment, from), true);
  assert.equal(isWithinEffectiveWindow(assignment, to), true);
  assert.equal(isWithinEffectiveWindow(assignment, '2026-09-19T23:59:59.999Z'), false);
  assert.equal(isWithinEffectiveWindow(assignment, '2026-09-22T00:00:00.001Z'), false);
  assert.equal(isWithinEffectiveWindow({ effective_from: '', effective_to: '' }, 'not-a-date'), true);
});

test('malformed effective dates or an invalid current time with bounded dates deny access', () => {
  assert.equal(isWithinEffectiveWindow({ effective_from: 'not-a-date', effective_to: '' }, '2026-09-21T00:00:00.000Z'), false);
  assert.equal(isWithinEffectiveWindow({ effective_from: '', effective_to: 'not-a-date' }, '2026-09-21T00:00:00.000Z'), false);
  assert.equal(isWithinEffectiveWindow({ effective_from: '2026-09-20T00:00:00.000Z', effective_to: '' }, 'not-a-date'), false);
});
