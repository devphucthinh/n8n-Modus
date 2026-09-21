import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPurchaseWorkflow } from '../workflow-src/WF08_V2_HOA_DON_NHAP.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(path.join(root, 'workflows'), { recursive: true });
await writeFile(
  path.join(root, 'workflows', 'WF08_V2_HOA_DON_NHAP.json'),
  `${JSON.stringify(buildPurchaseWorkflow(), null, 2)}\n`,
  'utf8',
);
console.log('Built workflows/WF08_V2_HOA_DON_NHAP.json');
