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
assert(serviceNowAws.endUserAnswer?.title === "AWS Access Request", "ServiceNow AWS request should recommend AWS Access Request");
assert(serviceNowAws.endUserAnswer?.whatWasChanged?.includes("No request was submitted"), "ServiceNow AWS request should not claim submission");

const serviceNowMailingList = buildServiceNowRuntimeDiagnosis({
  skillId: "servicenow.catalog.item.recommend",
  message: "I need to create a mailing list",
  actor: "ran@company.com",
  requiredApplicationGrants: [],
  requiredEffectivePermissions: [],
  connectorAccessEvaluation: approvedAccess,
  runtimeSemantics: baseRuntime
});
assert(serviceNowMailingList.endUserAnswer?.title === "Distribution List Request", "ServiceNow mailing list should recommend Distribution List Request");

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
  message: "Create a Jira issue in FIN project for this outage",
  actor: "ran@company.com",
  requiredApplicationGrants: [],
  requiredEffectivePermissions: [],
  connectorAccessEvaluation: approvedAccess,
  runtimeSemantics: { ...baseRuntime, executionType: "write_action", diagnosticOnly: false }
});
assert(jiraReadyWrite.endUserAnswer?.title === "Ready for approval", "Jira ready write action should be approval/planned");
assert(!jiraReadyWrite.endUserAnswer?.summary.includes("access or permission issue"), "Jira ready write action should not claim generic permission issue");
assert(jiraReadyWrite.endUserAnswer?.whatWasChanged?.includes("No issue was created"), "Jira ready write action should not claim issue creation");

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
  serviceNowDenied,
  serviceNowAws,
  serviceNowMailingList,
  jiraIssue,
  jiraAccess,
  jiraReadyWrite,
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
assert(styles.includes(".template-details") && styles.includes("repeat(2, minmax(220px, 1fr))"), "Template details should use max two readable columns");

if (failed) {
  process.exitCode = 1;
} else {
  console.log("End-user product verification passed.");
}
