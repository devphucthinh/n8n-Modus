const targets = [
  {
    workflow_name: 'WF05_V2_MO_PHIEN_KIEM_KE',
    node_name: 'Call Worker WF05_V2_MO_PHIEN_KIEM_KE',
    config_names: ['WF05_V2_MO_PHIEN_KIEM_KE'],
  },
  {
    workflow_name: 'WF06_V2_NHAN_SO_DEM',
    node_name: 'Call Worker WF06_V2_NHAN_SO_DEM',
    config_names: ['WF06_V2_NHAN_SO_DEM'],
  },
  {
    workflow_name: 'WF08_V2_HOA_DON_NHAP',
    node_name: 'Call Worker WF08_V2_HOA_DON_NHAP',
    config_names: ['WF08_V2_HOA_DON_NHAP', 'WF08_V2_PURCHASE_INGESTION'],
  },
  {
    workflow_name: 'WF09_V2_BAO_CAO_BAN',
    node_name: 'Call Worker WF09_V2_BAO_CAO_BAN',
    config_names: ['WF09_V2_BAO_CAO_BAN', 'WF09_V2_SALES_INGESTION'],
  },
];

export function resolveWorkerTarget(value) {
  const name = value == null ? '' : String(value).trim();
  return targets.find((target) => target.config_names.includes(name) || target.workflow_name === name) ?? null;
}

export function availableWorkerTargets() {
  return targets.map((target) => ({ ...target, config_names: [...target.config_names] }));
}
