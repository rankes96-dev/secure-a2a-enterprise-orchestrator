import type { AgentName } from "@a2a/shared";
import { discoverAgentCards, getAgentCard as getDiscoveredAgentCard, getAgentCards, type AgentCard } from "./agentCards";

export type AgentCardRegistry = {
  listAgentCards(): Promise<AgentCard[]>;
  getAgentCard(agentId: AgentName | string): Promise<AgentCard | undefined>;
};

export class StaticAgentCardRegistry implements AgentCardRegistry {
  private discovered = false;

  async listAgentCards(): Promise<AgentCard[]> {
    await this.ensureDiscovered();
    return getAgentCards();
  }

  async getAgentCard(agentId: AgentName | string): Promise<AgentCard | undefined> {
    await this.ensureDiscovered();
    return getDiscoveredAgentCard(agentId);
  }

  private async ensureDiscovered(): Promise<void> {
    if (this.discovered) {
      return;
    }

    await discoverAgentCards();
    this.discovered = true;
  }
}
