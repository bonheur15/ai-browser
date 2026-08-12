import { randomUUID } from "node:crypto";
import type { BrowserRuntime } from "../main/browser-runtime";
import type {
  AgentActivity,
  AgentAPI,
  AgentApprovalRequest,
  AgentCommand,
  AgentCommandResult,
  AgentConnection,
  AgentEvent,
  AgentPolicy,
  AgentSnapshot,
} from "../shared/agent-contracts";
import { isJsonObject, type JsonObject, type JsonValue } from "../shared/json";
import type { AgentEvidenceStore } from "./agent-evidence-store";
import type { AgentMemoryStore } from "./agent-memory-store";
import { AgentPolicyEngine, isAgentPolicy } from "./agent-policy";
import { type AgentStateStore, defaultAgentPolicy, normalizePolicy } from "./agent-state-store";
import { BrowserAgentTools } from "./browser-agent-tools";
import {
  CodexAppServerClient,
  defaultBrowserDeveloperInstructions,
  extractThreadId,
  modelOption,
} from "./codex-app-server-client";
import type { CodexServerRequest, JsonRpcNotification } from "./codex-protocol";

type PendingApproval = {
  request: AgentApprovalRequest;
  resolve: (approved: boolean) => void;
};

const objectValue = (value: JsonValue | undefined): JsonObject =>
  isJsonObject(value) ? value : {};

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const safeTitle = (text: string): string => {
  const firstLine = text.split(/\r?\n/)[0]?.trim() ?? "";
  return firstLine.slice(0, 70) || "New agent thread";
};

export class AgentRuntime {
  private readonly policies: AgentPolicyEngine;
  private readonly tools: BrowserAgentTools;
  private readonly client: CodexAppServerClient;
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly runningActionIds = new Map<string, string>();
  private readonly assistantMessageIds = new Map<string, string>();
  private readonly turnIds = new Map<string, string>();
  private readonly explicitRunStatus = new Map<string, "paused" | "stopped">();
  private models: ReturnType<typeof modelOption>[] = [];
  private connection: AgentConnection = { status: "stopped" };
  private activity: AgentActivity = { kind: "idle", label: "Ready" };
  private readonly goalTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly browser: BrowserRuntime,
    private readonly state: AgentStateStore,
    private readonly evidence: AgentEvidenceStore,
    private readonly memory: AgentMemoryStore,
    private readonly emit: (event: AgentEvent) => void,
  ) {
    this.policies = new AgentPolicyEngine(() => this.browser.snapshot());
    this.tools = new BrowserAgentTools(this.browser, this.policies, this.memory);
    this.client = new CodexAppServerClient({
      onNotification: (notification) => this.handleNotification(notification),
      onServerRequest: (request) => this.handleServerRequest(request),
      onStatus: (status, message) => {
        this.connection =
          status === "stopped"
            ? { status: "stopped" }
            : { status, ...(message ? { message } : {}) };
        if (["stopped", "missing", "unauthenticated", "crashed"].includes(status)) {
          this.browser.releaseAllAgentTabLocks();
        }
        this.emit({ type: "agent.connection", connection: this.connection });
        this.publish();
      },
    });
  }

  api(): AgentAPI {
    return {
      getSnapshot: async () => this.snapshot(),
      dispatch: (command) => this.dispatch(command),
      getEvidence: (id) => this.getEvidence(id),
      subscribe: () => () => undefined,
    };
  }

  snapshot(): AgentSnapshot {
    const state = this.state.getState();
    const activeThreadId = state.activeThreadId;
    return {
      connection: structuredClone(this.connection),
      threads: state.threads.map(
        ({ codexThreadId: _codexThreadId, ephemeral: _ephemeral, ...thread }) => thread,
      ),
      activeThreadId,
      messages: activeThreadId ? this.state.getMessages(activeThreadId) : [],
      actions: activeThreadId ? this.state.getActions(activeThreadId) : [],
      approvalRequests: [...this.pendingApprovals.values()]
        .filter((pending) => pending.request.threadId === activeThreadId)
        .map((pending) => structuredClone(pending.request)),
      modelOptions: structuredClone(this.models),
      globalDefaults: structuredClone(state.globalDefaults),
      goals: this.state.getGoals(),
      activeActivity: structuredClone(this.activity),
    };
  }

  async getEvidence(id: string) {
    const result = await this.evidence.get(id);
    if (!result) return null;
    return {
      id: result.record.id,
      threadId: result.record.threadId,
      kind: "screenshot" as const,
      title: result.record.title,
      url: result.record.url,
      createdAt: result.record.createdAt,
      dataUrl: result.dataUrl,
    };
  }

  async dispatch(command: AgentCommand): Promise<AgentCommandResult> {
    try {
      await this.execute(command);
      this.publish();
      return { ok: true, snapshot: this.snapshot() };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "The agent command failed";
      if ("threadId" in command && typeof command.threadId === "string") {
        const thread = this.state.getThread(command.threadId);
        if (thread && ["starting", "running", "waiting-for-approval"].includes(thread.status)) {
          this.state.updateThread(command.threadId, { status: "error" });
        }
        this.browser.releaseAgentTabLocks(command.threadId);
      }
      const threadId =
        "threadId" in command && typeof command.threadId === "string"
          ? command.threadId
          : undefined;
      this.emit({ type: "agent.error", ...(threadId ? { threadId } : {}), message });
      return { ok: false, error: message, snapshot: this.snapshot() };
    }
  }

  async initialize(): Promise<void> {
    // The Codex process is intentionally lazy. Opening the browser never starts a model process.
    await this.memory.initialize();
    for (const goal of this.state.getGoals()) {
      if (goal.status === "sleeping" && goal.wakeAt) this.sleepGoal(goal.id, goal.wakeAt);
    }
  }

  async shutdown(): Promise<void> {
    for (const timer of this.goalTimers.values()) clearTimeout(timer);
    this.goalTimers.clear();
    for (const pending of this.pendingApprovals.values()) pending.resolve(false);
    this.pendingApprovals.clear();
    await this.client.stop();
    await this.evidence.flush();
    await this.state.flush();
  }

  async flush(): Promise<void> {
    await Promise.all([this.state.flush(), this.evidence.flush()]);
  }

  private async execute(command: AgentCommand): Promise<void> {
    switch (command.type) {
      case "agent.defaults.update":
        if (!isAgentPolicy(command.policy)) throw new Error("Invalid agent policy");
        this.state.updateGlobalDefaults(normalizePolicy(command.policy));
        return;
      case "agent.defaults.reset":
        this.state.updateGlobalDefaults(defaultAgentPolicy());
        return;
      case "agent.thread.create": {
        const browserState = this.browser.snapshot();
        const activeSpace = browserState.spaces.find(
          (space) => space.id === browserState.activeSpaceId,
        );
        const thread = this.state.createThread({
          ...(command.title ? { title: command.title } : {}),
          ephemeral: activeSpace?.kind === "private",
        });
        await this.ensureConnection();
        await this.ensureRemoteThread(thread.id);
        return;
      }
      case "agent.thread.select":
        this.state.setActiveThread(command.threadId);
        return;
      case "agent.thread.rename":
        this.state.updateThread(command.threadId, {
          title: command.title.trim().slice(0, 80) || "Agent thread",
        });
        return;
      case "agent.thread.delete":
        this.stopApprovals(command.threadId);
        this.browser.releaseAgentTabLocks(command.threadId);
        this.runningActionIds.delete(command.threadId);
        this.turnIds.delete(command.threadId);
        this.explicitRunStatus.delete(command.threadId);
        await this.evidence.removeForThread(command.threadId);
        this.state.removeThread(command.threadId);
        return;
      case "agent.message.send":
        await this.sendMessage(command.threadId, command.text);
        return;
      case "agent.run.pause":
        await this.interrupt(command.threadId, "paused");
        return;
      case "agent.run.stop":
        await this.interrupt(command.threadId, "stopped");
        return;
      case "agent.run.resume":
        this.explicitRunStatus.delete(command.threadId);
        await this.ensureConnection();
        await this.ensureRemoteThread(command.threadId);
        await this.sendTurn(
          command.threadId,
          [{ type: "text", text: "Continue the browser task from the last completed action." }],
          true,
        );
        return;
      case "agent.policy.update":
        if (!isAgentPolicy(command.policy)) throw new Error("Invalid agent policy");
        this.state.updateThread(command.threadId, { policy: normalizePolicy(command.policy) });
        return;
      case "agent.model.update":
        if (!this.models.some((model) => model.id === command.model))
          throw new Error("That model is not available in local Codex");
        this.state.updateThread(command.threadId, {
          model: command.model,
          reasoningEffort: command.reasoningEffort,
        });
        return;
      case "agent.approval.respond":
        this.respondToApproval(command.approvalId, command.approved);
        return;
      case "agent.goal.create": {
        if (!command.objective.trim()) throw new Error("Goal objective cannot be empty");
        const thread = this.state.getThread(command.threadId);
        if (!thread) throw new Error("Agent thread not found");
        this.state.createGoal({
          threadId: command.threadId,
          title: command.title?.trim().slice(0, 80) || safeTitle(command.objective),
          objective: command.objective.trim().slice(0, 20_000),
          status: "draft",
          endsAt: command.endsAt ?? null,
          wakeAt: null,
          maxIterations: Math.min(10_000, Math.max(1, Math.floor(command.maxIterations ?? 100))),
          allowedOrigins: thread.policy.allowedOrigins,
        });
        return;
      }
      case "agent.goal.start":
        await this.startGoal(command.goalId);
        return;
      case "agent.goal.pause":
        this.pauseGoal(command.goalId, "paused");
        return;
      case "agent.goal.stop":
        this.pauseGoal(command.goalId, "stopped");
        return;
      case "agent.goal.sleep":
        this.sleepGoal(command.goalId, command.until);
        return;
    }
  }

  private async ensureConnection(): Promise<void> {
    await this.client.start();
    this.models = this.client.availableModels
      .map(modelOption)
      .filter((model) => model.id !== "unknown");
    this.publish();
  }

  private async ensureRemoteThread(threadId: string): Promise<string> {
    const thread = this.state.getThread(threadId);
    if (!thread) throw new Error("Agent thread not found");
    if (thread.codexThreadId) {
      try {
        await this.client.request("thread/resume", {
          threadId: thread.codexThreadId,
          model: thread.model,
          sandbox: "read-only",
          excludeTurns: true,
        });
        return thread.codexThreadId;
      } catch {
        this.state.updateThread(threadId, { codexThreadId: null });
      }
    }

    const available = this.models.find((model) => model.id === thread.model);
    if (!available) throw new Error(`${thread.model} is not available in local Codex`);
    const response = await this.client.request<JsonObject>("thread/start", {
      model: thread.model,
      developerInstructions: defaultBrowserDeveloperInstructions,
      dynamicTools: [this.tools.namespace],
      sandbox: "read-only",
      approvalPolicy: "never",
      allowProviderModelFallback: false,
      ephemeral: thread.ephemeral,
      runtimeWorkspaceRoots: [],
    });
    const remoteId = extractThreadId(response);
    if (!remoteId) throw new Error("Codex did not return a thread id");
    this.state.updateThread(threadId, { codexThreadId: remoteId });
    return remoteId;
  }

  private async sendMessage(threadId: string, text: string): Promise<void> {
    const message = text.trim();
    if (!message) throw new Error("Message cannot be empty");
    if (message.length > 20_000) throw new Error("Message is too long");
    const thread = this.state.getThread(threadId);
    if (!thread) throw new Error("Agent thread not found");
    if (
      thread.status === "running" ||
      thread.status === "starting" ||
      thread.status === "waiting-for-approval"
    ) {
      throw new Error("Wait for the current agent turn to finish or stop it first");
    }

    const commandPolicy = this.parseScopeCommand(threadId, message);
    if (commandPolicy) return;

    this.state.appendMessage({ threadId, role: "user", kind: "text", text: message });
    this.state.updateThread(threadId, {
      title: thread.title === "New agent thread" ? safeTitle(message) : thread.title,
      status: "starting",
    });
    await this.ensureConnection();
    await this.ensureRemoteThread(threadId);
    await this.sendTurn(threadId, [{ type: "text", text: message }], false);
  }

  private async sendTurn(
    threadId: string,
    input: JsonObject[],
    continuation: boolean,
  ): Promise<void> {
    const thread = this.state.getThread(threadId);
    if (!thread?.codexThreadId) throw new Error("The Codex thread is not ready");
    this.state.updateThread(threadId, { status: "running" });
    this.setActivity({
      kind: "thinking",
      label: continuation ? "Continuing goal" : "Thinking",
      since: new Date().toISOString(),
    });
    const response = await this.client.request<JsonObject>("turn/start", {
      threadId: thread.codexThreadId,
      input,
      model: thread.model,
      effort: thread.reasoningEffort,
      ...(continuation
        ? {
            additionalContext:
              "The user resumed this browser task after a pause. Continue using the existing browser state.",
          }
        : {}),
    });
    const turn = objectValue(response.turn);
    const turnId = stringValue(turn.id);
    if (turnId) this.turnIds.set(threadId, turnId);
  }

  private async interrupt(threadId: string, status: "paused" | "stopped"): Promise<void> {
    const thread = this.state.getThread(threadId);
    if (!thread?.codexThreadId) {
      this.state.updateThread(threadId, { status });
      this.stopApprovals(threadId);
      return;
    }
    const turnId = this.turnIds.get(threadId);
    this.explicitRunStatus.set(threadId, status);
    this.stopApprovals(threadId);
    if (turnId)
      await this.client.request("turn/interrupt", { threadId: thread.codexThreadId, turnId });
    this.state.updateThread(threadId, { status });
    this.browser.releaseAgentTabLocks(threadId);
    this.setActivity({
      kind: status === "paused" ? "paused" : "idle",
      label: status === "paused" ? "Paused" : "Ready",
    });
  }

  private async handleServerRequest(request: CodexServerRequest): Promise<JsonValue> {
    if (request.method !== "item/tool/call")
      throw new Error("Only browser dynamic tools are permitted");
    const params = objectValue(request.params);
    const remoteThreadId = stringValue(params.threadId);
    const thread = this.state
      .getThreads()
      .find((candidate) => candidate.codexThreadId === remoteThreadId);
    if (!thread) throw new Error("Unknown Codex thread");
    return this.tools.execute(thread.id, thread.policy, request, {
      requestApproval: (input) => this.requestApproval(thread.id, input),
      onAction: (input) => this.recordAction(thread.id, input),
      onEvidence: (input) => {
        void this.saveEvidence(thread.id, input);
      },
    });
  }

  private async saveEvidence(
    threadId: string,
    input: { tabId: string; spaceId: string; title: string; url: string; dataUrl: string },
  ): Promise<void> {
    const thread = this.state.getThread(threadId);
    if (!thread || thread.ephemeral) return;
    const record = await this.evidence.save({
      threadId,
      title: input.title,
      url: input.url,
      dataUrl: input.dataUrl,
    });
    if (!record) return;
    this.state.appendMessage({
      threadId,
      role: "tool",
      kind: "action",
      text: "Screenshot evidence captured",
      evidenceIds: [record.id],
    });
    this.emit({
      type: "agent.evidence",
      evidence: {
        id: record.id,
        threadId: record.threadId,
        kind: "screenshot",
        title: record.title,
        url: record.url,
        createdAt: record.createdAt,
      },
    });
    this.publish();
  }

  private async requestApproval(
    threadId: string,
    input: {
      actionClass: AgentApprovalRequest["actionClass"];
      summary: string;
      spaceId?: string;
      tabId?: string;
    },
  ): Promise<boolean> {
    const request: AgentApprovalRequest = {
      id: randomUUID(),
      threadId,
      actionClass: input.actionClass,
      summary: input.summary,
      ...(input.spaceId ? { spaceId: input.spaceId } : {}),
      ...(input.tabId ? { tabId: input.tabId } : {}),
      createdAt: new Date().toISOString(),
    };
    this.state.updateThread(threadId, { status: "waiting-for-approval" });
    this.setActivity({
      kind: "approval",
      label: "Waiting for approval",
      since: new Date().toISOString(),
    });
    this.pendingApprovals.set(request.id, { request, resolve: () => undefined });
    const result = await new Promise<boolean>((resolve) => {
      const pending = this.pendingApprovals.get(request.id);
      if (pending) pending.resolve = resolve;
    });
    this.pendingApprovals.delete(request.id);
    if (this.state.getThread(threadId)?.status === "waiting-for-approval")
      this.state.updateThread(threadId, { status: "running" });
    return result;
  }

  private respondToApproval(approvalId: string, approved: boolean): void {
    this.pendingApprovals.get(approvalId)?.resolve(approved);
  }

  private stopApprovals(threadId: string): void {
    for (const [id, pending] of this.pendingApprovals) {
      if (pending.request.threadId !== threadId) continue;
      pending.resolve(false);
      this.pendingApprovals.delete(id);
    }
  }

  private recordAction(
    threadId: string,
    input: {
      toolName: string;
      actionClass: AgentApprovalRequest["actionClass"];
      spaceId?: string;
      tabId?: string;
      summary: string;
      status: "running" | "succeeded" | "failed" | "denied";
    },
  ): void {
    let actionId = this.runningActionIds.get(threadId);
    if (input.status === "running" || !actionId) {
      actionId = randomUUID();
      this.runningActionIds.set(threadId, actionId);
    }
    const previous = this.state.getActions(threadId).find((action) => action.id === actionId);
    const action = {
      id: actionId,
      threadId,
      toolName: input.toolName,
      actionClass: input.actionClass,
      ...(input.spaceId ? { spaceId: input.spaceId } : {}),
      ...(input.tabId ? { tabId: input.tabId } : {}),
      summary: input.summary,
      status: input.status,
      startedAt: previous?.startedAt ?? new Date().toISOString(),
      ...(input.status !== "running" ? { completedAt: new Date().toISOString() } : {}),
    } as const;
    this.state.upsertAction(action);
    if (input.status === "running")
      this.setActivity({
        kind: "browser",
        label: input.summary,
        since: action.startedAt,
        ...(input.tabId ? { tabId: input.tabId } : {}),
      });
    if (input.tabId && input.actionClass !== "read")
      this.browser.setAgentTabLock(input.tabId, threadId, input.status === "running");
    this.emit({ type: "agent.action", action });
    if (input.status !== "running") this.runningActionIds.delete(threadId);
    this.publish();
  }

  private handleNotification(notification: JsonRpcNotification): void {
    const params = objectValue(notification.params);
    const remoteThreadId = stringValue(params.threadId);
    const thread = remoteThreadId
      ? this.state.getThreads().find((candidate) => candidate.codexThreadId === remoteThreadId)
      : undefined;
    if (!thread) return;

    if (notification.method === "item/agentMessage/delta") {
      const itemId = stringValue(params.itemId) ?? randomUUID();
      const key = `${thread.id}:${itemId}`;
      const messageId = this.assistantMessageIds.get(key) ?? `${thread.id}:${itemId}`;
      const delta = stringValue(params.delta) ?? "";
      this.assistantMessageIds.set(key, messageId);
      const existing = this.state
        .getMessages(thread.id)
        .find((message) => message.id === messageId);
      if (existing) this.state.replaceMessage(messageId, `${existing.text}${delta}`);
      else
        this.state.appendMessage({
          id: messageId,
          threadId: thread.id,
          role: "assistant",
          kind: "text",
          text: delta,
        });
      this.emit({ type: "agent.message.delta", threadId: thread.id, messageId, delta });
      this.publish();
      return;
    }

    if (notification.method === "turn/started") {
      const turn = objectValue(params.turn);
      const turnId = stringValue(turn.id);
      if (turnId) this.turnIds.set(thread.id, turnId);
      this.state.updateThread(thread.id, { status: "running" });
      this.setActivity({ kind: "thinking", label: "Thinking", since: new Date().toISOString() });
      this.publish();
      return;
    }

    if (notification.method === "turn/completed") {
      const override = this.explicitRunStatus.get(thread.id);
      const turn = objectValue(params.turn);
      const status = stringValue(turn.status);
      const next =
        override ??
        (status === "interrupted"
          ? "stopped"
          : status === "failed" || status === "error"
            ? "error"
            : "completed");
      this.explicitRunStatus.delete(thread.id);
      this.turnIds.delete(thread.id);
      this.stopApprovals(thread.id);
      this.state.updateThread(thread.id, { status: next });
      this.browser.releaseAgentTabLocks(thread.id);
      this.setActivity({
        kind: next === "completed" ? "completed" : next === "error" ? "error" : "paused",
        label: next === "completed" ? "Finished" : next === "error" ? "Run failed" : "Paused",
      });
      void this.advanceGoals(thread.id, next);
      this.publish();
      return;
    }

    if (notification.method === "error") {
      const message = stringValue(params.message) ?? "Codex reported an error";
      this.state.updateThread(thread.id, { status: "error" });
      this.browser.releaseAgentTabLocks(thread.id);
      this.state.appendMessage({
        threadId: thread.id,
        role: "system",
        kind: "error",
        text: message.slice(0, 500),
      });
      this.emit({ type: "agent.error", threadId: thread.id, message: message.slice(0, 500) });
      this.publish();
    }
  }

  private parseScopeCommand(threadId: string, message: string): boolean {
    const parts = message.trim().split(/\s+/);
    const command = parts[0]?.toLowerCase();
    if (!command || !["/scope", "/allow", "/deny"].includes(command)) return false;
    const commandToken = parts[0];
    if (!commandToken) return false;
    const thread = this.state.getThread(threadId);
    if (!thread) throw new Error("Agent thread not found");
    const policy = normalizePolicy(thread.policy);
    if (command === "/scope") {
      const entries = message.slice(commandToken.length).trim().split(/\s+/).filter(Boolean);
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index] ?? "";
        const [key, inlineRaw] = entry.split("=", 2);
        const raw = inlineRaw ?? (entries[index + 1]?.includes("=") ? undefined : entries[++index]);
        const values =
          raw
            ?.split(",")
            .map((value) => value.trim())
            .filter(Boolean) ?? [];
        if (!raw) throw new Error("Scope values are required for spaces, tabs, and origins");
        if (key === "spaces") policy.allowedSpaceIds = values;
        else if (key === "tabs") policy.allowedTabIds = values;
        else if (key === "origins") policy.allowedOrigins = values;
        else throw new Error("Scope supports spaces=, tabs=, and origins=");
      }
    } else {
      const aliases: Record<string, AgentPolicy["allowedActions"][number]> = {
        read: "read",
        navigate: "navigate",
        tabs: "tab-management",
        "tab-management": "tab-management",
        interact: "page-interaction",
        "page-interaction": "page-interaction",
        credential: "credential-fill",
        "credential-fill": "credential-fill",
        submit: "form-submit",
        "form-submit": "form-submit",
        external: "external-side-effect",
        "external-side-effect": "external-side-effect",
        destructive: "destructive",
      };
      const rawValues = message
        .slice(commandToken.length)
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean);
      const values = rawValues
        .map((value) => aliases[value.toLowerCase()])
        .filter((value): value is AgentPolicy["allowedActions"][number] => Boolean(value));
      if (values.length !== rawValues.length) throw new Error("Unknown action in policy command");
      const set = new Set(policy.allowedActions);
      for (const value of values) command === "/allow" ? set.add(value) : set.delete(value);
      policy.allowedActions = [...set];
    }
    this.state.updateThread(threadId, { policy });
    this.state.appendMessage({
      threadId,
      role: "system",
      kind: "status",
      text: "Thread policy updated",
    });
    return true;
  }

  private publish(): void {
    this.emit({ type: "agent.snapshot", snapshot: this.snapshot() });
  }

  private setActivity(activity: AgentActivity): void {
    this.activity = activity;
    this.publish();
  }

  private async startGoal(goalId: string): Promise<void> {
    const goal = this.state.getGoal(goalId);
    if (!goal) throw new Error("Agent goal not found");
    if (goal.status === "completed" || goal.status === "stopped")
      throw new Error("This goal cannot be resumed");
    if (goal.endsAt && Date.parse(goal.endsAt) <= Date.now()) {
      this.state.updateGoal(goalId, { status: "completed" });
      return;
    }
    const thread = this.state.getThread(goal.threadId);
    if (!thread) throw new Error("The goal thread no longer exists");
    this.state.updateGoal(goalId, { status: "running", wakeAt: null });
    await this.ensureConnection();
    await this.ensureRemoteThread(goal.threadId);
    await this.sendTurn(
      goal.threadId,
      [
        {
          type: "text",
          text: `Goal checkpoint ${goal.iteration + 1}/${goal.maxIterations}: ${goal.objective}. Continue only with allowed, policy-compliant browser actions. Report a concise checkpoint when this iteration is complete.`,
        },
      ],
      true,
    );
  }

  private pauseGoal(goalId: string, status: "paused" | "stopped"): void {
    const goal = this.state.getGoal(goalId);
    if (!goal) throw new Error("Agent goal not found");
    const timer = this.goalTimers.get(goalId);
    if (timer) clearTimeout(timer);
    this.goalTimers.delete(goalId);
    this.state.updateGoal(goalId, { status, wakeAt: null });
    if (goal.status === "running")
      void this.interrupt(goal.threadId, status === "paused" ? "paused" : "stopped");
  }

  private sleepGoal(goalId: string, until: string): void {
    const timestamp = Date.parse(until);
    if (!Number.isFinite(timestamp) || timestamp <= Date.now())
      throw new Error("Sleep time must be a future ISO timestamp");
    const goal = this.state.getGoal(goalId);
    if (!goal) throw new Error("Agent goal not found");
    const timer = this.goalTimers.get(goalId);
    if (timer) clearTimeout(timer);
    this.state.updateGoal(goalId, {
      status: "sleeping",
      wakeAt: new Date(timestamp).toISOString(),
    });
    this.setActivity({
      kind: "sleeping",
      label: "Sleeping until wake time",
      until: new Date(timestamp).toISOString(),
    });
    this.goalTimers.set(
      goalId,
      setTimeout(
        () => {
          this.goalTimers.delete(goalId);
          void this.startGoal(goalId).catch((error: unknown) =>
            this.emit({
              type: "agent.error",
              threadId: goal.threadId,
              message: error instanceof Error ? error.message : "Goal wake failed",
            }),
          );
        },
        Math.min(timestamp - Date.now(), 2_147_000_000),
      ),
    );
  }

  private async advanceGoals(threadId: string, runStatus: string): Promise<void> {
    const goal = this.state
      .getGoals()
      .find((candidate) => candidate.threadId === threadId && candidate.status === "running");
    if (!goal) return;
    const nextIteration = goal.iteration + 1;
    this.state.updateGoal(goal.id, {
      iteration: nextIteration,
      lastCheckpoint: new Date().toISOString(),
      lastAction: this.state.getActions(threadId).at(-1)?.summary ?? null,
    });
    await this.memory.compact(
      threadId,
      this.state.getMessages(threadId),
      this.state.getActions(threadId),
    );
    if (
      runStatus !== "completed" ||
      nextIteration >= goal.maxIterations ||
      (goal.endsAt && Date.parse(goal.endsAt) <= Date.now())
    ) {
      this.state.updateGoal(goal.id, { status: runStatus === "completed" ? "completed" : "error" });
      return;
    }
    await this.startGoal(goal.id);
  }
}
