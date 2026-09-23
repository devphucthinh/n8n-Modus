const effectiveWindowText = (value) => (value == null ? '' : String(value).trim());

export function isWithinEffectiveWindow(row, now) {
  const current = Date.parse(now);
  const from = effectiveWindowText(row?.effective_from);
  const to = effectiveWindowText(row?.effective_to);
  if (from && Number.isNaN(Date.parse(from))) return false;
  if (to && Number.isNaN(Date.parse(to))) return false;
  if ((from || to) && Number.isNaN(current)) return false;
  return (!from || current >= Date.parse(from))
    && (!to || current <= Date.parse(to));
}
