const asText = (value) => (value == null ? '' : String(value).trim());
const validMessageId = (value) => /^[1-9]\d*$/.test(asText(value));

export function planBubbleAction(session = {}) {
  const messageId = asText(session.master_message_id);
  const status = asText(session.status).toUpperCase();
  const state = asText(session.bubble_state).toUpperCase() || 'NONE';
  if (status === 'ACTIVE' && validMessageId(messageId) && state === 'SENT') {
    return { action: 'EDIT', message_id: messageId };
  }
  if (status === 'PREPARED' && state === 'NONE' && !messageId) {
    return { action: 'MARK_SEND_REQUESTED' };
  }
  return { action: 'RECONCILE', error_code: 'INVENTORY_BUBBLE_RECONCILIATION_REQUIRED' };
}

export function markSendRequested(session, now = new Date().toISOString()) {
  if (planBubbleAction(session).action !== 'MARK_SEND_REQUESTED') {
    throw new Error('INVENTORY_SEND_NOT_SAFE');
  }
  return { ...session, status: 'SEND_REQUESTED', bubble_state: 'SEND_REQUESTED', updated_at: now };
}

export function observeTelegramSend(session, response, now = new Date().toISOString()) {
  const message = response?.result && typeof response.result === 'object' ? response.result : response;
  const messageId = message?.message_id;
  const sameChat = asText(message?.chat?.id) === asText(session?.chat_id);
  const sameThread = asText(message?.message_thread_id) === asText(session?.message_thread_id);
  if (!response?.error && response?.ok !== false && asText(session?.status) === 'SEND_REQUESTED'
    && validMessageId(messageId) && sameChat && sameThread) {
    return {
      ok: true,
      can_commit: true,
      patch: {
        session_id: asText(session.session_id), dispatch_key: asText(session.dispatch_key),
        master_message_id: asText(messageId), bubble_state: 'SENT', status: 'PREPARED', updated_at: now,
      },
    };
  }
  return {
    ok: false,
    can_commit: false,
    error_code: 'INVENTORY_BUBBLE_RECONCILIATION_REQUIRED',
    patch: {
      session_id: asText(session?.session_id), dispatch_key: asText(session?.dispatch_key),
      master_message_id: asText(session?.master_message_id),
      bubble_state: 'RECONCILIATION_REQUIRED', status: 'RECONCILIATION_REQUIRED', updated_at: now,
    },
  };
}

export function recordPinOutcome(session, response) {
  const pinned = !response?.error && response?.ok !== false && (response === true || response?.result === true);
  return {
    pinned,
    warning_code: pinned ? '' : 'INVENTORY_PIN_FAILED',
    session: { ...session },
  };
}

export function observeTelegramEdit(session, response) {
  const knownBubble = planBubbleAction(session).action === 'EDIT'
    && asText(session?.chat_id) && asText(session?.message_thread_id);
  const errorText = asText(response?.error?.description || response?.error?.message || response?.error || response?.description);
  const unchanged = /^(?:Bad Request: )?message is not modified(?:: specified new message content and reply markup are exactly the same as a current content and reply markup of the message)?$/i.test(errorText);
  const message = response?.result && typeof response.result === 'object' ? response.result : response;
  const sameMessage = !response?.error && response?.ok !== false
    && asText(message?.message_id) === asText(session?.master_message_id)
    && asText(message?.chat?.id) === asText(session?.chat_id)
    && asText(message?.message_thread_id) === asText(session?.message_thread_id);
  return {
    edit_ok: Boolean(knownBubble && (unchanged || sameMessage)),
    session_id: asText(session?.session_id),
    master_message_id: asText(session?.master_message_id),
  };
}

const escapeHtml = (value) => asText(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function renderInventoryBubble(session, { page = 1 } = {}) {
  let catalog;
  try { catalog = JSON.parse(asText(session?.catalog_snapshot_json)); } catch { catalog = null; }
  const pageSize = Number(session?.page_size);
  if (!Array.isArray(catalog) || catalog.length === 0 || !Number.isSafeInteger(pageSize) || pageSize <= 0) {
    throw new Error('INVENTORY_BUBBLE_CONTEXT_INVALID');
  }
  const pageCount = Math.ceil(catalog.length / pageSize);
  if (!Number.isSafeInteger(page) || page < 1 || page > pageCount) throw new Error('INVENTORY_PAGE_INVALID');
  const rows = catalog.slice((page - 1) * pageSize, page * pageSize);
  const opening = !asText(session?.master_message_id)
    && ['PREPARED', 'SEND_REQUESTED'].includes(asText(session?.status).toUpperCase())
    && ['NONE', 'SEND_REQUESTED'].includes(asText(session?.bubble_state).toUpperCase());
  const progress = { known: opening, counted: opening ? 0 : null, total: catalog.length };
  const text = [
    `Kiểm kê bia — ${escapeHtml(session.branch_id)} — ${escapeHtml(session.business_date)}`,
    `Trang ${page}/${pageCount}`,
    opening ? `Đã đếm: 0/${catalog.length}` : 'Tiến độ chưa được tải.',
    ...rows.map((beer) => `${beer.stt}. ${escapeHtml(beer.ma_bia)} — ${escapeHtml(beer.ten_bia)} (${escapeHtml(beer.don_vi_dem)}) — ${opening ? 'chưa đếm' : 'chưa tải số'}`),
  ].join('\n');
  if (text.length > 4000) throw new Error('INVENTORY_BUBBLE_TOO_LONG');
  return { text, page, page_count: pageCount, rows, progress };
}
