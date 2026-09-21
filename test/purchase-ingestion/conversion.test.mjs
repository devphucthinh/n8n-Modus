import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateConvertedUnitPrice, convertQuantityToInventoryUnit } from '../../src/purchase-ingestion/conversion.mjs';

test('unit conversion keeps explicit inputs and calculates Giá nhập quy đổi', () => {
  const converted = convertQuantityToInventoryUnit({
    source_quantity: 2,
    source_unit: 'thùng',
    inventory_unit: 'chai',
    numerator: 24,
    denominator: 1,
  });

  assert.deepEqual(converted, {
    source_quantity: 2,
    source_unit: 'thùng',
    inventory_quantity: 48,
    inventory_unit: 'chai',
    numerator: 24,
    denominator: 1,
  });
  assert.equal(calculateConvertedUnitPrice({
    line_total_before_vat: 1_200_000,
    line_discount_amount: 120_000,
    inventory_quantity: converted.inventory_quantity,
  }), 22_500);
});

test('unit conversion rejects an incomplete conversion input instead of inferring a factor', () => {
  assert.throws(
    () => convertQuantityToInventoryUnit({
      source_quantity: 2,
      source_unit: 'thùng',
      inventory_unit: 'chai',
      numerator: 24,
    }),
    /denominator/i,
  );
});
