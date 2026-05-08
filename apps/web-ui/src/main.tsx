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

type Scenario = (typeof scenarios)[number]["items"][number];
type ActiveTab = "run-task" | "agent-registry" | "trust-identity" | "security-timeline";

const tabs: Array<{ id: ActiveTab; label: string }> = [
  { id: "run-task", label: "Run Task" },
  { id: "agent-registry", label: "Agent Registry" },
  { id: "trust-identity", label: "Trust & Identity" },
  { id: "security-timeline", label: "Security Timeline" }
];

const quickScenarioLabels = new Set([
  "Jira Permission Issue",
  "Jira 403 Missing Scope",
  "GitHub Rate Limit Delegation",
  "Blocked OAuth Inspection",
  "Needs Approval: Grant Jira Permission"
]);

const allScenarios: Scenario[] = scenarios.flatMap((group) => group.items);
const quickScenarios = allScenarios.filter((scenario) => quickScenarioLabels.has(scenario.label));
const advancedScenarios = allScenarios.filter((scenario) => !quickScenarioLabels.has(scenario.label));
const infrastructureAgentIds = new Set(["mock-identity-provider"]);

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

function endpointMetadata(endpoint: string | undefined): { endpointType: AgentCardEndpointType; endpointScheme: AgentCardValidationSummary["endpointScheme"] } {
  if (!endpoint) {
    return { endpointType: "unknown", endpointScheme: "unknown" };
  }

  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol === "session:") {
      return { endpointType: "session", endpointScheme: "session" };
    }
    if (parsed.protocol === "https:") {
      return { endpointType: "public", endpointScheme: "https" };
    }
    if (parsed.protocol === "http:") {
      return { endpointType: "public", endpointScheme: "http" };
    }
  } catch {
    return { endpointType: "unknown", endpointScheme: "unknown" };
  }

  return { endpointType: "unknown", endpointScheme: "unknown" };
}

function endpointTypeLabel(endpointType: AgentCardEndpointType | "internal", endpointScheme?: AgentCardValidationSummary["endpointScheme"]): string {
  if (endpointType === "public" && endpointScheme && endpointScheme !== "unknown") {
    return `public ${endpointScheme}`;
  }

  return endpointType;
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

type AgentCardEndpointType = "public" | "session" | "unknown";

type AgentCardValidationSummary = {
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

type AgentCardValidationResult =
  | {
      valid: true;
      agentCard: DemoAgentCard;
      summary: AgentCardValidationSummary;
      warnings: string[];
    }
  | {
      valid: false;
      error: "invalid_agent_card";
      details: string[];
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

const sampleAgentCardJson = `{
  "agentId": "external-salesforce-access-agent",
  "name": "Salesforce Access Agent",
  "description": "Diagnoses Salesforce login and permission issues.",
  "systems": ["salesforce"],
  "endpoint": "https://agents.example.com/salesforce/task",
  "auth": {
    "type": "oauth2_client_credentials_jwt",
    "audience": "external-salesforce-access-agent"
  },
  "skills": [
    {
      "id": "salesforce-access-diagnose",
      "name": "Diagnose Salesforce access",
      "description": "Checks Salesforce access issues and missing permissions.",
      "capabilities": ["salesforce.access.diagnose"],
      "requiredScopes": ["salesforce.access.read"],
      "riskLevel": "medium",
      "examples": ["I cannot login to Salesforce", "User cannot access Salesforce account"],
      "scope": {
        "systems": ["salesforce"],
        "resourceTypes": ["user", "account", "permission"]
      }
    }
  ]
}`;

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
  const [activeTab, setActiveTab] = useState<ActiveTab>("run-task");
  const [message, setMessage] = useState(sampleMessage);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [health, setHealth] = useState<AgentsHealthResponse | null>(null);
  const [healthError, setHealthError] = useState("");
  const [isHealthLoading, setIsHealthLoading] = useState(false);
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null);
  const [deleteAgentError, setDeleteAgentError] = useState("");
  const [deleteAgentMessage, setDeleteAgentMessage] = useState("");
  const [demoAgentInput, setDemoAgentInput] = useState<DemoAgentCardInput>(emptyDemoAgentInput);
  const [demoAgentPreview, setDemoAgentPreview] = useState<DemoAgentCard | null>(null);
  const [demoAgentCards, setDemoAgentCards] = useState<DemoAgentCard[]>([]);
  const [importedAgentCards, setImportedAgentCards] = useState<DemoAgentCard[]>([]);
  const [demoAgentWarnings, setDemoAgentWarnings] = useState<string[]>([]);
  const [demoAgentError, setDemoAgentError] = useState("");
  const [demoAgentSuccessMessage, setDemoAgentSuccessMessage] = useState("");
  const [recentlyAddedDemoAgentId, setRecentlyAddedDemoAgentId] = useState("");
  const [agentCardJson, setAgentCardJson] = useState("");
  const [agentCardValidation, setAgentCardValidation] = useState<AgentCardValidationResult | null>(null);
  const [agentCardImportError, setAgentCardImportError] = useState("");
  const [agentCardImportSuccess, setAgentCardImportSuccess] = useState("");
  const [isAgentCardValidating, setIsAgentCardValidating] = useState(false);
  const [isAgentCardImporting, setIsAgentCardImporting] = useState(false);
  const demoAgentListRef = useRef<HTMLDivElement | null>(null);
  const latestResponse = useMemo(
    () => [...messages].reverse().find((item) => item.role === "assistant" && item.status === "done" && item.metadata)?.metadata ?? null,
    [messages]
  );
  const healthLabel = health
    ? `Agents: ${health.summary.healthy}/${health.summary.total} healthy`
    : "Agents: check health";
  const authModeLabel = health?.orchestrator.authMode === "oauth2_client_credentials_jwt"
    ? "Secure A2A JWT mode"
    : "Local mock mode";
  const healthAgentIds = new Set(health?.agents.map((agent) => agent.agentId) ?? []);
  const demoAgentCardById = new Map(demoAgentCards.map((card) => [card.agentId, card]));
  const importedAgentCardById = new Map(importedAgentCards.map((card) => [card.agentId, card]));
  const builtInAgentsCount = health?.agents.filter((agent) => agent.endpointType !== "session" && !infrastructureAgentIds.has(agent.agentId)).length ?? 0;
  const sessionDemoAgentsCount = demoAgentCards.length || health?.agents.filter((agent) => agent.endpointType === "session").length || 0;
  const healthyAgentsCount = health?.summary.healthy ?? 0;
  const registeredAgentRows = [
    ...(health?.agents.map((agent) => {
      const demoAgentCard = demoAgentCardById.get(agent.agentId);
      const importedAgentCard = importedAgentCardById.get(agent.agentId);
      return {
        agentId: agent.agentId,
        status: agent.status,
        endpointType: agent.endpointType,
        endpointScheme: endpointMetadata(demoAgentCard?.endpoint ?? importedAgentCard?.endpoint).endpointScheme,
        authMode: demoAgentCard?.auth?.type ?? importedAgentCard?.auth?.type ?? "unknown",
        latencyMs: agent.latencyMs,
        agentCardAvailable: agent.details.agentCardAvailable || Boolean(demoAgentCard) || Boolean(importedAgentCard),
        error: agent.error,
        canDelete: agent.endpointType === "session",
        source: infrastructureAgentIds.has(agent.agentId) ? "infrastructure" : demoAgentCard ? "session-generated" : importedAgentCard ? "session-imported" : "built-in"
      };
    }) ?? []),
    ...demoAgentCards
      .filter((card) => !healthAgentIds.has(card.agentId))
      .map((card) => ({
        agentId: card.agentId,
        status: "unknown",
        endpointType: "session" as const,
        endpointScheme: "session" as const,
        authMode: card.auth?.type ?? "unknown",
        latencyMs: undefined,
        agentCardAvailable: true,
        error: undefined,
        canDelete: true,
        source: "session-generated"
      })),
    ...importedAgentCards
      .filter((card) => !healthAgentIds.has(card.agentId))
      .map((card) => {
        const endpoint = endpointMetadata(card.endpoint);
        return {
          agentId: card.agentId,
          status: "unknown",
          endpointType: endpoint.endpointType,
          endpointScheme: endpoint.endpointScheme,
          authMode: card.auth?.type ?? "unknown",
          latencyMs: undefined,
          agentCardAvailable: true,
          error: undefined,
          canDelete: true,
          source: "session-imported"
        };
      })
  ];

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
    const confirmed = window.confirm(`Remove agent ${agentId} from this orchestrator session?`);
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
      setDeleteAgentMessage(`Removed ${body.agentId} from the session registry.`);
      await loadDemoAgentCards();
      await loadImportedAgentCards();
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

  useEffect(() => {
    if (activeTab === "agent-registry") {
      void loadDemoAgentCards();
      void loadImportedAgentCards();
      void checkAgentHealth();
    }
  }, [activeTab]);

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

  async function loadImportedAgentCards() {
    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/agent-cards`, {
        method: "GET",
        credentials: "include"
      });
      if (!response.ok) {
        throw new Error(await friendlyApiError(response, "Failed to load imported Agent Cards"));
      }
      const body = await response.json() as { agentCards: DemoAgentCard[] };
      setImportedAgentCards(body.agentCards);
    } catch (caughtError) {
      setAgentCardImportError(caughtError instanceof Error ? caughtError.message : "Failed to load imported Agent Cards");
    }
  }

  function parsePastedAgentCard(): unknown | undefined {
    if (!agentCardJson.trim()) {
      setAgentCardValidation({ valid: false, error: "invalid_agent_card", details: ["Paste Agent Card JSON before validating."] });
      setAgentCardImportError("");
      return undefined;
    }

    try {
      return JSON.parse(agentCardJson) as unknown;
    } catch {
      setAgentCardValidation({ valid: false, error: "invalid_agent_card", details: ["Invalid JSON. Check the pasted Agent Card syntax."] });
      setAgentCardImportError("");
      return undefined;
    }
  }

  async function validatePastedAgentCard() {
    const parsedAgentCard = parsePastedAgentCard();
    if (!parsedAgentCard) {
      return;
    }

    setAgentCardImportError("");
    setAgentCardImportSuccess("");
    setIsAgentCardValidating(true);

    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/agent-cards/validate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ agentCard: parsedAgentCard })
      });
      const body = await response.json() as AgentCardValidationResult;
      setAgentCardValidation(body);
      if (!response.ok && body.valid !== false) {
        throw new Error("Failed to validate Agent Card");
      }
    } catch (caughtError) {
      setAgentCardImportError(caughtError instanceof Error ? caughtError.message : "Failed to validate Agent Card");
    } finally {
      setIsAgentCardValidating(false);
    }
  }

  async function importPastedAgentCard() {
    const parsedAgentCard = parsePastedAgentCard();
    if (!parsedAgentCard || agentCardValidation?.valid !== true) {
      return;
    }

    setAgentCardImportError("");
    setAgentCardImportSuccess("");
    setIsAgentCardImporting(true);

    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/agent-cards/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ agentCard: parsedAgentCard })
      });
      const body = await response.json() as { imported?: boolean; agentCard?: DemoAgentCard; agentCards?: DemoAgentCard[]; warnings?: string[] } | AgentCardValidationResult;
      if (!response.ok) {
        if ("valid" in body && body.valid === false) {
          setAgentCardValidation(body);
        }
        throw new Error("Failed to import Agent Card");
      }
      if ("agentCards" in body && body.agentCards) {
        setImportedAgentCards(body.agentCards);
      }
      setAgentCardImportSuccess("Agent Card imported into this session.");
      await loadImportedAgentCards();
      await loadDemoAgentCards();
      await checkAgentHealth();
    } catch (caughtError) {
      setAgentCardImportError(caughtError instanceof Error ? caughtError.message : "Failed to import Agent Card");
    } finally {
      setIsAgentCardImporting(false);
    }
  }

  function clearPastedAgentCard() {
    setAgentCardJson("");
    setAgentCardValidation(null);
    setAgentCardImportError("");
    setAgentCardImportSuccess("");
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
      setDemoAgentSuccessMessage("Sample Agent added to this session.");
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

  function renderScenarioOptions(items: Scenario[]) {
    return (
      <div className="scenario-buttons">
        {items.map((scenario) => (
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
    );
  }

  function renderAgentCardImport() {
    const validationSummary = agentCardValidation?.valid ? agentCardValidation.summary : null;
    const validationWarnings = agentCardValidation?.valid ? agentCardValidation.warnings : [];
    const validationDetails = agentCardValidation?.valid === false ? agentCardValidation.details : [];

    return (
      <section className="agent-card-import" aria-label="Import Agent Card">
        <div className="panel-header">
          <div>
            <p className="active-panel-eyebrow">Paste import</p>
            <h2>Import Agent Card</h2>
            <p className="muted-note">Paste a standardized Agent Card JSON published by an external agent. The gateway validates capabilities, scopes, auth audience, risk level, and endpoint metadata before allowing orchestration.</p>
          </div>
        </div>
        <textarea
          value={agentCardJson}
          onChange={(event) => {
            setAgentCardJson(event.target.value);
            setAgentCardValidation(null);
            setAgentCardImportError("");
            setAgentCardImportSuccess("");
          }}
          placeholder={sampleAgentCardJson}
          aria-label="Agent Card JSON"
        />
        <div className="demo-agent-actions">
          <button type="button" onClick={() => void validatePastedAgentCard()} disabled={isAgentCardValidating || isAgentCardImporting}>
            {isAgentCardValidating ? "Validating..." : "Validate"}
          </button>
          <button type="button" onClick={() => void importPastedAgentCard()} disabled={agentCardValidation?.valid !== true || isAgentCardImporting || isAgentCardValidating}>
            {isAgentCardImporting ? "Importing..." : "Import Agent Card"}
          </button>
          <button type="button" onClick={clearPastedAgentCard} disabled={isAgentCardImporting || isAgentCardValidating}>Clear</button>
          <button type="button" onClick={() => {
            setAgentCardJson(sampleAgentCardJson);
            setAgentCardValidation(null);
            setAgentCardImportError("");
            setAgentCardImportSuccess("");
          }} disabled={isAgentCardImporting || isAgentCardValidating}>Use sample</button>
        </div>
        {agentCardImportError ? <p className="demo-agent-error" role="alert">{agentCardImportError}</p> : null}
        {agentCardImportSuccess ? <p className="demo-agent-success" role="status">{agentCardImportSuccess}</p> : null}
        {agentCardValidation ? (
          <div className={`agent-card-validation ${agentCardValidation.valid ? "valid" : "invalid"}`}>
            <strong>{agentCardValidation.valid ? "Valid Agent Card" : "Invalid Agent Card"}</strong>
            {validationSummary ? (
              <div className="agent-card-summary">
                <div>
                  <span>Agent ID</span>
                  <strong>{validationSummary.agentId}</strong>
                </div>
                <div>
                  <span>Name</span>
                  <strong>{validationSummary.name}</strong>
                </div>
                <div>
                  <span>Auth type</span>
                  <strong>{validationSummary.authType}</strong>
                </div>
                <div>
                  <span>Audience</span>
                  <strong>{validationSummary.audience}</strong>
                </div>
                <div>
                  <span>Endpoint type</span>
                  <strong>{endpointTypeLabel(validationSummary.endpointType, validationSummary.endpointScheme)}</strong>
                </div>
                <div>
                  <span>Capabilities</span>
                  <strong>{validationSummary.capabilities.join(", ") || "none"}</strong>
                </div>
                <div>
                  <span>Required scopes</span>
                  <strong>{validationSummary.requiredScopes.join(", ") || "none"}</strong>
                </div>
                <div>
                  <span>Risk levels</span>
                  <strong>{validationSummary.riskLevels.join(", ") || "none"}</strong>
                </div>
              </div>
            ) : null}
            {validationWarnings.length > 0 ? (
              <div>
                <span>Warnings</span>
                <ul className="demo-agent-warnings">
                  {validationWarnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </div>
            ) : null}
            {validationDetails.length > 0 ? (
              <div>
                <span>Details</span>
                <ul className="demo-agent-warnings validation-details">
                  {validationDetails.map((detail) => <li key={detail}>{detail}</li>)}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    );
  }

  function renderDemoAgentBuilder() {
    return (
      <section className="demo-agent-builder" aria-label="Generate sample Agent Card">
        <div className="panel-header">
          <div>
            <p className="active-panel-eyebrow">Section C</p>
            <h2>Generate sample Agent Card</h2>
            <p className="muted-note">This creates a session-scoped demo Agent Card simulating a vendor-owned external agent.</p>
          </div>
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
          <button type="button" onClick={() => void addDemoAgentToSession()}>Add sample Agent</button>
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
    );
  }

  function renderRunTaskTab() {
    return (
      <>
        <MessageList messages={messages} />

        <div className="composer-dock">
          <div className="scenario-launcher" aria-label="Demo scenarios">
            <div className="scenario-heading">
              <h2>Quick Scenarios</h2>
            </div>
            {renderScenarioOptions(quickScenarios)}
            <details className="advanced-scenarios">
              <summary>Advanced Scenarios</summary>
              {renderScenarioOptions(advancedScenarios)}
            </details>
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
      </>
    );
  }

  function renderAgentRegistryTab() {
    return (
      <section className="control-panel agent-registry-panel" aria-label="Agent Registry">
        <div className="panel-header">
          <div>
            <h2>Agent Registry</h2>
            <p className="muted-note">Registered built-in and session-scoped agents visible to the orchestrator.</p>
          </div>
          <button type="button" className="secondary-button" onClick={() => {
            void loadDemoAgentCards();
            void loadImportedAgentCards();
            void checkAgentHealth();
          }} disabled={isHealthLoading}>
            {isHealthLoading ? "Refreshing..." : "Refresh registry"}
          </button>
        </div>

        <section className="registry-section">
          <p className="active-panel-eyebrow">Section A</p>
          <h2>Registry Summary</h2>
          <div className="registry-summary-grid">
            <article>
              <span>Built-in agents</span>
              <strong>{builtInAgentsCount}</strong>
            </article>
            <article>
              <span>Session demo agents</span>
              <strong>{sessionDemoAgentsCount}</strong>
            </article>
            <article>
              <span>Healthy agents</span>
              <strong>{healthyAgentsCount}</strong>
            </article>
            <article>
              <span>Auth mode</span>
              <strong>{health?.orchestrator.authMode ?? "unknown"}</strong>
            </article>
          </div>
        </section>

        <section className="registry-section">
          <p className="active-panel-eyebrow">Section B</p>
          <h2>Registered Agents</h2>
          {healthError ? <p className="error">{healthError}</p> : null}
          {deleteAgentError ? <p className="error">{deleteAgentError}</p> : null}
          {deleteAgentMessage ? <p className="success-note">{deleteAgentMessage}</p> : null}
          {registeredAgentRows.length ? (
            <div className="registry-agent-list">
              {registeredAgentRows.map((agent) => (
                <article className="registry-agent-row" key={agent.agentId}>
                  <div>
                    <span>Agent ID</span>
                    <strong>{agent.agentId}</strong>
                  </div>
                  <div>
                    <span>Status</span>
                    <strong className={`health-pill ${healthClass(agent.status)}`}>{agent.status}</strong>
                  </div>
                  <div>
                    <span>Endpoint type</span>
                    <strong>{endpointTypeLabel(agent.endpointType, agent.endpointScheme)}</strong>
                  </div>
                  <div>
                    <span>Source</span>
                    <strong>{agent.source}</strong>
                  </div>
                  <div>
                    <span>Auth mode</span>
                    <strong>{agent.authMode}</strong>
                  </div>
                  <div>
                    <span>Agent Card</span>
                    <strong>{agent.agentCardAvailable ? "yes" : "no"}</strong>
                  </div>
                  <div>
                    <span>Latency</span>
                    <strong>{typeof agent.latencyMs === "number" ? `${agent.latencyMs} ms` : "unknown"}</strong>
                  </div>
                  <div className="registry-agent-actions">
                    <span>Actions</span>
                    {agent.canDelete ? (
                      <button
                        type="button"
                        className="agent-delete-button"
                        disabled={isHealthLoading || deletingAgentId === agent.agentId}
                        onClick={() => void deleteDemoAgent(agent.agentId)}
                      >
                        {deletingAgentId === agent.agentId ? "..." : "Delete"}
                      </button>
                    ) : (
                      <strong>None</strong>
                    )}
                  </div>
                  {agent.error ? <p className="registry-agent-error">{agent.error}</p> : null}
                </article>
              ))}
            </div>
          ) : (
            <p className="muted-note">{isHealthLoading ? "Loading registered agents..." : "No registered agents found."}</p>
          )}
        </section>

        <div className="registry-section">
          {renderAgentCardImport()}
        </div>

        <div className="registry-section">
          {renderDemoAgentBuilder()}
        </div>
      </section>
    );
  }

  function renderTrustIdentityTab() {
    return (
      <section className="control-panel placeholder-panel" aria-label="Trust and Identity">
        <div className="panel-header">
          <div>
            <h2>Trust & Identity</h2>
            <p className="muted-note">Next: connect external IdP, validate user identity, inspect JWKS, and test scoped token issuance.</p>
          </div>
          <button type="button" className="secondary-button" onClick={() => void checkAgentHealth()} disabled={isHealthLoading}>
            {isHealthLoading ? "Refreshing..." : "Refresh health"}
          </button>
        </div>
        <div className="registry-summary-grid">
          <article>
            <span>authMode</span>
            <strong>{health?.orchestrator.authMode ?? "unknown"}</strong>
          </article>
          <article>
            <span>secureAuthRequired</span>
            <strong>{typeof health?.orchestrator.secureAuthRequired === "boolean" ? String(health.orchestrator.secureAuthRequired) : "unknown"}</strong>
          </article>
        </div>
        {healthError ? <p className="error">{healthError}</p> : null}
      </section>
    );
  }

  function renderSecurityTimelineTab() {
    return (
      <section className="control-panel placeholder-panel" aria-label="Security Timeline">
        <div className="panel-header">
          <div>
            <h2>Security Timeline</h2>
            <p className="muted-note">Next: convert raw trace into a step-by-step identity, routing, policy, and agent execution timeline.</p>
          </div>
        </div>
        {latestResponse ? (
          <div className="registry-summary-grid">
            <article>
              <span>executionTrace</span>
              <strong>{latestResponse.executionTrace.length}</strong>
            </article>
            <article>
              <span>agentTrace</span>
              <strong>{latestResponse.agentTrace.length}</strong>
            </article>
            <article>
              <span>a2aTasks</span>
              <strong>{latestResponse.a2aTasks?.length ?? 0}</strong>
            </article>
            <article>
              <span>a2aResponses</span>
              <strong>{latestResponse.a2aResponses?.length ?? 0}</strong>
            </article>
          </div>
        ) : (
          <p className="muted-note">Run a task to populate trace counts.</p>
        )}
      </section>
    );
  }

  return (
    <main className={`shell ${activeTab === "run-task" ? "" : "single-panel-shell"}`}>
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Secure A2A Control Plane</p>
            <h1>Secure Agent Orchestration Gateway</h1>
            <p className="subtitle">Import external agents through Agent Cards and govern execution with scoped JWTs, policy, and audit.</p>
          </div>
          <div className="topbar-actions">
            <div className="status">Conversation: {conversationId ? conversationId.slice(0, 8) : "new"}</div>
            <button type="button" className="secondary-button" onClick={startNewConversation} disabled={isLoading}>
              New conversation
            </button>
            <div className="status">
              {authModeLabel}
              {health?.orchestrator.secureAuthRequired ? " / Secure auth required" : ""}
            </div>
            <div className={`health-summary ${health?.summary.down ? "has-down" : health?.summary.degraded ? "has-degraded" : "all-healthy"}`}>
              <span>{isHealthLoading ? "Checking agent health..." : healthLabel}</span>
              <small>{health?.orchestrator.status ?? "unknown"}</small>
            </div>
          </div>
        </header>

        <nav className="product-tabs" aria-label="Control plane sections">
          {tabs.map((tab) => (
            <button
              type="button"
              key={tab.id}
              className={activeTab === tab.id ? "active" : ""}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {activeTab === "run-task" ? renderRunTaskTab() : null}
        {activeTab === "agent-registry" ? renderAgentRegistryTab() : null}
        {activeTab === "trust-identity" ? renderTrustIdentityTab() : null}
        {activeTab === "security-timeline" ? renderSecurityTimelineTab() : null}
      </section>

      {activeTab === "run-task" ? (
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
      ) : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
