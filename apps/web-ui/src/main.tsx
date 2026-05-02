import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AgentsHealthResponse, ResolveResponse } from "@a2a/shared";
import "./styles.css";

const API_URL = import.meta.env.VITE_ORCHESTRATOR_API_URL ?? "http://localhost:4000";
const sampleMessage = "Jira sync fails with 403 when creating issues";

const scenarios = [
  {
    category: "End-user support",
    items: [
      {
        label: "Jira Permission Issue",
        message: "Jira says I don't have permission to create a ticket in the FIN project",
        subtitle: "End-user support routed to Jira Agent"
      },
      {
        label: "Vague Monday Issue",
        message: "i have issue with monday.com",
        subtitle: "Needs more information / no fake diagnosis"
      }
    ]
  },
  {
    category: "Technical integration",
    items: [
      {
        label: "Jira 403 Missing Scope",
        message: "Jira sync fails with 403 when creating issues",
        subtitle: "Technical integration + OAuth scope analysis"
      },
      {
        label: "GitHub Rate Limit Delegation",
        message: "GitHub repository sync started failing with 403 during nightly scan",
        subtitle: "GitHub Agent delegates to API Health Agent"
      },
      {
        label: "PagerDuty Alert Failure",
        message: "PagerDuty alert failure when sending incident notifications",
        subtitle: "Incident/alert specialist path"
      },
      {
        label: "SAP 401 Invalid Client",
        message: "SAP integration returns 401 invalid client during token exchange",
        subtitle: "Authentication failure path"
      }
    ]
  },
  {
    category: "Security / policy",
    items: [
      {
        label: "Blocked OAuth Inspection",
        message: "inspect oauth in github",
        subtitle: "Sensitive action blocked by policy"
      },
      {
        label: "Needs Approval: Grant Jira Permission",
        message: "Grant me permission to create Jira tickets in FIN",
        subtitle: "Permission change requires human approval"
      }
    ]
  },
  {
    category: "Unsupported / manual workflow",
    items: [
      {
        label: "Active Directory Access Request",
        message: "Add me to a helpdesk group in active directory",
        subtitle: "Unsupported system should create manual ServiceNow request guidance"
      },
      {
        label: "Salesforce Access Request",
        message: "Give me access to Salesforce",
        subtitle: "Access request with no matching identity agent"
      },
      {
        label: "User Provisioning",
        message: "Create a mailbox for a new employee",
        subtitle: "Provisioning request should become a manual workflow"
      },
      {
        label: "Out-of-scope Request",
        message: "i want to order pizza",
        subtitle: "Non-enterprise request should be rejected without routing to agents"
      }
    ]
  }
];

function inferDemoFlowType(response: ResolveResponse): string {
  if (response.requestInterpretation?.scope === "out_of_scope" || response.routingReasoningSummary.toLowerCase().includes("outside the supported enterprise") || response.agentTrace.some((entry) => entry.action === "out_of_scope")) {
    return "Out of scope";
  }

  if (response.agentTrace.some((entry) => entry.action === "manual_incident_recommended")) {
    return "Manual incident workflow";
  }

  if (response.requestInterpretation?.scope === "manual_enterprise_workflow") {
    return "Manual service request";
  }

  if (response.resolutionStatus === "unsupported") {
    return "Unsupported/manual workflow";
  }

  if (response.securityDecisions?.some((decision) => decision.decision === "Blocked" || decision.decision === "NeedsApproval" || decision.decision === "NeedsMoreContext")) {
    return "Security policy";
  }

  if (response.classification.supportMode === "end_user_support") {
    return "End-user support";
  }

  return "Technical integration";
}

function decisionClass(decision: string): string {
  return `decision-${decision.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()}`;
}

function routingDescription(response: ResolveResponse): string {
  if (response.routingSource === "ai") {
    return "Secondary AI router selected agents using Agent Cards.";
  }

  if (response.requestInterpretation?.interpretationSource === "ai") {
    return "AI interpreted the request. Deterministic fallback handled agent selection.";
  }

  if (response.requestInterpretation?.interpretationSource === "fallback") {
    return "Deterministic request interpretation fallback was used.";
  }

  return "Deterministic capability routing/fallback handled agent selection.";
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre>{JSON.stringify(value, null, 2)}</pre>;
}

function healthClass(status: string): string {
  return `health-${status}`;
}

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  status?: "loading" | "done";
  metadata?: ResolveResponse;
};

type DemoAgentCard = {
  agentId: string;
  name: string;
  description: string;
  systems: string[];
  endpoint: string;
  auth: { type: string; audience: string };
  skills: Array<{
    id: string;
    name: string;
    description: string;
    examples?: string[];
    requiredScopes?: string[];
    capabilities?: string[];
    supportingCapabilities?: string[];
    requestedAction?: string;
    requiredPermission?: string;
    riskLevel?: "low" | "medium" | "high" | "sensitive";
    owner?: string;
    scope?: {
      systems?: string[];
      resourceTypes?: string[];
    };
    sensitive?: boolean;
  }>;
};

type DemoAgentCardInput = {
  system: string;
  agentSlug: string;
  agentName: string;
  description: string;
  diagnosisGoal: string;
  capability: string;
  requiredScope: string;
  riskLevel: "low" | "medium" | "high" | "sensitive";
  resourceTypes: string;
  examples: string;
  supportingHelpOptions: string[];
};

const emptyDemoAgentInput: DemoAgentCardInput = {
  system: "",
  agentSlug: "",
  agentName: "",
  description: "",
  diagnosisGoal: "",
  capability: "",
  requiredScope: "",
  riskLevel: "low",
  resourceTypes: "incident, ticket, account",
  examples: "",
  supportingHelpOptions: []
};

const supportingHelpOptions = [
  { value: "oauth_scope_compare", label: "OAuth scope comparison" },
  { value: "api_health", label: "API health / rate limit" },
  { value: "security_policy", label: "Security policy evaluation" }
];

async function friendlyApiError(response: Response, fallback: string): Promise<string> {
  const text = await response.text();
  let body: { error?: string; details?: string[]; limit?: number } | undefined;

  try {
    body = text ? JSON.parse(text) as { error?: string; details?: string[]; limit?: number } : undefined;
  } catch {
    body = undefined;
  }

  if (response.status === 429 || body?.error === "Too many requests") {
    return "Too many requests. Wait a minute and try again.";
  }

  if (body?.error === "demo_agent_limit_reached") {
    return `You can create up to ${body.limit ?? 5} external demo agents in this session. Delete one before adding another.`;
  }

  if (body?.error === "invalid_demo_agent_input") {
    const details = body.details?.length ? ` ${body.details.join(" ")}` : "";
    return `Demo agent input is invalid.${details}`;
  }

  if (body?.error === "Session required") {
    return "Your browser session expired. Refresh the page and try again.";
  }

  if (body?.error) {
    return `${fallback}: ${body.error}`;
  }

  return text ? `${fallback}: ${text}` : `${fallback} (${response.status})`;
}

function createMessageId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function MessageList({ messages }: { messages: ChatMessage[] }) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  return (
    <section className="chat-panel" aria-label="Conversation">
      {messages.map((chatMessage) => (
        <article
          className={`message ${chatMessage.role === "user" ? "user-message" : "assistant-message"} ${chatMessage.status === "loading" ? "loading" : ""
            }`}
          key={chatMessage.id}
        >
          {chatMessage.content}
        </article>
      ))}
      <div ref={endRef} />
    </section>
  );
}

function App() {
  const [message, setMessage] = useState(sampleMessage);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [health, setHealth] = useState<AgentsHealthResponse | null>(null);
  const [healthError, setHealthError] = useState("");
  const [isHealthLoading, setIsHealthLoading] = useState(false);
  const [isHealthPanelOpen, setIsHealthPanelOpen] = useState(false);
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null);
  const [deleteAgentError, setDeleteAgentError] = useState("");
  const [deleteAgentMessage, setDeleteAgentMessage] = useState("");
  const [isDemoBuilderOpen, setIsDemoBuilderOpen] = useState(false);
  const [demoAgentInput, setDemoAgentInput] = useState<DemoAgentCardInput>(emptyDemoAgentInput);
  const [demoAgentPreview, setDemoAgentPreview] = useState<DemoAgentCard | null>(null);
  const [demoAgentCards, setDemoAgentCards] = useState<DemoAgentCard[]>([]);
  const [demoAgentWarnings, setDemoAgentWarnings] = useState<string[]>([]);
  const [demoAgentError, setDemoAgentError] = useState("");
  const [demoAgentSuccessMessage, setDemoAgentSuccessMessage] = useState("");
  const [recentlyAddedDemoAgentId, setRecentlyAddedDemoAgentId] = useState("");
  const demoAgentListRef = useRef<HTMLDivElement | null>(null);
  const [activeScenarioCategory, setActiveScenarioCategory] = useState(scenarios[0].category);
  const latestResponse = useMemo(
    () => [...messages].reverse().find((item) => item.role === "assistant" && item.status === "done" && item.metadata)?.metadata ?? null,
    [messages]
  );
  const activeScenarioGroup = scenarios.find((group) => group.category === activeScenarioCategory) ?? scenarios[0];
  const healthLabel = health
    ? `Agents: ${health.summary.healthy}/${health.summary.total} healthy`
    : "Agents: check health";

  function canDeleteHealthAgent(agent: AgentsHealthResponse["agents"][number]): boolean {
    return agent.endpointType === "session";
  }

  function healthEndpointLabel(agent: AgentsHealthResponse["agents"][number]): string {
    if (agent.agentId === "mock-identity-provider") {
      return "Infrastructure dependency";
    }

    if (agent.endpointType === "session") {
      return "Session demo agent";
    }

    if (agent.endpointType === "internal") {
      return "Internal Railway service";
    }

    return `Agent Card ${agent.details.agentCardAvailable ? "yes" : "no"}`;
  }

  function resetDemoAgentDraft() {
    setDemoAgentInput(emptyDemoAgentInput);
    setDemoAgentPreview(null);
    setDemoAgentWarnings([]);
    setDemoAgentError("");
  }

  function clearDemoAgentStatus() {
    setDemoAgentSuccessMessage("");
    setRecentlyAddedDemoAgentId("");
  }

  async function checkAgentHealth() {
    setHealthError("");
    setIsHealthLoading(true);

    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/agents/health`, {
        method: "GET",
        credentials: "include"
      });

      if (!response.ok) {
        throw new Error(await friendlyApiError(response, "Failed to check agent health"));
      }

      setHealth((await response.json()) as AgentsHealthResponse);
    } catch (caughtError) {
      setHealthError(caughtError instanceof Error ? caughtError.message : "Failed to check agent health");
    } finally {
      setIsHealthLoading(false);
    }
  }

  async function deleteDemoAgent(agentId: string) {
    const confirmed = window.confirm(`Remove demo agent ${agentId} from this orchestrator session?`);
    if (!confirmed) {
      return;
    }

    setDeleteAgentError("");
    setDeleteAgentMessage("");
    setDeletingAgentId(agentId);

    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/agents/${encodeURIComponent(agentId)}`, {
        method: "DELETE",
        credentials: "include"
      });

      if (!response.ok) {
        throw new Error(await friendlyApiError(response, "Failed to delete demo agent"));
      }

      const body = await response.json() as { deleted: boolean; agentId: string; remainingAgents: string[] };
      setDeleteAgentMessage(`Removed ${body.agentId} from active demo agents.`);
      await loadDemoAgentCards();
      await checkAgentHealth();
    } catch (caughtError) {
      setDeleteAgentError(caughtError instanceof Error ? caughtError.message : "Failed to delete demo agent");
    } finally {
      setDeletingAgentId(null);
    }
  }

  useEffect(() => {
    void checkAgentHealth();
  }, []);

  async function ensureSession() {
    const response = await fetch(`${API_URL}/session`, {
      method: "POST",
      credentials: "include"
    });

    if (!response.ok) {
      throw new Error(await friendlyApiError(response, "Failed to create browser session"));
    }
  }

  function demoRequestBody() {
    return {
      ...demoAgentInput,
      resourceTypes: demoAgentInput.resourceTypes.split(",").map((item) => item.trim()).filter(Boolean),
      examples: demoAgentInput.examples.split(",").map((item) => item.trim()).filter(Boolean),
      capability: demoAgentInput.capability.trim() || undefined,
      requiredScope: demoAgentInput.requiredScope.trim() || undefined
    };
  }

  function toggleSupportingHelpOption(option: string) {
    clearDemoAgentStatus();
    setDemoAgentInput((current) => {
      const enabled = current.supportingHelpOptions.includes(option);
      return {
        ...current,
        supportingHelpOptions: enabled
          ? current.supportingHelpOptions.filter((item) => item !== option)
          : [...current.supportingHelpOptions, option]
      };
    });
  }

  function closeDemoBuilder() {
    setIsDemoBuilderOpen(false);
    clearDemoAgentStatus();
  }

  async function loadDemoAgentCards() {
    setDemoAgentError("");
    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/demo-agent-cards`, {
        method: "GET",
        credentials: "include"
      });
      if (!response.ok) {
        throw new Error(await friendlyApiError(response, "Failed to load demo Agent Cards"));
      }
      const body = await response.json() as { agentCards: DemoAgentCard[] };
      setDemoAgentCards(body.agentCards);
    } catch (caughtError) {
      setDemoAgentError(caughtError instanceof Error ? caughtError.message : "Failed to load demo Agent Cards");
    }
  }

  async function generateDemoAgentPreview() {
    setDemoAgentError("");
    clearDemoAgentStatus();
    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/demo-agent-cards/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(demoRequestBody())
      });
      if (!response.ok) {
        throw new Error(await friendlyApiError(response, "Failed to generate demo Agent Card"));
      }
      const body = await response.json() as { agentCard: DemoAgentCard; warnings: string[] };
      setDemoAgentPreview(body.agentCard);
      setDemoAgentWarnings(body.warnings);
    } catch (caughtError) {
      setDemoAgentError(caughtError instanceof Error ? caughtError.message : "Failed to generate demo Agent Card");
    }
  }

  async function addDemoAgentToSession() {
    setDemoAgentError("");
    setDemoAgentSuccessMessage("");
    setRecentlyAddedDemoAgentId("");
    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/demo-agent-cards`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(demoAgentPreview ?? demoRequestBody())
      });
      if (!response.ok) {
        throw new Error(await friendlyApiError(response, "Failed to add demo Agent Card"));
      }
      const body = await response.json() as { agentCard: DemoAgentCard; agentCards: DemoAgentCard[]; warnings: string[] };
      setDemoAgentCards(body.agentCards);
      setDemoAgentWarnings(body.warnings);
      setDemoAgentSuccessMessage("External demo agent added to this session.");
      setRecentlyAddedDemoAgentId(body.agentCard.agentId);
      setDemoAgentInput(emptyDemoAgentInput);
      setDemoAgentPreview(null);
      if (messages.length > 0) {
        startNewConversation();
      }
      await checkAgentHealth();
      window.setTimeout(() => {
        demoAgentListRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 0);
    } catch (caughtError) {
      setDemoAgentError(caughtError instanceof Error ? caughtError.message : "Failed to add demo Agent Card");
    }
  }

  async function deleteSessionDemoAgent(agentId: string) {
    setDemoAgentError("");
    clearDemoAgentStatus();
    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/demo-agent-cards/${encodeURIComponent(agentId)}`, {
        method: "DELETE",
        credentials: "include"
      });
      if (!response.ok) {
        throw new Error(await friendlyApiError(response, "Failed to delete demo Agent Card"));
      }
      const body = await response.json() as { agentCards: DemoAgentCard[] };
      setDemoAgentCards(body.agentCards);
      if (demoAgentPreview?.agentId === agentId) {
        setDemoAgentPreview(null);
      }
      await checkAgentHealth();
    } catch (caughtError) {
      setDemoAgentError(caughtError instanceof Error ? caughtError.message : "Failed to delete demo Agent Card");
    }
  }

  async function resolveIssue(issueText: string) {
    const trimmedIssueText = issueText.trim();

    if (!trimmedIssueText || isLoading) {
      return;
    }

    setError("");
    setIsLoading(true);

    const loadingMessageId = createMessageId();
    const now = new Date().toISOString();
    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: createMessageId(),
        role: "user",
        content: trimmedIssueText,
        timestamp: now,
        status: "done"
      },
      {
        id: loadingMessageId,
        role: "assistant",
        content: "Starting A2A task conversation...",
        timestamp: now,
        status: "loading"
      }
    ]);

    try {
      await ensureSession();
      const apiResponse = await fetch(`${API_URL}/resolve`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        credentials: "include",
        body: JSON.stringify({ message: trimmedIssueText, conversationId })
      });

      if (!apiResponse.ok) {
        throw new Error(`Orchestrator returned ${apiResponse.status} with body ${await apiResponse.text()}`);
      }

      const resolvedResponse = (await apiResponse.json()) as ResolveResponse;
      setConversationId(resolvedResponse.conversationId);
      setMessages((currentMessages) =>
        currentMessages.map((chatMessage) =>
          chatMessage.id === loadingMessageId
            ? {
              ...chatMessage,
              content: resolvedResponse.finalAnswer,
              timestamp: new Date().toISOString(),
              status: "done",
              metadata: resolvedResponse
            }
            : chatMessage
        )
      );
    } catch (caughtError) {
      const errorMessage = caughtError instanceof Error ? caughtError.message : "Failed to resolve issue";
      setError(errorMessage);
      setMessages((currentMessages) =>
        currentMessages.map((chatMessage) =>
          chatMessage.id === loadingMessageId
            ? {
              ...chatMessage,
              content: `Unable to resolve issue: ${errorMessage}`,
              timestamp: new Date().toISOString(),
              status: "done"
            }
            : chatMessage
        )
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function submitIssue(event: React.FormEvent) {
    event.preventDefault();
    await resolveIssue(message);
  }

  function startNewConversation() {
    setMessages([]);
    setConversationId(undefined);
    setError("");
    setMessage(sampleMessage);
  }

  return (
    <main className="shell">
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">ServiceNow-style AI Orchestrator Agent</p>
            <h1>A2A support diagnosis console</h1>
          </div>
          <div className="topbar-actions">
            <div className="status">Conversation: {conversationId ? conversationId.slice(0, 8) : "new"}</div>
            <button type="button" className="secondary-button" onClick={startNewConversation} disabled={isLoading}>
              New conversation
            </button>
            <div className="status">Local mock mode</div>
            <button
              type="button"
              className={`health-summary ${health?.summary.down ? "has-down" : health?.summary.degraded ? "has-degraded" : "all-healthy"} ${isHealthPanelOpen ? "active-panel-button" : ""}`}
              onClick={() => {
                setIsDemoBuilderOpen(false);
                setIsHealthPanelOpen((current) => !current);
                if (!health && !isHealthLoading) {
                  void checkAgentHealth();
                }
              }}
              title={health?.summary.down || health?.summary.degraded ? "One or more external agents are unavailable. Some demo scenarios may return partial results." : "External mock agent health"}
            >
              <span>{isHealthLoading ? "Checking agent health..." : healthLabel}</span>
              <small>{isHealthPanelOpen ? "Click to close" : "Click for details"}</small>
            </button>
            <button
              type="button"
              className={`secondary-button ${isDemoBuilderOpen ? "active-panel-button" : ""}`}
              onClick={() => {
                setIsHealthPanelOpen(false);
                setIsDemoBuilderOpen((current) => !current);
                if (!isDemoBuilderOpen) {
                  void loadDemoAgentCards();
                }
              }}
            >
              {isDemoBuilderOpen ? "Creating external demo agent" : "Create external demo agent"}
            </button>
          </div>
        </header>

        {isHealthPanelOpen ? (
          <section className="agent-health-panel" aria-label="Agent health">
            <div className="agent-health-header">
              <div>
                <p className="active-panel-eyebrow">Active panel&nbsp;&nbsp; Agent Health</p>
                <h2>Agent Health</h2>
                <p className="orchestrator-health-line">
                  Orchestrator:
                  <span className={`orchestrator-health-badge ${health?.orchestrator.status === "ok" ? "health-ok" : "health-down"}`}>
                    {health?.orchestrator.status ?? "unknown"}
                  </span>
                  {health?.orchestrator.timestamp ? ` / ${new Date(health.orchestrator.timestamp).toLocaleTimeString()}` : ""}
                </p>
              </div>
              <button type="button" onClick={() => void checkAgentHealth()} disabled={isHealthLoading}>
                {isHealthLoading ? "Checking..." : "Refresh health"}
              </button>
            </div>
            {healthError ? <p className="error">{healthError}</p> : null}
            {deleteAgentError ? <p className="error">{deleteAgentError}</p> : null}
            {deleteAgentMessage ? <p className="success-note">{deleteAgentMessage}</p> : null}
            {health ? (
              <>
                <div className="health-counts">
                  <span className="health-ok">Healthy {health.summary.healthy}</span>
                  <span className="health-degraded">Degraded {health.summary.degraded}</span>
                  <span className="health-down">Down {health.summary.down}</span>
                </div>
                <div className="agent-health-list">
                  {health.agents.map((agent) => (
                    <article className="agent-health-row" key={agent.agentId}>
                      <div>
                        <strong>{agent.agentId}</strong>
                        <span>{agent.latencyMs} ms / {new Date(agent.checkedAt).toLocaleTimeString()}</span>
                      </div>
                      <div className="agent-health-actions">
                        <span className={`health-pill ${healthClass(agent.status)}`}>{agent.status}</span>
                        {canDeleteHealthAgent(agent) ? (
                          <button
                            type="button"
                            className="agent-delete-button"
                            disabled={isHealthLoading || deletingAgentId === agent.agentId}
                            onClick={() => void deleteDemoAgent(agent.agentId)}
                          >
                            {deletingAgentId === agent.agentId ? "..." : "Delete"}
                          </button>
                        ) : null}
                      </div>
                      <small>{healthEndpointLabel(agent)}</small>
                      {agent.error ? <p>{agent.error}</p> : null}
                    </article>
                  ))}
                </div>
              </>
            ) : !healthError ? (
              <p className="muted-note">Checking agent health...</p>
            ) : null}
          </section>
        ) : null}

        {isDemoBuilderOpen ? (
          <section className="demo-agent-builder" aria-label="Create External Demo Agent">
            <div className="agent-health-header">
              <div>
                <p className="active-panel-eyebrow">Active panel&nbsp;&nbsp; External Demo Agent Builder</p>
                <h2>Create External Demo Agent</h2>
                <p>Simulate a vendor/domain-owned external agent. Fill in simple fields, and the demo generates the Agent Card JSON that a real external system would publish at /.well-known/agent-card.json.</p>
              </div>
              <button type="button" onClick={closeDemoBuilder}>Close</button>
            </div>
            <h2>Describe the external agent</h2>
            <div className="demo-agent-form">
              <label>
                <span>System / product</span>
                <input value={demoAgentInput.system} onChange={(event) => {
                  clearDemoAgentStatus();
                  setDemoAgentInput({ ...demoAgentInput, system: event.target.value });
                }} placeholder="Salesforce" />
                <small>The product or domain this external agent owns, for example Salesforce, Slack, Datadog, Okta.</small>
              </label>
              <label>
                <span>Agent name</span>
                <input value={demoAgentInput.agentName} onChange={(event) => {
                  clearDemoAgentStatus();
                  setDemoAgentInput({ ...demoAgentInput, agentName: event.target.value });
                }} placeholder="Salesforce Access Agent" />
                <small>Friendly name shown in the demo.</small>
              </label>
              <label className="wide-field">
                <span>What can this agent diagnose?</span>
                <input value={demoAgentInput.diagnosisGoal} onChange={(event) => {
                  clearDemoAgentStatus();
                  setDemoAgentInput({ ...demoAgentInput, diagnosisGoal: event.target.value });
                }} placeholder="Diagnose Salesforce access issues" />
                <small>The demo uses this to generate safe routing metadata such as capability and requested action.</small>
              </label>
              <label>
                <span>Risk level</span>
                <select value={demoAgentInput.riskLevel} onChange={(event) => {
                  clearDemoAgentStatus();
                  setDemoAgentInput({ ...demoAgentInput, riskLevel: event.target.value as DemoAgentCardInput["riskLevel"] });
                }}>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="sensitive">sensitive</option>
                </select>
                <small>Read-only diagnosis should be low/medium. High/sensitive actions should require approval or be blocked.</small>
              </label>
              <label>
                <span>Resource types</span>
                <input value={demoAgentInput.resourceTypes} onChange={(event) => {
                  clearDemoAgentStatus();
                  setDemoAgentInput({ ...demoAgentInput, resourceTypes: event.target.value });
                }} />
                <small>Objects this agent understands, for example user, account, incident, repository, service.</small>
              </label>
              <label>
                <span>Description</span>
                <input value={demoAgentInput.description} onChange={(event) => {
                  clearDemoAgentStatus();
                  setDemoAgentInput({ ...demoAgentInput, description: event.target.value });
                }} placeholder="Demo agent that diagnoses Salesforce issues." />
              </label>
              <label>
                <span>Examples</span>
                <input value={demoAgentInput.examples} onChange={(event) => {
                  clearDemoAgentStatus();
                  setDemoAgentInput({ ...demoAgentInput, examples: event.target.value });
                }} placeholder="Salesforce login fails, cannot access account" />
              </label>
              <div className="wide-field demo-agent-checkboxes">
                <span>Can this agent ask another agent for help?</span>
                <small>The agent does not directly call another agent. It can request delegated help, and the orchestrator validates policy, prevents loops, and mediates the task.</small>
                <div>
                  {supportingHelpOptions.map((option) => (
                    <label key={option.value}>
                      <input
                        type="checkbox"
                        checked={demoAgentInput.supportingHelpOptions.includes(option.value)}
                        onChange={() => toggleSupportingHelpOption(option.value)}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                  <label>
                    <input
                      type="checkbox"
                      checked={demoAgentInput.supportingHelpOptions.length === 0}
                      onChange={() => {
                        clearDemoAgentStatus();
                        setDemoAgentInput({ ...demoAgentInput, supportingHelpOptions: [] });
                      }}
                    />
                    <span>None</span>
                  </label>
                </div>
              </div>
              <details className="wide-field demo-agent-advanced">
                <summary>Advanced generated metadata</summary>
                <div className="demo-agent-form nested-demo-agent-form">
                  <label>
                    <span>Agent slug</span>
                    <input value={demoAgentInput.agentSlug} onChange={(event) => {
                      clearDemoAgentStatus();
                      setDemoAgentInput({ ...demoAgentInput, agentSlug: event.target.value });
                    }} placeholder="salesforce-access" />
                    <small>Optional. Generates IDs like demo-salesforce-access-agent. Leave blank for a unique generated ID.</small>
                  </label>
                  <label>
                    <span>Capability override</span>
                    <input value={demoAgentInput.capability} onChange={(event) => {
                      clearDemoAgentStatus();
                      setDemoAgentInput({ ...demoAgentInput, capability: event.target.value });
                    }} placeholder="salesforce.access.diagnose" />
                    <small>Stable routing key generated by default from the diagnosis goal.</small>
                  </label>
                  <label>
                    <span>Required scope override</span>
                    <input value={demoAgentInput.requiredScope} onChange={(event) => {
                      clearDemoAgentStatus();
                      setDemoAgentInput({ ...demoAgentInput, requiredScope: event.target.value });
                    }} placeholder="salesforce.diagnose" />
                    <small>Permission encoded into the A2A JWT. Generated by default from the system.</small>
                  </label>
                </div>
              </details>
            </div>
            <div className="demo-agent-actions">
              <button type="button" onClick={() => void generateDemoAgentPreview()}>Generate preview</button>
              <button type="button" onClick={() => void addDemoAgentToSession()}>Add to session</button>
              <button type="button" onClick={() => {
                clearDemoAgentStatus();
                resetDemoAgentDraft();
              }}>New draft</button>
            </div>
            {(demoAgentError || demoAgentSuccessMessage) ? (
              <div className="demo-agent-feedback" role={demoAgentError ? "alert" : "status"}>
                {demoAgentError ? <p className="demo-agent-error">{demoAgentError}</p> : null}
                {demoAgentSuccessMessage ? <p className="demo-agent-success">{demoAgentSuccessMessage}</p> : null}
              </div>
            ) : null}
            {demoAgentPreview ? (
              <div className="demo-agent-auth-note">
                <strong>Generated A2A security metadata</strong>
                <small>These values are generated by the demo from your form. In production, the external vendor agent would publish them in its Agent Card.</small>
                <strong>agentId</strong>
                <span>{demoAgentPreview.agentId}</span>
                <strong>audience</strong>
                <span>{demoAgentPreview.auth.audience}</span>
                <strong>required scope</strong>
                <span>{demoAgentPreview.skills[0]?.requiredScopes?.[0] ?? "none"}</span>
                <strong>capability</strong>
                <span>{demoAgentPreview.skills[0]?.capabilities?.[0] ?? "none"}</span>
                <strong>auth mode</strong>
                <span>{demoAgentPreview.auth.type}</span>
                <strong>endpoint</strong>
                <span>{demoAgentPreview.endpoint}</span>
              </div>
            ) : null}
            {demoAgentWarnings.length > 0 ? (
              <ul className="demo-agent-warnings">
                {demoAgentWarnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            ) : null}
            <div className="demo-agent-list" ref={demoAgentListRef}>
              <h2>Session demo agents</h2>
              {demoAgentCards.length ? demoAgentCards.map((card) => (
                <article className={recentlyAddedDemoAgentId === card.agentId ? "recently-added-demo-agent" : ""} key={card.agentId}>
                  <strong>{card.agentId}</strong>
                  <span>{card.skills[0]?.capabilities?.[0] ?? "no capability"}</span>
                  <button type="button" onClick={() => {
                    setDemoAgentPreview(card);
                    setDemoAgentWarnings([]);
                    setDemoAgentError("");
                    setDemoAgentSuccessMessage("");
                  }}>View JSON</button>
                  <button type="button" onClick={() => void deleteSessionDemoAgent(card.agentId)}>Delete</button>
                </article>
              )) : <p className="muted-note">No session demo Agent Cards yet.</p>}
            </div>
            {demoAgentPreview ? (
              <div className="demo-agent-preview">
                <h2>/.well-known/agent-card.json preview</h2>
                <p className="muted-note">This JSON is generated by the demo. In a real A2A federation, this JSON would be hosted by the external vendor/domain agent.</p>
                <JsonBlock value={demoAgentPreview} />
              </div>
            ) : null}
          </section>
        ) : null}

        <MessageList messages={messages} />

        <div className="composer-dock">
          <div className="scenario-launcher" aria-label="Demo scenarios">
            <div className="scenario-tabs" role="tablist" aria-label="Scenario categories">
              {scenarios.map((group) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={group.category === activeScenarioCategory}
                  className={group.category === activeScenarioCategory ? "active" : ""}
                  key={group.category}
                  onClick={() => setActiveScenarioCategory(group.category)}
                >
                  {group.category}
                </button>
              ))}
            </div>
            <div className="scenario-buttons">
              {activeScenarioGroup.items.map((scenario) => (
                <article className="scenario-option" key={scenario.label}>
                  <button
                    type="button"
                    className="scenario-select"
                    title={scenario.subtitle}
                    onClick={() => setMessage(scenario.message)}
                  >
                    <strong>{scenario.label}</strong>
                    <small>{scenario.subtitle}</small>
                  </button>
                  <button
                    type="button"
                    className="scenario-run"
                    disabled={isLoading}
                    onClick={() => {
                      setMessage(scenario.message);
                      void resolveIssue(scenario.message);
                    }}
                  >
                    Run
                  </button>
                </article>
              ))}
            </div>
          </div>

          <form className="composer" onSubmit={submitIssue}>
            <input
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              aria-label="Integration issue"
            />
            <button type="submit" disabled={isLoading}>
              {isLoading ? "Resolving..." : "Resolve"}
            </button>
          </form>
        </div>

        {error ? <p className="error">{error}</p> : null}
      </section>

      <aside className="details">
        {latestResponse ? (
          <>
            <section>
              <h2>Demo Flow Type</h2>
              <div className="flow-type">{inferDemoFlowType(latestResponse)}</div>
              <p className="muted-note">Conversation ID: {latestResponse.conversationId ?? conversationId ?? "new"}</p>
            </section>

            {latestResponse.resolutionStatus === "unsupported" && inferDemoFlowType(latestResponse) !== "Out of scope" ? (
              <section className="manual-workflow">
                <h2>Manual ServiceNow Request Required</h2>
                <p>{latestResponse.finalAnswer}</p>
              </section>
            ) : null}

            <section>
              <h2>Classification</h2>
              <div className="classification-details">
                <div>
                  <span>System</span>
                  <strong>{latestResponse.classification.system}</strong>
                </div>
                <div>
                  <span>Error Code</span>
                  <strong>{latestResponse.classification.errorCode ?? "none"}</strong>
                </div>
                <div>
                  <span>Issue Type</span>
                  <strong>{latestResponse.classification.issueType}</strong>
                </div>
                <div>
                  <span>Operation</span>
                  <strong>{latestResponse.classification.operation ?? "unknown"}</strong>
                </div>
                <div>
                  <span>Confidence</span>
                  <strong>{latestResponse.classification.confidence}</strong>
                </div>
                <div>
                  <span>Source</span>
                  <strong>{latestResponse.classification.classificationSource}</strong>
                </div>
                <div>
                  <span>Classification AI Provider</span>
                  <strong>{latestResponse.classification.aiProvider ?? "none"}</strong>
                </div>
                <div>
                  <span>Classification AI Model</span>
                  <strong>{latestResponse.classification.aiModel ?? "none"}</strong>
                </div>
                <div>
                  <span>Reporter Type</span>
                  <strong>{latestResponse.classification.reporterType}</strong>
                </div>
                <div>
                  <span>Support Mode</span>
                  <strong>{latestResponse.classification.supportMode}</strong>
                </div>
                <p>{latestResponse.classification.reasoningSummary}</p>
              </div>
            </section>

            {latestResponse.requestInterpretation ? (
              <section>
                <h2>Request Interpretation</h2>
                <div className="classification-details">
                  <div>
                    <span>Scope</span>
                    <strong>{latestResponse.requestInterpretation.scope}</strong>
                  </div>
                  <div>
                    <span>Intent</span>
                    <strong>{latestResponse.requestInterpretation.intentType}</strong>
                  </div>
                  <div>
                    <span>Capability</span>
                    <strong>{latestResponse.requestInterpretation.requestedCapability ?? "unknown"}</strong>
                  </div>
                  <div>
                    <span>Interpretation Source</span>
                    <strong>{latestResponse.requestInterpretation.interpretationSource ?? "unknown"}</strong>
                  </div>
                  <div>
                    <span>AI Provider</span>
                    <strong>{latestResponse.requestInterpretation.aiProvider ?? "none"}</strong>
                  </div>
                  <div>
                    <span>AI Model</span>
                    <strong>{latestResponse.requestInterpretation.aiModel ?? "none"}</strong>
                  </div>
                  <div>
                    <span>Target System</span>
                    <strong>{latestResponse.requestInterpretation.targetSystemText ?? "Unknown"}</strong>
                  </div>
                  <div>
                    <span>Resource</span>
                    <strong>
                      {[latestResponse.requestInterpretation.targetResourceType, latestResponse.requestInterpretation.targetResourceName].filter(Boolean).join(": ") || "Unknown"}
                    </strong>
                  </div>
                  <div>
                    <span>Requires Approval</span>
                    <strong>{latestResponse.requestInterpretation.requiresApproval ? "yes" : "no"}</strong>
                  </div>
                  <p>{latestResponse.requestInterpretation.reason}</p>
                </div>
              </section>
            ) : null}

            {latestResponse.followUpInterpretation ? (
              <section>
                <h2>Follow-up Context</h2>
                <div className="classification-details">
                  <div>
                    <span>Follow-up</span>
                    <strong>{latestResponse.followUpInterpretation.isFollowUp ? "yes" : "no"}</strong>
                  </div>
                  <div>
                    <span>Source</span>
                    <strong>{latestResponse.followUpInterpretation.interpretationSource ?? "unknown"}</strong>
                  </div>
                  <div>
                    <span>Confidence</span>
                    <strong>{latestResponse.followUpInterpretation.confidence}</strong>
                  </div>
                  <div>
                    <span>Added Environment</span>
                    <strong>{latestResponse.followUpInterpretation.addsEnvironment ?? "none"}</strong>
                  </div>
                  <div>
                    <span>Added Error</span>
                    <strong>{latestResponse.followUpInterpretation.addsErrorText ?? "none"}</strong>
                  </div>
                  <div>
                    <span>Added Impact</span>
                    <strong>{latestResponse.followUpInterpretation.addsImpact ?? "none"}</strong>
                  </div>
                  <p>{latestResponse.followUpInterpretation.reason}</p>
                </div>
              </section>
            ) : null}

            {latestResponse.incidentContext ? (
              <section>
                <h2>Incident Context</h2>
                <div className="classification-details">
                  <div>
                    <span>Affected System</span>
                    <strong>{latestResponse.incidentContext.targetSystemText ?? "Unknown"}</strong>
                  </div>
                  <div>
                    <span>Environment</span>
                    <strong>{latestResponse.incidentContext.environment ?? "Unknown"}</strong>
                  </div>
                  <div>
                    <span>Symptom</span>
                    <strong>{latestResponse.incidentContext.symptom ?? "Unknown"}</strong>
                  </div>
                  <div>
                    <span>Error</span>
                    <strong>{latestResponse.incidentContext.errorText ?? "Unknown"}</strong>
                  </div>
                  <div>
                    <span>Impact</span>
                    <strong>{latestResponse.incidentContext.impact ?? "Unknown"}</strong>
                  </div>
                  <div>
                    <span>Assignment Group</span>
                    <strong>{latestResponse.incidentContext.suggestedAssignmentGroup}</strong>
                  </div>
                </div>
              </section>
            ) : null}

            <section>
              <h2>ServiceNow Routing</h2>
              <div className="routing-details">
                <div>
                  <span>Source</span>
                  <strong>{latestResponse.routingSource}</strong>
                </div>
                <div>
                  <span>Confidence</span>
                  <strong>{latestResponse.routingConfidence}</strong>
                </div>
                <div>
                  <span>Status</span>
                  <strong>{latestResponse.resolutionStatus}</strong>
                </div>
                <p>
                  {routingDescription(latestResponse)} {latestResponse.routingReasoningSummary}
                </p>
              </div>
            </section>

            <section className="agent-grid">
              <div>
                <h2>A2A Selected Agents</h2>
                <ul className="agent-list">
                  {latestResponse.selectedAgents.map((agent) => (
                    <li key={agent.agentId}>
                      <strong>{agent.agentId}</strong>
                      <span>{agent.role}{agent.skillId ? ` / ${agent.skillId}` : ""}</span>
                      {agent.matchedCapability || typeof agent.matchScore === "number" || agent.owner || agent.targetSystemText ? (
                        <span>
                          {agent.matchedCapability ? `capability=${agent.matchedCapability} ` : ""}
                          {typeof agent.matchScore === "number" ? `score=${agent.matchScore} ` : ""}
                          {agent.owner ? `owner=${agent.owner} ` : ""}
                          {agent.targetSystemText ? `target=${agent.targetSystemText}` : ""}
                        </span>
                      ) : null}
                      <p>{agent.reason}</p>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h2>Skipped Agents</h2>
                <ul className="agent-list">
                  {latestResponse.skippedAgents.map((agent) => (
                    <li key={agent.agentId}>
                      <strong>{agent.agentId}</strong>
                      <p>{agent.reason}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section>
              <h2>Evidence</h2>
              {latestResponse.evidence.length > 0 ? (
                latestResponse.evidence.map((item) => (
                  <article className="evidence" key={`${item.agent}-${item.title}`}>
                    <strong>{item.title}</strong>
                    <span>{item.agent}</span>
                    <JsonBlock value={item.data} />
                  </article>
                ))
              ) : (
                <p className="muted-note">No evidence collected because no agent was executed.</p>
              )}
            </section>

            <section>
              <h2>A2A Conversation Trace</h2>
              <ol className="timeline">
                {latestResponse.executionTrace.map((entry, index) => (
                  <li key={`${entry.actor}-${entry.action}-${index}`}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{entry.actor}</strong>
                      <p>{entry.detail}</p>
                      {entry.taskId || entry.skillId || entry.fromAgent || entry.toAgent || entry.mediatedBy || entry.decision || typeof entry.delegationDepth === "number" ? (
                        <p className="trace-meta">
                          {entry.taskId ? `taskId=${entry.taskId} ` : ""}
                          {entry.conversationId ? `conversationId=${entry.conversationId} ` : ""}
                          {entry.fromAgent ? `from=${entry.fromAgent} ` : ""}
                          {entry.toAgent ? `to=${entry.toAgent} ` : ""}
                          {entry.mediatedBy ? `mediatedBy=${entry.mediatedBy} ` : ""}
                          {entry.skillId ? `skill=${entry.skillId} ` : ""}
                          {entry.decision ? `decision=${entry.decision} ` : ""}
                          {typeof entry.delegationDepth === "number" ? `delegationDepth=${entry.delegationDepth}` : ""}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            {latestResponse.a2aTasks?.length ? (
              <section>
                <h2>A2A Tasks</h2>
                {latestResponse.a2aTasks.map((task) => (
                  <article className="evidence" key={task.taskId}>
                    <strong>{task.fromAgent} to {task.toAgent}</strong>
                    <span>{task.skillId ?? "no skill"}</span>
                    <JsonBlock
                      value={{
                        taskId: task.taskId,
                        conversationId: task.conversationId,
                        targetAudience: task.context.targetAudience,
                        requestedScope: task.context.requestedScope,
                        authMode: task.context.authMode,
                        auth: task.context.auth,
                        authDelegatedBy: task.context.auth?.delegatedBy,
                        authDelegationDepth: task.context.auth?.delegationDepth,
                        authParentTaskId: task.context.auth?.parentTaskId,
                        authRequestedByAgent: task.context.auth?.requestedByAgent,
                        mediatedBy: task.mediatedBy,
                        delegationDepth: task.delegationDepth,
                        parentTaskId: task.parentTaskId,
                        requestedByAgent: task.requestedByAgent,
                        securityDecision: task.context.securityDecision?.decision
                      }}
                    />
                  </article>
                ))}
              </section>
            ) : null}

            {(latestResponse.securityDecisions?.length ?? (latestResponse.securityDecision ? 1 : 0)) > 0 ? (
              <section>
                <h2>Security Decisions</h2>
                {(latestResponse.securityDecisions ?? (latestResponse.securityDecision ? [latestResponse.securityDecision] : [])).map((decision, index) => (
                  <div className="security-decision" key={`${decision.caller}-${decision.target}-${decision.requestedAction}-${index}`}>
                    <div>
                      <span>Caller</span>
                      <strong>{decision.caller}</strong>
                    </div>
                    <div>
                      <span>Target</span>
                      <strong>{decision.target}</strong>
                    </div>
                    <div>
                      <span>Requested Action</span>
                      <strong>{decision.requestedAction}</strong>
                    </div>
                    <div>
                      <span>Required Permission</span>
                      <strong>{decision.requiredPermission}</strong>
                    </div>
                    <div>
                      <span>Decision</span>
                      <strong className={`decision-badge ${decisionClass(decision.decision)}`}>
                        {decision.decision}
                      </strong>
                    </div>
                    <div>
                      <span>Matched Policy</span>
                      <strong>{decision.matchedPolicy}</strong>
                    </div>
                    <div>
                      <span>Caller Permissions</span>
                      <strong>{decision.callerPermissions.join(", ") || "none"}</strong>
                    </div>
                    <p>{decision.reason}</p>
                  </div>
                ))}
              </section>
            ) : null}

            <section>
              <h2>Raw Agent Trace</h2>
              <ol className="trace">
                {latestResponse.agentTrace.map((entry, index) => (
                  <li key={`${entry.agent}-${entry.action}-${index}`}>
                    <div className="raw-trace-header">
                      <strong>{entry.agent}</strong>
                      <span className="trace-separator">  </span>
                      <span className="trace-action">{entry.action}</span>
                    </div>
                    <p className="raw-trace-description">{entry.detail}</p>
                  </li>
                ))}
              </ol>
            </section>
          </>
        ) : (
          <div className="empty-state">Choose a scenario to run or type a message in the input field.</div>
        )}
      </aside>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
