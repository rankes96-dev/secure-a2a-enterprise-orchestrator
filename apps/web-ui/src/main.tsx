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
  const [activeScenarioCategory, setActiveScenarioCategory] = useState(scenarios[0].category);
  const latestResponse = useMemo(
    () => [...messages].reverse().find((item) => item.role === "assistant" && item.status === "done" && item.metadata)?.metadata ?? null,
    [messages]
  );
  const activeScenarioGroup = scenarios.find((group) => group.category === activeScenarioCategory) ?? scenarios[0];
  const healthLabel = health
    ? `Agents: ${health.summary.healthy}/${health.summary.total} healthy`
    : "Agents: check health";

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
        throw new Error(`Agent health returned ${response.status} with body ${await response.text()}`);
      }

      setHealth((await response.json()) as AgentsHealthResponse);
    } catch (caughtError) {
      setHealthError(caughtError instanceof Error ? caughtError.message : "Failed to check agent health");
    } finally {
      setIsHealthLoading(false);
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
      throw new Error(`Session request returned ${response.status}`);
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
              className={`health-summary ${health?.summary.down ? "has-down" : health?.summary.degraded ? "has-degraded" : "all-healthy"}`}
              onClick={() => {
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
          </div>
        </header>

        {isHealthPanelOpen ? (
          <section className="agent-health-panel" aria-label="Agent health">
            <div className="agent-health-header">
              <div>
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
                      <span className={`health-pill ${healthClass(agent.status)}`}>{agent.status}</span>
                      <small>{agent.agentId === "mock-identity-provider" ? "Infrastructure dependency" : `Agent Card ${agent.details.agentCardAvailable ? "yes" : "no"}`}</small>
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
