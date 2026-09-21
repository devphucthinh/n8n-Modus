const id = (name) => `kkb-v2-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

function node({ name, type, typeVersion = 2, parameters = {}, position = [0, 0], notes }) {
  return {
    parameters,
    id: id(name),
    name,
    type,
    typeVersion,
    position,
    ...(notes ? { notes } : {}),
  };
}

function link(connections, from, to) {
  connections[from] = { main: [[{ node: to, type: 'main', index: 0 }]] };
}

export function buildPurchaseWorkflow() {
  const trigger = node({
    name: 'Execute Workflow Trigger',
    type: 'n8n-nodes-base.executeWorkflowTrigger',
    typeVersion: 1.1,
    position: [0, 0],
  });
  const validate = node({
    name: 'Validate Purchase Envelope',
    type: 'n8n-nodes-base.code',
    parameters: {
      jsCode: `const input = $input.first()?.json ?? {};
if (!input.request_id || !input.operation_id) {
  return [{ json: { ok: false, status: 'ERROR', error_code: 'ENVELOPE_INVALID' } }];
}
return [{ json: { ...input, ok: true, status: 'READY_FOR_PURCHASE_ADAPTERS' } }];`,
    },
    position: [300, 0],
  });
  const gateway = node({
    name: 'Call Config Gateway',
    type: 'n8n-nodes-base.executeWorkflow',
    typeVersion: 1.2,
    parameters: {
      workflowId: { __rl: true, value: 'PASTE_WF01_WORKFLOW_ID', mode: 'id' },
      options: { waitForSubWorkflow: true },
    },
    position: [560, 0],
    notes: 'Read the validated config snapshot through WF01_V2_CONFIG_GATEWAY; do not read Google Sheets directly here.',
  });
  const adapterPlan = node({
    name: 'Build Purchase Adapter Plan',
    type: 'n8n-nodes-base.code',
    parameters: {
      jsCode: `const input = $input.first()?.json ?? {};
return [{ json: {
  ...input,
  adapter_ports: {
    source_evidence_store: 'GOOGLE_DRIVE_KKB_V2',
    ocr_provider: 'GEMINI_KKB_V2',
    ledger_store: 'GOOGLE_SHEETS_KKB_V2',
  },
  status: input.ok === false ? 'ERROR' : 'READY_FOR_ADAPTERS',
} }];`,
    },
    position: [820, 0],
    notes: 'Port boundary only. Configure credential names GOOGLE_DRIVE_KKB_V2, GEMINI_KKB_V2, and GOOGLE_SHEETS_KKB_V2 after import; no secrets are exported.',
  });
  const result = node({
    name: 'Return Purchase Ingestion Contract',
    type: 'n8n-nodes-base.code',
    parameters: {
      jsCode: `return [{ json: $input.first()?.json ?? {} }];`,
    },
    position: [1080, 0],
  });
  const nodes = [trigger, validate, gateway, adapterPlan, result];
  const connections = {};
  link(connections, trigger.name, validate.name);
  link(connections, validate.name, gateway.name);
  link(connections, gateway.name, adapterPlan.name);
  link(connections, adapterPlan.name, result.name);
  return {
    name: 'WF08_V2_HOA_DON_NHAP',
    nodes,
    connections,
    active: false,
    settings: { executionOrder: 'v1' },
    versionId: id('WF08_V2_HOA_DON_NHAP-version'),
    meta: { templateCredsSetupCompleted: false },
    pinData: {},
    tags: [],
  };
}

export default buildPurchaseWorkflow;
