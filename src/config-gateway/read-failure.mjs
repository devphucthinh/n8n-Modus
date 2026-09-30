const TRANSIENT_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'RESOURCE_EXHAUSTED']);

export function classifySheetReadFailure(item) {
  const error = item?.error ?? item?.json?.error;
  if (error == null) return null;
  const status = Number(error?.httpCode ?? error?.statusCode ?? error?.status ?? error?.response?.statusCode);
  const code = String(error?.code ?? error?.cause?.code ?? '').toUpperCase();
  if (status === 429 || (status >= 500 && status <= 599) || TRANSIENT_CODES.has(code)) return 'CONFIG_READ_UNAVAILABLE';
  if (status === 404) return 'CONFIG_SHEET_MISSING';
  // Unknown/ambiguous failures fail closed. Never classify them from raw
  // message text, which can contain private data or a misleading HTTP phrase.
  return 'CONFIG_SHEET_READ_FAILED';
}
