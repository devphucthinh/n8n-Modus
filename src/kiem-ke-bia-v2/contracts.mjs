// Pure V2 boundary helpers. Keep each function self-contained so the emitter
// can embed the exact tested function body in an n8n Code node.

export function normalizeEnvelope(input, workflowCode) {
  const invalid = (field) => ({
    ok: false,
    error: {
      error_code: 'INVALID_ENVELOPE', error_class: 'VALIDATION', retryable: false,
      message_safe: 'Required workflow input is missing or invalid.', field,
      workflow_code: typeof workflowCode === 'string' ? workflowCode : '',
    },
  });
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid('envelope');
  if (input.envelope_version !== 'v2') return invalid('envelope_version');
  for (const field of ['request_id', 'operation_id', 'event_type', 'branch_id', 'config_snapshot_id']) {
    const value = input[field];
    if (typeof value !== 'string' || !value.trim() || /_CONFIGURE$/.test(value)) return invalid(field);
  }
  if (typeof workflowCode !== 'string' || !/^WF\d{2}$/.test(workflowCode)) return invalid('workflow_code');
  if (input.payload !== undefined && (input.payload === null || typeof input.payload !== 'object' || Array.isArray(input.payload))) return invalid('payload');
  if (input.reply_target !== undefined && (input.reply_target === null || typeof input.reply_target !== 'object' || Array.isArray(input.reply_target))) return invalid('reply_target');
  return { ok: true, envelope: { ...input, workflow_code: workflowCode } };
}

export function success(envelope, status, data, warnings = []) {
  return {
    ok: true,
    request_id: envelope.request_id, operation_id: envelope.operation_id,
    event_type: envelope.event_type, branch_id: envelope.branch_id,
    actor_user_id: envelope.actor_user_id, business_date: envelope.business_date,
    config_version: envelope.config_version, config_snapshot_id: envelope.config_snapshot_id,
    workflow_code: envelope.workflow_code,
    status, data, warnings,
  };
}

export function failure(envelope, error) {
  // Only codes reviewed as safe for external results may cross this boundary.
  const trustedCodes = new Set(['INVALID_ENVELOPE', 'BAD_COUNT', 'UNEXPECTED_ERROR']);
  const code = trustedCodes.has(error?.error_code) ? error.error_code : 'UNEXPECTED_ERROR';
  const classes = ['VALIDATION', 'AUTHORIZATION', 'CONFLICT', 'TRANSIENT', 'CONFIGURATION', 'EXTERNAL', 'SYSTEM', 'MANUAL_REVIEW'];
  const errorClass = classes.includes(error?.error_class) ? error.error_class : 'SYSTEM';
  return {
    ok: false,
    request_id: envelope?.request_id, operation_id: envelope?.operation_id,
    event_type: envelope?.event_type, branch_id: envelope?.branch_id,
    actor_user_id: envelope?.actor_user_id, business_date: envelope?.business_date,
    config_version: envelope?.config_version, config_snapshot_id: envelope?.config_snapshot_id,
    workflow_code: envelope?.workflow_code,
    node_name: typeof error?.node_name === 'string' && /^[A-Za-z0-9 _-]{1,80}$/.test(error.node_name) ? error.node_name : undefined,
    error_code: code, error_class: errorClass, retryable: error?.retryable === true,
    message_safe: 'The operation could not be completed.',
  };
}

// Dependency-free SHA-256 over UTF-8 text; self-contained so workflow builders
// can embed this exact tested function in an n8n Code node.
export function sha256Hex(input) {
  if (typeof input !== 'string') throw new TypeError('sha256Hex requires a string');
  const bytes = [];
  for (const character of input) {
    const codePoint = character.codePointAt(0);
    if (codePoint < 0x80) bytes.push(codePoint);
    else if (codePoint < 0x800) bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
    else if (codePoint < 0x10000) bytes.push(0xe0 | (codePoint >>> 12), 0x80 | ((codePoint >>> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    else bytes.push(0xf0 | (codePoint >>> 18), 0x80 | ((codePoint >>> 12) & 0x3f), 0x80 | ((codePoint >>> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
  }
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  for (const word of [high, low]) {
    bytes.push((word >>> 24) & 0xff, (word >>> 16) & 0xff, (word >>> 8) & 0xff, word & 0xff);
  }

  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const rotate = (word, count) => (word >>> count) | (word << (32 - count));
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Array(64);
    for (let index = 0; index < 16; index++) {
      const at = offset + index * 4;
      words[index] = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
    }
    for (let index = 16; index < 64; index++) {
      const x = words[index - 15];
      const y = words[index - 2];
      const s0 = rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3);
      const s1 = rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index++) {
      const sum1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choose + k[index] + words[index]) >>> 0;
      const sum0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    for (const [index, value] of [a, b, c, d, e, f, g, h].entries()) state[index] = (state[index] + value) >>> 0;
  }
  return state.map((word) => word.toString(16).padStart(8, '0')).join('');
}

export function stableKey(parts) {
  if (!Array.isArray(parts) || parts.length === 0) throw new TypeError('stableKey requires a nonempty array');
  const canonical = (value) => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && Object.prototype.toString.call(value) === '[object Object]') {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    }
    throw new TypeError('stableKey parts must contain only JSON values');
  };
  return `kkb2_sha256_${sha256Hex(canonical(parts))}`;
}
