import { readFileSync } from "node:fs";
import { buildServiceNowRuntimeDiagnosis } from "../real-external-agent/src/connectors/servicenowRuntimeDiagnosis.js";
import { buildJiraRuntimeDiagnosis } from "../real-external-agent/src/connectors/jiraRuntimeDiagnosis.js";
import { buildGitHubRuntimeDiagnosis } from "../real-external-agent/src/connectors/githubRuntimeDiagnosis.js";

let failed = false;

function fail(message: string): void {
  console.error(`fail - ${message}`);
  failed = true;
}

function assert(condition: unknown, message: string): void {
  if (!condition) {
    fail(message);
  }
}

function noSecretMarkers(value: unknown, label: string): void {
  const text = JSON.stringify(value);
  for (const forbidden of [
    "raw JWT",
    "access token",
    "Authorization header",
    "client secret",
    "private key",
    "client assertion",
    "Bearer "
  ]) {
    if (text.includes(forbidden)) {
      fail(`${label} exposed forbidden marker: ${forbidden}`);
    }
  }
}

const baseRuntime = {
  executionType: "inspection_read_only" as const,
  outcome: "diagnosed" as const,
  executedSkillId: "test",
  writeActionAttempted: false,
  diagnosticOnly: true
};

const approvedAccess = {
  missingApplicationGrants: [],
  missingEffectivePermissions: [],
  deniedEffectivePermissions: [],
  skillApprovedByConfig: true
};

const serviceNowAllowed = buildServiceNowRuntimeDiagnosis({
  skillId: "servicenow.ticket.status.lookup",
  message: "What is the status of my ticket INC0010245?",
  actor: "ran@company.com",
  requiredApplicationGrants: [],
  requiredEffectivePermissions: [],
  connectorAccessEvaluation: approvedAccess,
  runtimeSemantics: baseRuntime
});
assert(serviceNowAllowed.endUserAnswer?.summary.includes("VPN login fails"), "ServiceNow allowed ticket lookup should return ticket summary");
assert(serviceNowAllowed.endUserAnswer?.whatWasChanged === "No changes were made.", "ServiceNow ticket lookup should state no changes");

const serviceNowExactTicket = buildServiceNowRuntimeDiagnosis({
  skillId: "servicenow.ticket.status.lookup",
  message: "what is the status of INC0010213",
  actor: "ran@company.com",
  requiredApplicationGrants: [],
  requiredEffectivePermissions: [],
  connectorAccessEvaluation: approvedAccess,
  runtimeSemantics: baseRuntime
});
const serviceNowExactTicketText = JSON.stringify(serviceNowExactTicket);
assert(serviceNowExactTicketText.includes("INC0010213"), "ServiceNow exact lookup should answer about INC0010213");
assert(!serviceNowExactTicketText.includes("INC0010245"), "ServiceNow exact lookup must not fall back to INC0010245");

const serviceNowMissingExactTicket = buildServiceNowRuntimeDiagnosis({
  skillId: "servicenow.ticket.status.lookup",
  message: "what is the status of REQ0099999",
  actor: "ran@company.com",
  requiredApplicationGrants: [],
  requiredEffectivePermissions: [],
  connectorAccessEvaluation: approvedAccess,
  runtimeSemantics: baseRuntime
});
const serviceNowMissingExactTicketText = JSON.stringify(serviceNowMissingExactTicket);
assert(serviceNowMissingExactTicketText.includes("REQ0099999"), "ServiceNow not-found lookup should mention the exact requested ticket");
assert(serviceNowMissingExactTicket.endUserAnswer?.summary.includes("REQ0099999"), "ServiceNow not-found answer should include the exact requested ticket");
assert(serviceNowMissingExactTicket.endUserAnswer?.summary.includes("could not find"), "ServiceNow not-found answer should say the exact ticket was not found");
assert(!serviceNowMissingExactTicketText.includes("INC0010245"), "ServiceNow not-found lookup must not fall back to INC0010245");

const serviceNowDenied = buildServiceNowRuntimeDiagnosis({
  skillId: "servicenow.ticket.status.lookup",
  message: "What is the status of my ticket INC0010310?",
  actor: "ran@company.com",
  requiredApplicationGrants: [],
  requiredEffectivePermissions: [],
  connectorAccessEvaluation: approvedAccess,
  runtimeSemantics: baseRuntime
});
assert(serviceNowDenied.endUserAnswer?.summary.includes("cannot show this ticket"), "ServiceNow denied lookup should not reveal ticket details");
assert(!JSON.stringify(serviceNowDenied).includes("Shared mailbox cannot receive external mail"), "ServiceNow denied lookup should hide sensitive ticket description");

const serviceNowAws = buildServiceNowRuntimeDiagnosis({
  skillId: "servicenow.catalog.item.recommend",
  message: "I need AWS production access",
  actor: "ran@company.com",
  requiredApplicationGrants: [],
  requiredEffectivePermissions: [],
  connectorAccessEvaluation: approvedAccess,
  runtimeSemantics: baseRuntime
});
assert(serviceNowAws.endUserAnswer?.summary.includes("AWS Access Request"), "ServiceNow AWS request should recommend AWS Access Request");
assert(serviceNowAws.endUserAnswer?.whatWasChanged?.includes("No request was submitted"), "ServiceNow AWS request should not claim submission");

const serviceNowJiraAccess = buildServiceNowRuntimeDiagnosis({
  skillId: "servicenow.catalog.item.recommend",
  message: "I want to request access to Jira",
  actor: "ran@company.com",
  requestContext: {
    intentClass: "access_request",
    targetResourceSystem: "jira",
    fulfillmentCapability: "access.request.prepare",
    missingFields: ["resource/project/site", "accessLevel", "businessReason"]
  },
  requiredApplicationGrants: [],
  requiredEffectivePermissions: [],
  connectorAccessEvaluation: approvedAccess,
  runtimeSemantics: baseRuntime
});
assert(serviceNowJiraAccess.endUserAnswer?.title === "Request preparation", "ServiceNow Jira access request should be request preparation");
assert(serviceNowJiraAccess.endUserAnswer?.summary.includes("Jira"), "ServiceNow Jira access request should mention the target resource system");
assert(serviceNowJiraAccess.endUserAnswer?.summary.includes("Jira Access Request"), "ServiceNow Jira access request should recommend the Jira catalog item");
assert(serviceNowJiraAccess.endUserAnswer?.whatWasChanged?.includes("No request was submitted"), "ServiceNow Jira access request should not claim submission");
assert(serviceNowJiraAccess.endUserAnswer?.nextStep.includes("what access level"), "ServiceNow Jira access request should ask for missing access level");

const serviceNowMailingList = buildServiceNowRuntimeDiagnosis({
  skillId: "servicenow.catalog.item.recommend",
  message: "I need to create a mailing list",
  actor: "ran@company.com",
  requiredApplicationGrants: [],
  requiredEffectivePermissions: [],
  connectorAccessEvaluation: approvedAccess,
  runtimeSemantics: baseRuntime
});
assert(serviceNowMailingList.endUserAnswer?.summary.includes("Distribution List Request"), "ServiceNow mailing list should recommend Distribution List Request");

const jiraIssue = buildJiraRuntimeDiagnosis({
  skillId: "jira.issue.status.lookup",
  message: "What is the status of FIN-42?",
  actor: "ran@company.com",
  requiredApplicationGrants: [],
  requiredEffectivePermissions: [],
  connectorAccessEvaluation: approvedAccess,
  runtimeSemantics: baseRuntime
});
assert(jiraIssue.endUserAnswer?.title.includes("FIN-42"), "Jira issue status lookup should return FIN-42");

const jiraAccess = buildJiraRuntimeDiagnosis({
  skillId: "jira.project.access.prepare",
  message: "I need viewer access to Jira project FIN",
  actor: "ran@company.com",
  requiredApplicationGrants: [],
  requiredEffectivePermissions: [],
  connectorAccessEvaluation: approvedAccess,
  runtimeSemantics: baseRuntime
});
assert(jiraAccess.endUserAnswer?.whatWasChanged?.includes("No permission was granted"), "Jira access request should not grant permission");

const jiraReadyWrite = buildJiraRuntimeDiagnosis({
  skillId: "jira.issue.create",
  message: "Create a Jira issue in OPS project for this outage",
  actor: "ran@company.com",
  requiredApplicationGrants: [],
  requiredEffectivePermissions: [],
  connectorAccessEvaluation: approvedAccess,
  runtimeSemantics: { ...baseRuntime, executionType: "write_action", diagnosticOnly: false }
});
assert(jiraReadyWrite.endUserAnswer?.title === "Ready for approval", "Jira ready write action should be approval/planned");
assert(!jiraReadyWrite.endUserAnswer?.summary.includes("access or permission issue"), "Jira ready write action should not claim generic permission issue");
assert(jiraReadyWrite.endUserAnswer?.whatWasChanged?.includes("No issue was created"), "Jira ready write action should not claim issue creation");
assert(jiraReadyWrite.probableCause.includes("required grant and permission"), "Jira ready write action should state connector grant and permission passed");
assert(jiraReadyWrite.probableCause.includes("approved execution flow"), "Jira ready write action should require approved execution flow");

const jiraFinResourceBlock = buildJiraRuntimeDiagnosis({
  skillId: "jira.issue.create",
  message: "Why can't I create an issue in FIN?",
  actor: "ran@company.com",
  requiredApplicationGrants: [],
  requiredEffectivePermissions: [],
  connectorAccessEvaluation: approvedAccess,
  runtimeSemantics: { ...baseRuntime, executionType: "write_action", diagnosticOnly: false }
});
const jiraFinResourceBlockText = JSON.stringify(jiraFinResourceBlock);
assert(jiraFinResourceBlock.summary.includes("FIN project-specific check"), "Jira FIN create issue block should name the resource-specific layer");
assert(jiraFinResourceBlockText.includes("resourceSpecificCheck"), "Jira FIN create issue block should expose resource-specific runtime evidence");
assert(jiraFinResourceBlockText.includes("FIN project contributor"), "Jira FIN create issue block should name the missing resource-specific permission");
assert(!jiraFinResourceBlockText.includes("missingApplicationGrants"), "Jira FIN resource block should not masquerade as a missing OAuth grant");
assert(!jiraFinResourceBlockText.includes("missingEffectivePermissions"), "Jira FIN resource block should not masquerade as a missing service-account permission");

const githubPr = buildGitHubRuntimeDiagnosis({
  skillId: "github.pull_request.status.lookup",
  message: "What is the status of PR 42 in billing-api?",
  actor: "ran@company.com",
  requiredApplicationGrants: [],
  requiredEffectivePermissions: [],
  connectorAccessEvaluation: approvedAccess,
  runtimeSemantics: baseRuntime
});
assert(githubPr.endUserAnswer?.summary.includes("integration-tests/payment-ledger"), "GitHub PR lookup should return checks and blockers");

const githubAccess = buildGitHubRuntimeDiagnosis({
  skillId: "github.repository.access.prepare",
  message: "I need access to the billing-api repo",
  actor: "ran@company.com",
  requiredApplicationGrants: [],
  requiredEffectivePermissions: [],
  connectorAccessEvaluation: approvedAccess,
  runtimeSemantics: baseRuntime
});
assert(githubAccess.endUserAnswer?.whatWasChanged?.includes("No repository access was granted"), "GitHub repo access request should not grant access");

for (const [label, response] of Object.entries({
  serviceNowAllowed,
  serviceNowExactTicket,
  serviceNowMissingExactTicket,
  serviceNowDenied,
  serviceNowAws,
  serviceNowJiraAccess,
  serviceNowMailingList,
  jiraIssue,
  jiraAccess,
  jiraReadyWrite,
  jiraFinResourceBlock,
  githubPr,
  githubAccess
})) {
  noSecretMarkers(response, label);
}

const orchestratorIndex = readFileSync("services/orchestrator-api/src/index.ts", "utf8");
assert(orchestratorIndex.includes("/demo/end-user-ready"), "End user mode should have demo environment preparation endpoint");
assert(orchestratorIndex.includes("UNAVAILABLE\\nNo governed systems are connected here yet."), "Zero installed connectors should return unavailable handoff");
assert(orchestratorIndex.includes("safeTargetSelection: hasInstalledConnectorSystems ?"), "Safe target picker should only appear when installed connector systems exist");
assert(orchestratorIndex.includes("Other / not listed is not governed by an installed connector here."), "Other target selection should hand off to support");

const connectorRouting = readFileSync("services/orchestrator-api/src/connectorRouting.ts", "utf8");
assert(connectorRouting.includes("fulfillmentCapability: \"access.request.prepare\""), "Connector routing should infer generic access fulfillment capability");
assert(connectorRouting.includes("fulfillmentSkillFor"), "Connector routing should select fulfillment connectors by declared capability");
assert(!connectorRouting.includes("I want to request access to Jira"), "Connector routing should not hardcode the Jira access phrase");

const runTaskTab = readFileSync("apps/web-ui/src/components/run-task/RunTaskTab.tsx", "utf8");
for (const prompt of [
  "What is the status of my ticket INC0010245?",
  "I need AWS production access",
  "I need to create a mailing list",
  "What is the status of FIN-42?",
  "I need access to Jira project FIN",
  "What is the status of PR 42 in billing-api?",
  "I need access to the billing-api repo"
]) {
  assert(runTaskTab.includes(prompt), `Run Task suggested prompts should include: ${prompt}`);
}

const agentRegistry = readFileSync("apps/web-ui/src/components/agent-registry/AgentRegistryTab.tsx", "utf8");
const styles = readFileSync("apps/web-ui/src/styles.css", "utf8");
assert(agentRegistry.includes("registry-agent-metadata template-details"), "Agent Registry template details should use readable template-details layout");
assert(styles.includes(".template-details") && styles.includes(".template-details > div"), "Template details should use a dedicated readable layout");
assert(styles.includes(".template-details {\n  grid-template-columns: 1fr;"), "Template details should render as full-width key-value rows");
assert(!styles.includes(".template-details {\n  grid-template-columns: repeat(5"), "Template details must not use five narrow columns");
assert(!styles.includes(".template-details strong {\n  line-height: 1.45;\n  overflow-wrap: break-word;\n  word-break: break-all;"), "Template details should not force break-all wrapping");
assert(!styles.includes("registry-agent-metadata,\n  .template-details,\n  .trust-card-grid"), "Responsive registry metadata grid must not force template details back into narrow columns");
assert(styles.includes("grid-template-columns: repeat(auto-fit, minmax(min(420px, 100%), 1fr));"), "Connector Catalog should use a responsive non-overflow card grid");
assert(!styles.includes(".connector-preset-grid {\n  display: grid;\n  grid-template-columns: repeat(3"), "Connector Catalog must not use a fixed three-column grid");
assert(styles.includes(".connector-card-actions .scenario-run") && styles.includes("width: auto;"), "Connector card actions should remain normal buttons instead of stretched circles");
assert(styles.includes(".connector-template-facts span") && styles.includes("min-height: 0;"), "Connector template summary facts should stay compact");

if (failed) {
  process.exitCode = 1;
} else {
  console.log("End-user product verification passed.");
}
