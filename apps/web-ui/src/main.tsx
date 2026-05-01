import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ResolveResponse } from "@a2a/shared";
import "./styles.css";

const API_URL = import.meta.env.VITE_ORCHESTRATOR_API_URL ?? "http://localhost:4000";
const sampleMessage = "Jira sync fails with 403 when creating issues";

const scenarios = [
  {
    label: "Jira 403 Missing Scope",
    message: "Jira sync fails with 403 when creating issues"
  },
  {
    label: "GitHub Rate Limit",
    message: "GitHub repository sync started failing with 403 during nightly scan"
  },
  {
    label: "PagerDuty Alert Failure",
    message: "PagerDuty alert failure when sending incident notifications"
  },
  {
    label: "SAP 401 Invalid Client",
    message: "SAP integration returns 401 invalid client during token exchange"
  }
];

function JsonBlock({ value }: { value: unknown }) {
  return <pre>{JSON.stringify(value, null, 2)}</pre>;
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
          className={`message ${chatMessage.role === "user" ? "user-message" : "assistant-message"} ${
            chatMessage.status === "loading" ? "loading" : ""
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
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const latestResponse = useMemo(
    () => [...messages].reverse().find((item) => item.role === "assistant" && item.status === "done" && item.metadata)?.metadata ?? null,
    [messages]
  );

  async function ensureSession() {
    const response = await fetch(`${API_URL}/session`, {
      method: "POST",
      credentials: "include"
    });

    if (!response.ok) {
      throw new Error(`Session request returned ${response.status}`);
    }
  }

  async function submitIssue(event: React.FormEvent) {
    event.preventDefault();
    const issueText = message.trim();

    if (!issueText || isLoading) {
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
        content: issueText,
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
        body: JSON.stringify({ message: issueText })
      });
      
      if (!apiResponse.ok) {
        throw new Error(`Orchestrator returned ${apiResponse.status} with body ${await apiResponse.text()}`);
      }

      const resolvedResponse = (await apiResponse.json()) as ResolveResponse;
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

  return (
    <main className="shell">
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">ServiceNow-style AI Orchestrator Agent</p>
            <h1>A2A support diagnosis console</h1>
          </div>
          <div className="status">Local mock mode</div>
        </header>

        <MessageList messages={messages} />

        <div className="composer-dock">
          <div className="scenario-buttons" aria-label="Demo scenarios">
            {scenarios.map((scenario) => (
              <button
                type="button"
                key={scenario.label}
                onClick={() => setMessage(scenario.message)}
              >
                {scenario.label}
              </button>
            ))}
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
                  <span>AI Provider</span>
                  <strong>{latestResponse.classification.aiProvider ?? "none"}</strong>
                </div>
                <div>
                  <span>AI Model</span>
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
                  {latestResponse.routingSource === "ai"
                    ? "AI selected agents using Agent Cards."
                    : "AI route failed validation; deterministic Agent Card fallback used."}{" "}
                  {latestResponse.routingReasoningSummary}
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
                      <strong className={decision.decision === "Allowed" ? "allowed" : "blocked"}>
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
                      <span className="trace-separator"> </span>
                      <span className="trace-action">{entry.action}</span>
                    </div>
                    <p className="raw-trace-description">{entry.detail}</p>
                  </li>
                ))}
              </ol>
            </section>
          </>
        ) : (
          <div className="empty-state">Submit the Jira 403 scenario to view agent evidence and trace.</div>
        )}
      </aside>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
