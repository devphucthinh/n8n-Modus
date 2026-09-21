const PORT_METHODS = Object.freeze({
  sourceEvidenceStore: ['save'],
  ocrProvider: ['recognize'],
  ledgerStore: ['stage', 'commit'],
});

export function assertPurchasePorts(ports) {
  if (!ports || typeof ports !== 'object') throw new TypeError('purchase ports are required');
  for (const [portName, methods] of Object.entries(PORT_METHODS)) {
    if (!ports[portName] || typeof ports[portName] !== 'object') throw new TypeError(`${portName} port is required`);
    for (const method of methods) {
      if (typeof ports[portName][method] !== 'function') throw new TypeError(`${portName}.${method} is required`);
    }
  }
  return ports;
}

export const PURCHASE_PORT_METHODS = PORT_METHODS;
