import { validConfig } from './valid-config.mjs';

export function duplicateKey() {
  const tables = validConfig();
  tables.CONFIG_USER.push({ ...tables.CONFIG_USER[0], display_name: 'Người kiểm thử thứ hai' });
  return tables;
}
