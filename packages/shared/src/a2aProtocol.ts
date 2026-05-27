import type { IncomingHttpHeaders } from "node:http";

export const A2A_PROTOCOL_VERSION = "1.0" as const;
export const A2A_VERSION_HEADER = "A2A-Version" as const;
export const A2A_CONTENT_TYPE = "application/a2a+json" as const;
export const A2A_AGENT_CARD_WELL_KNOWN_PATH = "/.well-known/agent-card.json" as const;
export const A2A_LEGACY_AGENT_CARD_PATH = "/agent-card" as const;

export type OgenA2AProtocolVersion = typeof A2A_PROTOCOL_VERSION;

export type OgenA2AInterface = {
  protocolVersion: OgenA2AProtocolVersion;
  versionHeader: typeof A2A_VERSION_HEADER;
  contentType: typeof A2A_CONTENT_TYPE;
  agentCardPath: typeof A2A_AGENT_CARD_WELL_KNOWN_PATH;
  legacyAgentCardPath: typeof A2A_LEGACY_AGENT_CARD_PATH;
};

export type OgenA2AAgentCardCompatibility = {
  protocolVersion: OgenA2AProtocolVersion;
  interfaces: OgenA2AInterface[];
};

export const OGEN_A2A_INTERFACE: OgenA2AInterface = {
  protocolVersion: A2A_PROTOCOL_VERSION,
  versionHeader: A2A_VERSION_HEADER,
  contentType: A2A_CONTENT_TYPE,
  agentCardPath: A2A_AGENT_CARD_WELL_KNOWN_PATH,
  legacyAgentCardPath: A2A_LEGACY_AGENT_CARD_PATH
};

export const OGEN_A2A_AGENT_CARD_COMPATIBILITY: OgenA2AAgentCardCompatibility = {
  protocolVersion: A2A_PROTOCOL_VERSION,
  interfaces: [OGEN_A2A_INTERFACE]
};

export type UnsupportedA2AProtocolVersionResponse = {
  error: "unsupported_a2a_version";
  message: string;
  receivedVersion: string;
  supportedVersions: OgenA2AProtocolVersion[];
  taskExecuted: false;
  protectedMaterialExposed: false;
  tokenMaterialStored: false;
  rawPromptStored: false;
};

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function explicitA2AProtocolVersion(headers: IncomingHttpHeaders): string | undefined {
  return firstHeaderValue(headers["a2a-version"])?.trim() || undefined;
}

export function unsupportedExplicitA2AProtocolVersion(headers: IncomingHttpHeaders): string | undefined {
  const version = explicitA2AProtocolVersion(headers);
  return version && version !== A2A_PROTOCOL_VERSION ? version : undefined;
}

export function buildUnsupportedA2AProtocolVersionResponse(version: string): UnsupportedA2AProtocolVersionResponse {
  return {
    error: "unsupported_a2a_version",
    message: `Unsupported explicit ${A2A_VERSION_HEADER}. Use ${A2A_PROTOCOL_VERSION} or omit the header for legacy/internal behavior.`,
    receivedVersion: version,
    supportedVersions: [A2A_PROTOCOL_VERSION],
    taskExecuted: false,
    protectedMaterialExposed: false,
    tokenMaterialStored: false,
    rawPromptStored: false
  };
}

export function a2aJsonRequestHeaders(): Record<string, string> {
  return {
    [A2A_VERSION_HEADER]: A2A_PROTOCOL_VERSION,
    Accept: A2A_CONTENT_TYPE,
    "Content-Type": A2A_CONTENT_TYPE
  };
}

export function a2aJsonAcceptHeaders(): Record<string, string> {
  return {
    [A2A_VERSION_HEADER]: A2A_PROTOCOL_VERSION,
    Accept: A2A_CONTENT_TYPE
  };
}
