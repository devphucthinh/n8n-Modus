const asText = (value) => (value == null ? '' : String(value).trim());

export function getActiveCommands(tables, locale = 'vi-VN') {
  return (Array.isArray(tables?.CONFIG_LENH) ? tables.CONFIG_LENH : [])
    .filter((row) => asText(row.trang_thai).toUpperCase() === 'ACTIVE')
    .filter((row) => !row.locale || asText(row.locale) === locale)
    .sort((left, right) => Number(asText(left.ordinal) || 0) - Number(asText(right.ordinal) || 0));
}

export function formatHelp({ tables, locale = 'vi-VN' } = {}) {
  const commands = getActiveCommands(tables, locale);
  const header = (tables?.CONFIG_THONG_BAO ?? []).filter((row) => asText(row.trang_thai).toUpperCase() === 'ACTIVE' && asText(row.locale || locale) === locale && asText(row.message_key) === 'HELP_HEADER').at(-1)?.message_text || '';
  const lines = [header];
  for (const row of commands) {
    const command = asText(row.command_text) || asText(row.command_code);
    const syntax = asText(row.syntax) || command;
    const description = asText(row.description_vi);
    const permission = asText(row.permission_code);
    const example = asText(row.example) || syntax;
    lines.push(`${command} — ${description}`);
    lines.push(`  Cú pháp: ${syntax}`);
    lines.push(`  Quyền: ${permission || 'Không yêu cầu'}`);
    lines.push(`  Ví dụ: ${example}`);
  }
  return { text: lines.join('\n') };
}
