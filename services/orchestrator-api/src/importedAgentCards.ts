import type { AgentCardSkill } from "./agentCards";

export type ImportedAgentCard = {
  agentId: string;
  name: string;
  description: string;
  systems: string[];
  endpoint: string;
  auth: {
    type: string;
    audience: string;
  };
  skills: Array<AgentCardSkill & {
    id: string;
    name: string;
    description: string;
    capabilities: string[];
    requiredScopes: string[];
    riskLevel: "low" | "medium" | "high" | "sensitive";
  }>;
};

export type AgentCardEndpointType = "public" | "session" | "unknown";

export type AgentCardValidationSummary = {
  agentId: string;
  name: string;
  authType: string;
  audience: string;
  capabilities: string[];
  requiredScopes: string[];
  riskLevels: Array<"low" | "medium" | "high" | "sensitive">;
  endpointType: AgentCardEndpointType;
  endpointScheme: "https" | "http" | "session" | "unknown";
};

export type AgentCardValidationResult =
  | {
      valid: true;
      agentCard: ImportedAgentCard;
      summary: AgentCardValidationSummary;
      warnings: string[];
    }
  | {
      valid: false;
      error: "invalid_agent_card";
      details: string[];
    };

const cardsBySession = new Map<string, ImportedAgentCard[]>();
const riskLevels = new Set(["low", "medium", "high", "sensitive"]);
const allowedAuthTypes = new Set(["oauth2_client_credentials_jwt"]);
const unsafeCredentialFields = new Set([
  "privatekey",
  "clientsecret",
  "accesstoken",
  "refreshtoken",
  "authorizationheader",
  "apikey"
]);
const blockedEndpointSchemes = new Set(["javascript:", "file:", "data:", "ftp:", "gopher:"]);

function recordFrom(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function trimmedString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  if (!value.every((item) => typeof item === "string")) {
    return undefined;
  }

  return value.map((item) => item.trim()).filter(Boolean);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      repeated.add(value);
    }
    seen.add(value);
  }
  return [...repeated];
}

function hasUnsafeCredentialField(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => hasUnsafeCredentialField(item));
  }

  const record = recordFrom(value);
  if (!record) {
    return false;
  }

  return Object.entries(record).some(([key, childValue]) =>
    unsafeCredentialFields.has(key.toLowerCase()) || hasUnsafeCredentialField(childValue)
  );
}

function endpointMetadata(endpoint: string): { endpointType: AgentCardEndpointType; endpointScheme: AgentCardValidationSummary["endpointScheme"]; error?: string; warning?: string } {
  let parsed: URL;

  try {
    parsed = new URL(endpoint);
  } catch {
    return { endpointType: "unknown", endpointScheme: "unknown", error: "endpoint must be a valid URL string." };
  }

  if (blockedEndpointSchemes.has(parsed.protocol)) {
    return { endpointType: "unknown", endpointScheme: "unknown", error: `endpoint scheme ${parsed.protocol.replace(":", "")} is not allowed.` };
  }

  if (parsed.protocol === "session:") {
    return { endpointType: "session", endpointScheme: "session" };
  }

  if (parsed.protocol === "https:") {
    return { endpointType: "public", endpointScheme: "https" };
  }

  if (parsed.protocol === "http:") {
    return { endpointType: "public", endpointScheme: "http", warning: "endpoint_not_https" };
  }

  return { endpointType: "unknown", endpointScheme: "unknown", error: `endpoint scheme ${parsed.protocol.replace(":", "") || "unknown"} is not allowed.` };
}

export function listImportedAgentCards(sessionToken: string): ImportedAgentCard[] {
  return [...(cardsBySession.get(sessionToken) ?? [])];
}

export function addImportedAgentCard(sessionToken: string, card: ImportedAgentCard): ImportedAgentCard {
  const current = cardsBySession.get(sessionToken) ?? [];
  const next = [...current.filter((item) => item.agentId !== card.agentId), card];
  cardsBySession.set(sessionToken, next);
  return card;
}

export function deleteImportedAgentCard(sessionToken: string, agentId: string): boolean {
  const current = cardsBySession.get(sessionToken) ?? [];
  const next = current.filter((card) => card.agentId !== agentId);
  cardsBySession.set(sessionToken, next);
  return next.length !== current.length;
}

export function validateImportedAgentCard(value: unknown): AgentCardValidationResult {
  const details: string[] = [];
  const warnings: string[] = [];

  if (hasUnsafeCredentialField(value)) {
    details.push("Agent Card must not include raw secrets or credentials.");
  }

  const record = recordFrom(value);
  if (!record) {
    return { valid: false, error: "invalid_agent_card", details: ["agentCard must be an object."] };
  }

  const agentId = trimmedString(record.agentId);
  const name = trimmedString(record.name);
  const description = trimmedString(record.description);
  const endpoint = trimmedString(record.endpoint);
  const systems = stringList(record.systems) ?? [];
  const auth = recordFrom(record.auth);
  const authType = trimmedString(auth?.type);
  const audience = trimmedString(auth?.audience);
  const rawSkills = Array.isArray(record.skills) ? record.skills : undefined;

  if (!agentId) details.push("agentId is required.");
  if (agentId && /\s/.test(agentId)) details.push("agentId must not contain spaces.");
  if (agentId && agentId.length > 120) details.push("agentId must be 120 characters or fewer.");
  if (agentId && /[A-Z]/.test(agentId)) warnings.push("agent_id_contains_uppercase");
  if (!name) details.push("name is required.");
  if (name && name.length > 160) details.push("name must be 160 characters or fewer.");
  if (description === undefined) details.push("description must be a string.");
  if (!endpoint) details.push("endpoint is required.");
  if (endpoint && endpoint.length > 500) details.push("endpoint must be 500 characters or fewer.");
  if (!authType) details.push("auth.type is required.");
  if (!audience) details.push("auth.audience is required.");
  if (audience && audience.length > 200) details.push("auth.audience must be 200 characters or fewer.");
  if (agentId && audience && audience !== agentId) warnings.push("audience_does_not_match_agent_id");
  if (!rawSkills?.length) details.push("skills must be a non-empty array.");
  if (rawSkills && rawSkills.length > 20) details.push("skills must contain 20 items or fewer.");

  const endpointInfo = endpoint ? endpointMetadata(endpoint) : { endpointType: "unknown" as const, endpointScheme: "unknown" as const };
  if (endpointInfo.error) {
    details.push(endpointInfo.error);
  }
  if (endpointInfo.warning) {
    warnings.push(endpointInfo.warning);
  }

  if (authType && !allowedAuthTypes.has(authType)) {
    warnings.push("auth_type_unknown_or_unsupported");
  }

  if (systems.length === 0) {
    warnings.push("no_systems_or_scope_systems");
  }

  const normalizedSkills: ImportedAgentCard["skills"] = [];

  for (const [index, rawSkill] of (rawSkills ?? []).entries()) {
    const skill = recordFrom(rawSkill);
    const label = `skills[${index}]`;

    if (!skill) {
      details.push(`${label} must be an object.`);
      continue;
    }

    const id = trimmedString(skill.id);
    const skillName = trimmedString(skill.name);
    const skillDescription = trimmedString(skill.description);
    const capabilities = stringList(skill.capabilities);
    const requiredScopes = stringList(skill.requiredScopes);
    const examples = stringList(skill.examples);
    const riskLevel = trimmedString(skill.riskLevel);
    const scope = recordFrom(skill.scope);
    const scopeSystems = stringList(scope?.systems);
    const resourceTypes = stringList(scope?.resourceTypes);

    if (!id) details.push(`${label}.id is required.`);
    if (!skillName) details.push(`${label}.name is required.`);
    if (skillDescription === undefined) details.push(`${label}.description must be a string.`);
    if (!capabilities?.length) details.push(`${label}.capabilities must be a non-empty string array.`);
    if (capabilities && capabilities.length > 20) details.push(`${label}.capabilities must contain 20 items or fewer.`);
    if (!requiredScopes) details.push(`${label}.requiredScopes must be a string array.`);
    if (requiredScopes && requiredScopes.length > 20) details.push(`${label}.requiredScopes must contain 20 items or fewer.`);
    if (!riskLevel || !riskLevels.has(riskLevel)) details.push(`${label}.riskLevel must be one of low, medium, high, sensitive.`);

    if (requiredScopes && requiredScopes.length === 0) {
      warnings.push(`${label}_no_required_scopes`);
    }

    for (const capability of capabilities ?? []) {
      if (!capability.includes(".")) {
        warnings.push(`${label}_capability_without_dot`);
        break;
      }
    }

    for (const requiredScope of requiredScopes ?? []) {
      if (!requiredScope.includes(".")) {
        warnings.push(`${label}_required_scope_without_dot`);
        break;
      }
    }

    if (capabilities && duplicates(capabilities).length > 0) {
      warnings.push(`${label}_duplicate_capabilities`);
    }

    if (requiredScopes && duplicates(requiredScopes).length > 0) {
      warnings.push(`${label}_duplicate_required_scopes`);
    }

    if (riskLevel === "high" || riskLevel === "sensitive") {
      warnings.push(`${label}_high_or_sensitive_risk`);
    }

    if (!examples?.length) {
      warnings.push(`${label}_no_examples`);
    }

    if (!scopeSystems?.length && systems.length === 0) {
      warnings.push(`${label}_no_systems_or_scope_systems`);
    }

    if (id && skillName && skillDescription !== undefined && capabilities?.length && requiredScopes && riskLevel && riskLevels.has(riskLevel)) {
      normalizedSkills.push({
        id,
        name: skillName,
        description: skillDescription,
        capabilities: unique(capabilities),
        requiredScopes: unique(requiredScopes),
        riskLevel: riskLevel as ImportedAgentCard["skills"][number]["riskLevel"],
        ...(examples?.length ? { examples: unique(examples) } : {}),
        ...(scopeSystems?.length || resourceTypes?.length
          ? { scope: { ...(scopeSystems?.length ? { systems: unique(scopeSystems) } : {}), ...(resourceTypes?.length ? { resourceTypes: unique(resourceTypes) } : {}) } }
          : {})
      });
    }
  }

  const allCapabilities = normalizedSkills.flatMap((skill) => skill.capabilities);
  const allRequiredScopes = normalizedSkills.flatMap((skill) => skill.requiredScopes);
  if (duplicates(allCapabilities).length > 0) {
    warnings.push("duplicate_capabilities");
  }
  if (duplicates(allRequiredScopes).length > 0) {
    warnings.push("duplicate_required_scopes");
  }

  if (details.length > 0 || !agentId || !name || description === undefined || !endpoint || !authType || !audience) {
    return { valid: false, error: "invalid_agent_card", details };
  }

  const agentCard: ImportedAgentCard = {
    agentId,
    name,
    description,
    systems: unique(systems),
    endpoint,
    auth: {
      type: authType,
      audience
    },
    skills: normalizedSkills
  };

  const summary: AgentCardValidationSummary = {
    agentId,
    name,
    authType,
    audience,
    capabilities: unique(allCapabilities),
    requiredScopes: unique(allRequiredScopes),
    riskLevels: unique(normalizedSkills.map((skill) => skill.riskLevel)) as AgentCardValidationSummary["riskLevels"],
    endpointType: endpointInfo.endpointType,
    endpointScheme: endpointInfo.endpointScheme
  };

  return {
    valid: true,
    agentCard,
    summary,
    warnings: unique(warnings)
  };
}
