import type { ConnectorTemplate } from "./components/agent-registry/types";
import type { Scenario, ScenarioGroup } from "./components/types";

export type SupportedConnectorGuardrail = ConnectorTemplate;

export const scenarios: ScenarioGroup[] = [
  {
    category: "Connector-first orchestration",
    items: [
      {
        label: "Jira connector approved diagnosis",
        message: "Jira issue creation fails with 403 when creating issues in FIN project",
        subtitle: "Approved Jira connector skill when the reference connector agent is installed",
        purpose: "Routes to the installed Jira connector agent and approved diagnosis skill.",
        proves: "Diagnostic skills can execute safely without enabling the target create action.",
        badge: "Approved connector"
      },
      {
        label: "Jira create blocked by grants/permissions",
        message: "Create a Jira issue in FIN project for this outage",
        subtitle: "Blocked because the create action lacks grant/permission approval by default",
        purpose: "Shows why an installed connector agent can be trusted while a specific action is blocked.",
        proves: "Target write actions remain blocked unless separately granted and permitted.",
        badge: "Blocked action"
      },
      {
        label: "ServiceNow incident assignment",
        message: "ServiceNow incident assignment keeps failing for network tickets",
        subtitle: "Runs when the ServiceNow reference connector agent is installed",
        purpose: "Routes to the ServiceNow connector profile and incident assignment diagnosis skill.",
        proves: "Diagnostic runtime is connector-generic while system-specific reasoning stays inside the external connector.",
        badge: "ServiceNow"
      },
      {
        label: "ServiceNow catalog request",
        message: "ServiceNow catalog request RITM keeps failing during approval",
        subtitle: "Catalog request diagnosis through the ServiceNow connector",
        purpose: "Shows another ServiceNow skill selected from the same connector profile.",
        proves: "Diagnostic runtime is connector-generic while system-specific reasoning stays inside the external connector.",
        badge: "ServiceNow"
      },
      {
        label: "GitHub repository rate limit",
        message: "GitHub repository sync is failing after API rate limit",
        subtitle: "Runs when the GitHub reference connector agent is installed",
        purpose: "Routes to the GitHub connector profile and rate-limit diagnosis skill.",
        proves: "Diagnostic runtime is connector-generic while system-specific reasoning stays inside the external connector.",
        badge: "GitHub"
      },
      {
        label: "GitHub pull request access",
        message: "GitHub pull request checks cannot read the repository",
        subtitle: "Pull request access diagnosis through the GitHub connector",
        purpose: "Shows connector-specific runtime diagnosis without Gateway-specific GitHub logic.",
        proves: "Diagnostic runtime is connector-generic while system-specific reasoning stays inside the external connector.",
        badge: "GitHub"
      },
      {
        label: "Unsupported request",
        message: "The warehouse robot arm calibration failed",
        subtitle: "No supported connector profile in this demo",
        purpose: "Offers a support ticket handoff instead of pretending a connector exists.",
        proves: "Unsupported systems do not get fake routes.",
        badge: "Unsupported"
      }
    ]
  }
];

export const fallbackSupportedConnectorGuardrails: SupportedConnectorGuardrail[] = [
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
    setupRequirements: ["External agent discovery endpoint", "Gateway public registration", "OAuth application grants", "Service account permission attestation"],
    installed: false,
    installedCount: 0
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
    setupRequirements: ["External agent discovery endpoint", "Gateway public registration", "OAuth application grants", "Service account role and ACL attestation"],
    installed: false,
    installedCount: 0
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
    setupRequirements: ["External agent discovery endpoint", "Gateway public registration", "App installation access attestation", "Repository permission attestation"],
    installed: false,
    installedCount: 0
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
    setupRequirements: ["Discovery document", "Connector profile", "Public JWKS", "Signed onboarding response", "Scoped runtime endpoint"],
    installed: false,
    installedCount: 0
  }
];

const fallbackConnectorTemplateById = new Map(fallbackSupportedConnectorGuardrails.map((template) => [template.connectorId, template]));

export function enrichConnectorTemplate(template: SupportedConnectorGuardrail): SupportedConnectorGuardrail {
  return {
    ...fallbackConnectorTemplateById.get(template.connectorId),
    ...template
  };
}

const quickScenarioLabels = new Set([
  "Jira connector approved diagnosis",
  "Jira create blocked by grants/permissions",
  "ServiceNow incident assignment",
  "ServiceNow catalog request",
  "GitHub repository rate limit",
  "GitHub pull request access",
  "Unsupported request"
]);

const allScenarios: Scenario[] = scenarios.flatMap((group) => group.items);
export const quickScenarios = allScenarios.filter((scenario) => quickScenarioLabels.has(scenario.label));
export const advancedScenarios = allScenarios.filter((scenario) => !quickScenarioLabels.has(scenario.label));
