import type {
  FollowUpInterpretation,
  PendingFollowUpContext,
  PendingInteraction,
  RequestInterpretation,
  ResolveResponse,
  SelectedAgent
} from "@a2a/shared";
import type { IncidentContext } from "../incidentContext.js";

export type ConversationState = {
  conversationId: string;
  ownerSessionHash: string;
  actorProvider?: string;
  actorSubject?: string;
  actorEmail?: string;
  tenantId?: string;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    timestamp: string;
  }>;
  needsMoreInfoCount: number;
  lastRequestInterpretation?: RequestInterpretation;
  lastFollowUpInterpretation?: FollowUpInterpretation;
  lastIncidentContext?: IncidentContext;
  lastSelectedAgents?: SelectedAgent[];
  lastResolutionStatus?: ResolveResponse["resolutionStatus"];
  pendingFollowUp?: PendingFollowUpContext;
  pendingInteraction?: PendingInteraction;
};
