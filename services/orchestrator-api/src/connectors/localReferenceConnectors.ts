export const localReferenceConnectorBaseUrls = [
  "http://localhost:4201",
  "http://localhost:4202",
  "http://localhost:4203"
] as const;

export type ConnectorTemplateSource = "local_reference" | "custom_sdk";

export type ConnectorTemplateStatus = "available" | "planned" | "coming_soon";

export type ConnectorTemplate = {
  resourceSystem: string;
  connectorId: string;
  displayName: string;
  status: ConnectorTemplateStatus;
  source: ConnectorTemplateSource;
  description: string;
  category: "ITSM" | "DevOps" | "Work Management" | "Custom";
  publisher: string;
  templateVersion: string;
  authModel: "oauth_application_with_service_account" | "custom_sdk_contract";
  runtimeSupport: "supported" | "planned" | "not_supported";
  riskLevel: "low" | "medium" | "high";
  tags: string[];
  docsUrl?: string;
  setupRequirements: string[];
};

export function listSupportedConnectorGuardrails() {
  return listSupportedConnectorTemplates().filter((connector) => connector.status === "available");
}

export function listSupportedConnectorTemplates(): ConnectorTemplate[] {
  return [
    {
      resourceSystem: "jira",
      connectorId: "jira-reference",
      displayName: "Jira Cloud Reference Connector",
      status: "available",
      source: "local_reference",
      description: "Reference connector template for Jira issue diagnostics, permission inspection, and controlled issue creation demos.",
      category: "Work Management",
      publisher: "Secure A2A Reference",
      templateVersion: "1.0.0",
      authModel: "oauth_application_with_service_account",
      runtimeSupport: "supported",
      riskLevel: "medium",
      tags: ["jira", "issues", "permissions", "work-management"],
      setupRequirements: [
        "External agent discovery endpoint",
        "Gateway public registration in the external agent admin console",
        "OAuth application with application access grants",
        "Service account / integration user permission attestation"
      ]
    },
    {
      resourceSystem: "servicenow",
      connectorId: "servicenow-reference",
      displayName: "ServiceNow Reference Connector",
      status: "available",
      source: "local_reference",
      description: "Reference connector template for ServiceNow incident, catalog request, role, and ACL diagnostics.",
      category: "ITSM",
      publisher: "Secure A2A Reference",
      templateVersion: "1.0.0",
      authModel: "oauth_application_with_service_account",
      runtimeSupport: "supported",
      riskLevel: "medium",
      tags: ["servicenow", "incident", "catalog", "itsm", "acl"],
      setupRequirements: [
        "External agent discovery endpoint",
        "Gateway public registration in the external agent admin console",
        "OAuth application with application access grants",
        "Service account / integration user role and ACL attestation"
      ]
    },
    {
      resourceSystem: "github",
      connectorId: "github-reference",
      displayName: "GitHub Reference Connector",
      status: "available",
      source: "local_reference",
      description: "Reference connector template for GitHub repository, pull request, installation access, and rate-limit diagnostics.",
      category: "DevOps",
      publisher: "Secure A2A Reference",
      templateVersion: "1.0.0",
      authModel: "oauth_application_with_service_account",
      runtimeSupport: "supported",
      riskLevel: "medium",
      tags: ["github", "repository", "pull-request", "rate-limit", "devops"],
      setupRequirements: [
        "External agent discovery endpoint",
        "Gateway public registration in the external agent admin console",
        "OAuth or app installation access grant attestation",
        "Repository and organization permission attestation"
      ]
    },
    {
      resourceSystem: "custom",
      connectorId: "custom-sdk",
      displayName: "Custom Connector SDK",
      status: "planned",
      source: "custom_sdk",
      description: "Build your own connector using the Secure A2A connector contract. Planned for V2.",
      category: "Custom",
      publisher: "Customer / Vendor",
      templateVersion: "planned",
      authModel: "custom_sdk_contract",
      runtimeSupport: "planned",
      riskLevel: "medium",
      tags: ["custom", "sdk", "bring-your-own-connector"],
      setupRequirements: [
        "Discovery document",
        "Connector profile",
        "Public JWKS",
        "Signed onboarding response",
        "OAuth/application access attestation",
        "Service account permission attestation",
        "Scoped runtime endpoint"
      ]
    }
  ];
}

export function isAllowedLocalReferenceConnectorBaseUrl(url: string): boolean {
  return (localReferenceConnectorBaseUrls as readonly string[]).includes(url);
}
