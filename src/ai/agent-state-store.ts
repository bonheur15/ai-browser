import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AgentActionTrace,
  AgentGoal,
  AgentMessage,
  AgentPersistedState,
  AgentPersistedThread,
  AgentPolicy,
} from "../shared/agent-contracts";

const now = (): string => new Date().toISOString();

export const allAgentActions: AgentPolicy["allowedActions"] = [
  "read",
  "navigate",
  "tab-management",
  "page-interaction",
  "credential-fill",
  "form-submit",
  "external-side-effect",
  "destructive",
];

export const defaultAgentPolicy = (): AgentPolicy => ({
  mode: "full",
  allowedSpaceIds: null,
  allowedTabIds: null,
  allowedOrigins: null,
  allowedActions: [...allAgentActions],
  allowVault: true,
  allowPrivate: false,
  maxTabs: 24,
});

const defaultState = (): AgentPersistedState => ({
  version: 2,
  threads: [],
  messages: [],
  actions: [],
  activeThreadId: null,
  globalDefaults: defaultAgentPolicy(),
  goals: [],
});

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isPolicy = (value: unknown): value is AgentPolicy => {
  if (!isObject(value)) return false;
  return (
    ["full", "guided", "observe"].includes(String(value.mode)) &&
    (value.allowedSpaceIds === null || Array.isArray(value.allowedSpaceIds)) &&
    (value.allowedTabIds === null || Array.isArray(value.allowedTabIds)) &&
    (value.allowedOrigins === null || Array.isArray(value.allowedOrigins)) &&
    Array.isArray(value.allowedActions) &&
    typeof value.allowVault === "boolean" &&
    typeof value.allowPrivate === "boolean" &&
    typeof value.maxTabs === "number"
  );
};

const isThread = (value: unknown): value is AgentPersistedThread => {
  if (!isObject(value) || !isPolicy(value.policy)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.model === "string" &&
    ["low", "medium", "high"].includes(String(value.reasoningEffort)) &&
    typeof value.status === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    typeof value.lastActivityAt === "string" &&
    (typeof value.codexThreadId === "string" || value.codexThreadId === null) &&
    typeof value.ephemeral === "boolean"
  );
};

const isMessage = (value: unknown): value is AgentMessage => {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.threadId === "string" &&
    ["user", "assistant", "tool", "system"].includes(String(value.role)) &&
    ["text", "action", "status", "approval", "error"].includes(String(value.kind)) &&
    typeof value.text === "string" &&
    typeof value.createdAt === "string"
  );
};

const isAction = (value: unknown): value is AgentActionTrace => {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.threadId === "string" &&
    typeof value.toolName === "string" &&
    typeof value.actionClass === "string" &&
    typeof value.summary === "string" &&
    typeof value.status === "string" &&
    typeof value.startedAt === "string"
  );
};

const validState = (value: unknown): value is AgentPersistedState => {
  if (
    !isObject(value) ||
    (value.version !== 1 && value.version !== 2) ||
    !isPolicy(value.globalDefaults)
  )
    return false;
  return (
    Array.isArray(value.threads) &&
    value.threads.every(isThread) &&
    Array.isArray(value.messages) &&
    value.messages.every(isMessage) &&
    Array.isArray(value.actions) &&
    value.actions.every(isAction) &&
    (value.version === 1 || (Array.isArray(value.goals) && value.goals.every(isGoal))) &&
    (value.activeThreadId === null || typeof value.activeThreadId === "string")
  );
};

export class AgentStateStore {
  private state: AgentPersistedState = defaultState();
  private writeTimer: NodeJS.Timeout | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private loaded = false;

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (validState(parsed)) {
        this.state = {
          ...defaultState(),
          ...parsed,
          version: 2,
          globalDefaults: normalizePolicy(parsed.globalDefaults),
          goals: parsed.version === 2 && Array.isArray(parsed.goals) ? parsed.goals : [],
          threads: parsed.threads.map((thread) => ({
            ...thread,
            policy: normalizePolicy(thread.policy),
            status: ["running", "starting", "waiting-for-approval"].includes(thread.status)
              ? "paused"
              : thread.status,
          })),
        };
        if (
          this.state.activeThreadId &&
          !this.state.threads.some((thread) => thread.id === this.state.activeThreadId)
        ) {
          this.state.activeThreadId = this.state.threads[0]?.id ?? null;
        }
      }
    } catch (error: unknown) {
      const code = isObject(error) && "code" in error ? error.code : undefined;
      if (code !== "ENOENT")
        console.error("[agent-state] unable to read agent state; using a fresh state", error);
    }
  }

  getState(): AgentPersistedState {
    return structuredClone(this.state);
  }

  getThread(threadId: string): AgentPersistedThread | undefined {
    const thread = this.state.threads.find((candidate) => candidate.id === threadId);
    return thread ? structuredClone(thread) : undefined;
  }

  getThreads(): AgentPersistedThread[] {
    return structuredClone(this.state.threads);
  }

  getMessages(threadId: string): AgentMessage[] {
    return structuredClone(this.state.messages.filter((message) => message.threadId === threadId));
  }

  getActions(threadId: string): AgentActionTrace[] {
    return structuredClone(this.state.actions.filter((action) => action.threadId === threadId));
  }

  getGoals(): AgentGoal[] {
    return structuredClone(this.state.goals);
  }

  getGoal(goalId: string): AgentGoal | undefined {
    const goal = this.state.goals.find((candidate) => candidate.id === goalId);
    return goal ? structuredClone(goal) : undefined;
  }

  createGoal(
    input: Omit<
      AgentGoal,
      "id" | "createdAt" | "updatedAt" | "iteration" | "lastCheckpoint" | "lastAction"
    >,
  ): AgentGoal {
    const timestamp = now();
    const goal: AgentGoal = {
      ...input,
      id: randomUUID(),
      createdAt: timestamp,
      updatedAt: timestamp,
      iteration: 0,
      lastCheckpoint: null,
      lastAction: null,
    };
    this.state.goals.unshift(goal);
    this.scheduleWrite();
    return structuredClone(goal);
  }

  updateGoal(goalId: string, update: Partial<AgentGoal>): AgentGoal {
    const goal = this.state.goals.find((candidate) => candidate.id === goalId);
    if (!goal) throw new Error("Agent goal not found");
    Object.assign(goal, update, { updatedAt: now() });
    this.scheduleWrite();
    return structuredClone(goal);
  }

  createThread(input?: {
    title?: string;
    model?: string;
    ephemeral?: boolean;
  }): AgentPersistedThread {
    const timestamp = now();
    const thread: AgentPersistedThread = {
      id: randomUUID(),
      codexThreadId: null,
      ephemeral: input?.ephemeral ?? false,
      title: input?.title?.trim().slice(0, 80) || "New agent thread",
      model: input?.model || "gpt-5.6-luna",
      reasoningEffort: "medium",
      policy: normalizePolicy(this.state.globalDefaults),
      status: "idle",
      createdAt: timestamp,
      updatedAt: timestamp,
      lastActivityAt: timestamp,
    };
    this.state.threads.unshift(thread);
    this.state.activeThreadId = thread.id;
    this.scheduleWrite();
    return structuredClone(thread);
  }

  updateThread(threadId: string, update: Partial<AgentPersistedThread>): AgentPersistedThread {
    const thread = this.requireThread(threadId);
    Object.assign(thread, update, { updatedAt: now(), lastActivityAt: now() });
    if (update.policy) thread.policy = normalizePolicy(update.policy);
    this.scheduleWrite();
    return structuredClone(thread);
  }

  setActiveThread(threadId: string | null): void {
    if (threadId !== null) this.requireThread(threadId);
    this.state.activeThreadId = threadId;
    this.scheduleWrite();
  }

  removeThread(threadId: string): boolean {
    const before = this.state.threads.length;
    this.state.threads = this.state.threads.filter((thread) => thread.id !== threadId);
    this.state.messages = this.state.messages.filter((message) => message.threadId !== threadId);
    this.state.actions = this.state.actions.filter((action) => action.threadId !== threadId);
    if (this.state.activeThreadId === threadId)
      this.state.activeThreadId = this.state.threads[0]?.id ?? null;
    if (before === this.state.threads.length) return false;
    this.scheduleWrite();
    return true;
  }

  appendMessage(
    message: Omit<AgentMessage, "id" | "createdAt"> &
      Partial<Pick<AgentMessage, "id" | "createdAt">>,
  ): AgentMessage {
    const created: AgentMessage = {
      ...message,
      id: message.id ?? randomUUID(),
      createdAt: message.createdAt ?? now(),
    };
    this.requireThread(message.threadId);
    this.state.messages.push(created);
    this.touchThread(message.threadId);
    this.scheduleWrite();
    return structuredClone(created);
  }

  replaceMessage(messageId: string, text: string): AgentMessage | undefined {
    const message = this.state.messages.find((candidate) => candidate.id === messageId);
    if (!message) return undefined;
    message.text = text;
    this.touchThread(message.threadId);
    this.scheduleWrite();
    return structuredClone(message);
  }

  upsertAction(action: AgentActionTrace): AgentActionTrace {
    const index = this.state.actions.findIndex((candidate) => candidate.id === action.id);
    if (index === -1) this.state.actions.push(action);
    else this.state.actions[index] = action;
    this.touchThread(action.threadId);
    this.scheduleWrite();
    return structuredClone(action);
  }

  updateGlobalDefaults(policy: AgentPolicy): void {
    this.state.globalDefaults = normalizePolicy(policy);
    this.scheduleWrite();
  }

  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    await this.writeNow();
  }

  private requireThread(threadId: string): AgentPersistedThread {
    const thread = this.state.threads.find((candidate) => candidate.id === threadId);
    if (!thread) throw new Error("Agent thread not found");
    return thread;
  }

  private touchThread(threadId: string): void {
    const thread = this.requireThread(threadId);
    thread.updatedAt = now();
    thread.lastActivityAt = thread.updatedAt;
  }

  private scheduleWrite(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      void this.writeNow();
    }, 150);
  }

  private async writeNow(): Promise<void> {
    const state = this.getState();
    const ephemeralThreadIds = new Set(
      state.threads.filter((thread) => thread.ephemeral).map((thread) => thread.id),
    );
    state.threads = state.threads.filter((thread) => !thread.ephemeral);
    state.messages = state.messages.filter((message) => !ephemeralThreadIds.has(message.threadId));
    state.actions = state.actions.filter((action) => !ephemeralThreadIds.has(action.threadId));
    if (state.activeThreadId && ephemeralThreadIds.has(state.activeThreadId)) {
      state.activeThreadId = state.threads[0]?.id ?? null;
    }
    const temporaryPath = `${this.filePath}.tmp`;
    this.writeChain = this.writeChain
      .then(async () => {
        await mkdir(path.dirname(this.filePath), { recursive: true });
        await writeFile(temporaryPath, JSON.stringify(state, null, 2), "utf8");
        await rename(temporaryPath, this.filePath);
      })
      .catch((error: unknown) => {
        console.error("[agent-state] unable to persist agent state", error);
      });
    await this.writeChain;
  }
}

const isGoal = (value: unknown): value is AgentGoal => {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.threadId === "string" &&
    typeof value.title === "string" &&
    typeof value.objective === "string" &&
    ["draft", "running", "sleeping", "paused", "completed", "error", "stopped"].includes(
      String(value.status),
    ) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    (typeof value.endsAt === "string" || value.endsAt === null) &&
    (typeof value.wakeAt === "string" || value.wakeAt === null) &&
    typeof value.iteration === "number" &&
    typeof value.maxIterations === "number" &&
    (value.allowedOrigins === null || Array.isArray(value.allowedOrigins)) &&
    (typeof value.lastCheckpoint === "string" || value.lastCheckpoint === null) &&
    (typeof value.lastAction === "string" || value.lastAction === null)
  );
};

export const normalizePolicy = (policy: AgentPolicy): AgentPolicy => ({
  mode: policy.mode,
  allowedSpaceIds: policy.allowedSpaceIds
    ? [...new Set(policy.allowedSpaceIds.filter(Boolean))]
    : null,
  allowedTabIds: policy.allowedTabIds ? [...new Set(policy.allowedTabIds.filter(Boolean))] : null,
  allowedOrigins: policy.allowedOrigins
    ? [...new Set(policy.allowedOrigins.filter(Boolean))]
    : null,
  allowedActions: [...new Set(policy.allowedActions)],
  allowVault: policy.allowVault,
  allowPrivate: policy.allowPrivate,
  maxTabs: Math.min(100, Math.max(1, Math.floor(policy.maxTabs || 1))),
});
