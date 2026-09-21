export function convertQuantityToInventoryUnit({ source_quantity: sourceQuantity, source_unit: sourceUnit, inventory_unit: inventoryUnit, numerator, denominator }) {
  const quantity = Number(sourceQuantity);
  const factorNumerator = Number(numerator);
  const factorDenominator = Number(denominator);
  if (!Number.isFinite(quantity)) throw new TypeError('source_quantity must be a finite number');
  if (!sourceUnit || !inventoryUnit) throw new TypeError('source_unit and inventory_unit are required');
  if (!Number.isFinite(factorNumerator) || factorNumerator <= 0) throw new TypeError('numerator must be positive');
  if (!Number.isFinite(factorDenominator) || factorDenominator <= 0) throw new TypeError('denominator must be positive');
  return {
    source_quantity: quantity,
    source_unit: String(sourceUnit),
    inventory_quantity: quantity * factorNumerator / factorDenominator,
    inventory_unit: String(inventoryUnit),
    numerator: factorNumerator,
    denominator: factorDenominator,
  };
}

export function calculateConvertedUnitPrice({ line_total_before_vat: totalBeforeVat, line_discount_amount: lineDiscountAmount = 0, inventory_quantity: inventoryQuantity }) {
  const net = Number(totalBeforeVat) - Number(lineDiscountAmount);
  const quantity = Number(inventoryQuantity);
  if (!Number.isFinite(net)) throw new TypeError('line_total_before_vat must be a finite number');
  if (!Number.isFinite(quantity) || quantity <= 0) throw new TypeError('inventory_quantity must be positive');
  return net / quantity;
}
