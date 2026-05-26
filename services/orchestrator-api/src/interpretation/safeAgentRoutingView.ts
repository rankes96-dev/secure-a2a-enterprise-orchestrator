import type { AgentCard } from "../agentCards.js";

export type SafeAgentRoutingSkillView = {
  id: string;
  name?: string;
};

export type SafeAgentRoutingView = {
  agentId: string;
  name?: string;
  systems?: string[];
  skillIds: string[];
  skills: SafeAgentRoutingSkillView[];
};

function sorted(values: string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

export function safeAgentRoutingView(cards: AgentCard[]): SafeAgentRoutingView[] {
  return [...cards]
    .sort((left, right) => left.agentId.localeCompare(right.agentId))
    .map((card) => {
      const skills = [...card.skills]
        .map((skill) => ({
          id: skill.id,
          name: skill.name
        }))
        .sort((left, right) => left.id.localeCompare(right.id));

      return {
        agentId: card.agentId,
        name: card.name,
        systems: sorted(card.systems),
        skillIds: skills.map((skill) => skill.id),
        skills
      };
    });
}
