import { createHash } from "node:crypto";
import type { VerifiedUserIdentity } from "../security/userIdentity.js";
import { defaultTenantId } from "../tenant/tenantContext.js";
import type { ConversationState } from "./conversationTypes.js";

export type ConversationOwnerContext = {
  ownerSessionHash: string;
  actorProvider?: string;
  actorSubject?: string;
  actorEmail?: string;
  tenantId?: string;
};

export function ownerSessionHashFromSessionToken(sessionToken: string | undefined): string {
  return createHash("sha256").update(sessionToken ?? "anonymous").digest("hex");
}

export function conversationOwnerContext(params: {
  sessionToken?: string;
  actor?: VerifiedUserIdentity;
  tenantId?: string;
}): ConversationOwnerContext {
  return {
    ownerSessionHash: ownerSessionHashFromSessionToken(params.sessionToken),
    actorProvider: params.actor?.provider,
    actorSubject: params.actor?.subject,
    actorEmail: params.actor?.email,
    tenantId: params.tenantId ?? defaultTenantId()
  };
}

export function applyConversationOwner(state: Omit<ConversationState, keyof ConversationOwnerContext>, owner: ConversationOwnerContext): ConversationState {
  return {
    ...state,
    ownerSessionHash: owner.ownerSessionHash,
    actorProvider: owner.actorProvider,
    actorSubject: owner.actorSubject,
    actorEmail: owner.actorEmail,
    tenantId: owner.tenantId
  };
}

export function conversationBelongsToOwner(state: ConversationState, owner: ConversationOwnerContext): boolean {
  return state.ownerSessionHash === owner.ownerSessionHash &&
    (!state.actorProvider || !owner.actorProvider || state.actorProvider === owner.actorProvider) &&
    (!state.actorSubject || !owner.actorSubject || state.actorSubject === owner.actorSubject);
}
