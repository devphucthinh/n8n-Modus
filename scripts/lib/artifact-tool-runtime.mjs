import path from 'node:path';
import { pathToFileURL } from 'node:url';

const artifactRoot = process.env.KKB_ARTIFACT_TOOL_ROOT
  || 'C:/Users/TD-996/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool';

export async function loadArtifactToolRuntime() {
  return import(pathToFileURL(path.join(artifactRoot, 'dist', 'artifact_tool.mjs')).href);
}
