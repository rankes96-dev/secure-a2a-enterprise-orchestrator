import type { ConnectorActionDecision, ConnectorDecisionInput } from "./types.js";

function joinReasons(reasons: string[]): string {
  if (reasons.length === 0) {
    return "required application access grants and effective permissions are present";
  }

  return reasons.join(" and ");
}

export function decideConnectorActions(input: ConnectorDecisionInput): ConnectorActionDecision[] {
  const catalog = input.connectorProfile.skillCatalog.length ? input.connectorProfile.skillCatalog : input.connectorProfile.actionCatalog;
  const actionsById = new Map(catalog.map((action) => [action.id, action]));
  const requestedApplicationGrants = new Set(input.requestedApplicationGrants);
  const applicationAccessGrants = new Set(input.applicationAccessGrants);
  const effectivePermissions = new Set(input.effectivePermissions);
  const deniedPermissions = new Set(input.deniedPermissions);

  const declaredSkills = input.declaredSkills.length ? input.declaredSkills : input.declaredActions ?? [];
  return declaredSkills.map((actionId) => {
    const action = actionsById.get(actionId);
    if (!action) {
      return {
        actionId,
        label: actionId,
        status: "blocked",
        reason: `Unknown action for connector profile ${input.connectorProfile.connectorId}.`,
        requiredApplicationGrants: [],
        requiredEffectivePermissions: [],
        missingApplicationGrants: [],
        missingEffectivePermissions: [],
        deniedEffectivePermissions: []
      };
    }

    const requiredApplicationGrants = action.requiredApplicationGrants;
    const requiredEffectivePermissions = action.requiredEffectivePermissions;
    const requestedScopes = action.requestedScopes;
    const requiredApplicationGrantList = requiredApplicationGrants ?? [];
    const requiredEffectivePermissionList = requiredEffectivePermissions ?? [];
    const missingRequestedApplicationGrants = requiredApplicationGrantList.filter((grant) => !requestedApplicationGrants.has(grant));
    const missingApplicationGrants = requiredApplicationGrantList.filter((grant) => !applicationAccessGrants.has(grant));
    const missingEffectivePermissions = requiredEffectivePermissionList.filter((permission) => !effectivePermissions.has(permission) && !deniedPermissions.has(permission));
    const deniedEffectivePermissions = requiredEffectivePermissionList.filter((permission) => deniedPermissions.has(permission));
    const effectiveMissingApplicationGrants = [...new Set([...missingRequestedApplicationGrants, ...missingApplicationGrants])];
    const blockReasons = [
      ...(requiredApplicationGrants === undefined ? ["missing deterministic metadata requiredApplicationGrants"] : []),
      ...(requiredEffectivePermissions === undefined ? ["missing deterministic metadata requiredEffectivePermissions"] : []),
      ...(requestedScopes === undefined ? ["missing deterministic metadata requestedScopes"] : []),
      ...effectiveMissingApplicationGrants.map((grant) => `missing application access grant ${grant}`),
      ...missingEffectivePermissions.map((permission) => `missing effective permission ${permission}`),
      ...deniedEffectivePermissions.map((permission) => `denied permission ${permission}`)
    ];

    return {
      actionId,
      label: action.label,
      status: blockReasons.length === 0 ? "approved" : "blocked",
      reason: joinReasons(blockReasons),
      riskLevel: action.riskLevel,
      executionType: action.executionType,
      requiresApproval: action.requiresApproval ?? (action.riskLevel === "high" || action.riskLevel === "sensitive" || action.executionType === "write_action"),
      sensitivity: action.sensitivity ?? (action.riskLevel === "sensitive" ? "sensitive" : "standard"),
      actionCategory: action.actionCategory,
      approvalMode: action.approvalMode,
      resourceSensitivity: action.resourceSensitivity,
      fieldClasses: action.fieldClasses ? [...action.fieldClasses] : undefined,
      actionConstraints: action.actionConstraints ? { ...action.actionConstraints } : undefined,
      toolMappingStatus: action.toolMappingStatus,
      toolMappingProof: action.toolMappingProof ? { ...action.toolMappingProof } : undefined,
      provider: action.provider,
      resourceSystem: action.resourceSystem ?? input.connectorProfile.resourceSystem,
      requiredApplicationGrants: requiredApplicationGrants ? [...requiredApplicationGrants] : undefined,
      requiredEffectivePermissions: requiredEffectivePermissions ? [...requiredEffectivePermissions] : undefined,
      requestedScopes: requestedScopes ? [...requestedScopes] : undefined,
      missingApplicationGrants: effectiveMissingApplicationGrants,
      missingEffectivePermissions,
      deniedEffectivePermissions
    };
  });
}
