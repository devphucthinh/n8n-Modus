import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function stripModuleSyntax(source) {
  return source
    .split(/\r?\n/)
    .filter((line) => !/^\s*import\s/.test(line))
    .join('\n')
    .replace(/^export\s+default\s+/gm, '')
    .replace(/^export\s+(?=(?:const|function|class|async function)\b)/gm, '')
    .replace(/^export\s*\{[^}]*\};?\s*$/gm, '');
}

export async function sourceFile(relativePath) {
  return stripModuleSyntax(await readFile(path.join(root, relativePath), 'utf8'));
}

export function codeNode(body) {
  return body.trim();
}
