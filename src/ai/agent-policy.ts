import type { AgentActionClass, AgentMode, AgentPolicy } from "../shared/agent-contracts";
import type { AppSnapshot, Space, Tab } from "../shared/contracts";
import { allAgentActions, defaultAgentPolicy, normalizePolicy } from "./agent-state-store";

export type PolicyTarget = {
  space?: Space;
  tab?: Tab;
  url?: string;
};

export type PolicyDecision = { allowed: true } | { allowed: false; reason: string };

export const isAgentMode = (value: unknown): value is AgentMode =>
  value === "full" || value === "guided" || value === "observe";

export const isAgentActionClass = (value: unknown): value is AgentActionClass =>
  typeof value === "string" && (allAgentActions as string[]).includes(value);

export const isAgentPolicy = (value: unknown): value is AgentPolicy => {
  if (typeof value !== "object" || value === null) return false;
  const policy = value as Record<string, unknown>;
  return (
    isAgentMode(policy.mode) &&
    (policy.allowedSpaceIds === null || isStringArray(policy.allowedSpaceIds)) &&
    (policy.allowedTabIds === null || isStringArray(policy.allowedTabIds)) &&
    (policy.allowedOrigins === null || isStringArray(policy.allowedOrigins)) &&
    isAgentActionArray(policy.allowedActions) &&
    typeof policy.allowVault === "boolean" &&
    typeof policy.allowPrivate === "boolean" &&
    typeof policy.maxTabs === "number" &&
    Number.isFinite(policy.maxTabs) &&
    policy.maxTabs >= 1 &&
    policy.maxTabs <= 100
  );
};

export class AgentPolicyEngine {
  constructor(private readonly getBrowserSnapshot: () => AppSnapshot) {}

  defaultPolicy(): AgentPolicy {
    return defaultAgentPolicy();
  }

  decide(policy: AgentPolicy, action: AgentActionClass, target: PolicyTarget = {}): PolicyDecision {
    const normalized = normalizePolicy(policy);
    if (!normalized.allowedActions.includes(action)) {
      return { allowed: false, reason: `The ${action} action is disabled for this thread` };
    }

    if (normalized.mode === "observe" && action !== "read") {
      return {
        allowed: false,
        reason: "Observe mode only permits reading page context and screenshots",
      };
    }

    const space = target.space ?? (target.tab ? this.findSpace(target.tab.spaceId) : undefined);
    if (space) {
      if (space.kind === "private" && !normalized.allowPrivate) {
        return { allowed: false, reason: "This thread is not allowed to access Private Spaces" };
      }
      if (normalized.allowedSpaceIds && !normalized.allowedSpaceIds.includes(space.id)) {
        return { allowed: false, reason: `Space ${space.name} is outside this thread's scope` };
      }
    }

    if (
      target.tab &&
      normalized.allowedTabIds &&
      !normalized.allowedTabIds.includes(target.tab.id)
    ) {
      return { allowed: false, reason: "This tab is outside the thread's tab scope" };
    }

    if (target.url && !this.originAllowed(normalized.allowedOrigins, target.url)) {
      return { allowed: false, reason: "This website origin is outside the thread's scope" };
    }

    return { allowed: true };
  }

  requiresApproval(policy: AgentPolicy, action: AgentActionClass): boolean {
    return (
      policy.mode === "guided" &&
      ["credential-fill", "form-submit", "external-side-effect", "destructive"].includes(action)
    );
  }

  originAllowed(allowedOrigins: string[] | null, value: string): boolean {
    if (!allowedOrigins || allowedOrigins.length === 0) return true;
    let origin: string;
    let hostname: string;
    try {
      const parsed = new URL(value);
      if (!/^https?:$/.test(parsed.protocol)) return false;
      origin = parsed.origin;
      hostname = parsed.hostname;
    } catch {
      return false;
    }

    return allowedOrigins.some((candidate) => {
      const normalized = candidate.trim().replace(/\/$/, "");
      if (!normalized) return false;
      if (normalized.startsWith("*."))
        return hostname === normalized.slice(2) || hostname.endsWith(`.${normalized.slice(2)}`);
      if (normalized.includes("://")) return origin === normalized;
      return hostname === normalized;
    });
  }

  canCreateTab(policy: AgentPolicy, space: Space): PolicyDecision {
    const snapshot = this.getBrowserSnapshot();
    const count = snapshot.tabs.length;
    if (count >= policy.maxTabs)
      return { allowed: false, reason: `This thread allows at most ${policy.maxTabs} tabs` };
    return this.decide(policy, "tab-management", { space });
  }

  private findSpace(spaceId: string): Space | undefined {
    return this.getBrowserSnapshot().spaces.find((space) => space.id === spaceId);
  }
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const isAgentActionArray = (value: unknown): value is AgentActionClass[] =>
  Array.isArray(value) && value.every(isAgentActionClass);
