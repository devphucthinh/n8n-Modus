import { sourceFile, codeNode } from './helpers.mjs';

export async function errorCode() {
  return codeNode(`
${await sourceFile('src/config-gateway/sha256.mjs')}
${await sourceFile('src/error-handler/normalize-error.mjs')}

const input = $input.first()?.json ?? {};
const error = input.error ?? input;
const context = input.context ?? input.execution ?? input.envelope ?? input;
const result = normalizeWorkflowError({ error, context, messages: input.messages, now: new Date().toISOString() });
return [{ json: { ...result, reply_target: input.reply_target ?? context.reply_target ?? null } }];
`);
}

export function errorRowCode() {
  return codeNode(`
const normalized = $('Normalize Workflow Error').first()?.json ?? {};
return [{ json: normalized.error_row ?? {} }];
`);
}

export function returnErrorCode() {
  return codeNode(`
const normalized = $('Normalize Workflow Error').first()?.json ?? {};
return [{ json: normalized }];
`);
}
