import { sourceFile, codeNode } from './helpers.mjs';

export async function errorCode() {
  return codeNode(`
${await sourceFile('src/config-gateway/sha256.mjs')}
${await sourceFile('src/error-handler/normalize-error.mjs')}

const input = $input.first()?.json ?? {};
const error = input.error ?? input;
const context = input.context ?? input.execution ?? {};
const result = normalizeWorkflowError({ error, context, messages: input.messages, now: new Date().toISOString() });
return [{ json: { ...result, reply_target: input.reply_target ?? context.reply_target ?? null } }];
`);
}
