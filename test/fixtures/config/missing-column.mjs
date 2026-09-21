import { validConfig } from './valid-config.mjs';

export function missingColumn() {
  const tables = validConfig();
  tables.CONFIG_BRANCH = tables.CONFIG_BRANCH.map(({ timezone: _timezone, ...row }) => row);
  return tables;
}
