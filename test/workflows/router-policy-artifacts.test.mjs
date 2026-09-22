import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('WF03 keeps user-facing router messages in Sheet configuration', async () => {
  const workflow = JSON.parse(await readFile(path.join(root, 'workflows/WF03_V2_TELEGRAM_ROUTER.json'), 'utf8'));
  const routerDecision = workflow.nodes.find((node) => node.name === 'Router Decision');
  const code = routerDecision.parameters.jsCode;

  for (const fallback of [
    'Danh sách lệnh Kiểm kê bia V2:',
    'Chưa có mô tả',
    'Không yêu cầu',
    'Yêu cầu đã được xử lý.',
    'Đã tiếp nhận yêu cầu retry.',
    'Đã tiếp nhận lệnh.',
  ]) {
    assert.doesNotMatch(code, new RegExp(fallback.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), fallback);
  }
});
