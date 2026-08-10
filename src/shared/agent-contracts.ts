export type AgentMode = "full" | "guided" | "observe";

export type AgentActionClass =
  | "read"
  | "navigate"
  | "tab-management"
  | "page-interaction"
  | "credential-fill"
  | "form-submit"
  | "external-side-effect"
  | "destructive";

export type AgentPolicy = {
  mode: AgentMode;
  allowedSpaceIds: string[] | null;
  allowedTabIds: string[] | null;
  allowedOrigins: string[] | null;
  allowedActions: AgentActionClass[];
  allowVault: boolean;
  allowPrivate: boolean;
  maxTabs: number;
};

export type AgentRunStatus =
  | "idle"
  | "starting"
  | "running"
  | "paused"
  | "waiting-for-approval"
  | "completed"
  | "stopped"
  | "error";

export type AgentThread = {
  id: string;
  title: string;
  model: string;
  reasoningEffort: "low" | "medium" | "high";
  policy: AgentPolicy;
  status: AgentRunStatus;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
};

export type AgentMessage = {
  id: string;
  threadId: string;
  role: "user" | "assistant" | "tool" | "system";
  kind: "text" | "action" | "status" | "approval" | "error";
  text: string;
  createdAt: string;
  evidenceIds?: string[];
};

export type AgentActionTrace = {
  id: string;
  threadId: string;
  toolName: string;
  actionClass: AgentActionClass;
  spaceId?: string;
  tabId?: string;
  summary: string;
  status: "queued" | "running" | "succeeded" | "failed" | "denied" | "interrupted";
  startedAt: string;
  completedAt?: string;
  error?: string;
  evidenceIds?: string[];
};

export type AgentApprovalRequest = {
  id: string;
  threadId: string;
  actionClass: AgentActionClass;
  summary: string;
  spaceId?: string;
  tabId?: string;
  createdAt: string;
};

export type AgentEvidence = {
  id: string;
  threadId: string;
  kind: "screenshot";
  title: string;
  url: string;
  createdAt: string;
  dataUrl: string;
};

export type AgentConnection =
  | { status: "stopped" }
  | { status: "starting" | "ready" | "unauthenticated" | "missing" | "crashed"; message?: string };

export type AgentModelOption = {
  id: string;
  name: string;
  reasoningEfforts: string[];
};

export type AgentSnapshot = {
  connection: AgentConnection;
  threads: AgentThread[];
  activeThreadId: string | null;
  messages: AgentMessage[];
  actions: AgentActionTrace[];
  approvalRequests: AgentApprovalRequest[];
  modelOptions: AgentModelOption[];
  globalDefaults: AgentPolicy;
};

export type AgentCommand =
  | { type: "agent.thread.create"; title?: string }
  | { type: "agent.thread.select"; threadId: string }
  | { type: "agent.thread.rename"; threadId: string; title: string }
  | { type: "agent.thread.delete"; threadId: string }
  | { type: "agent.message.send"; threadId: string; text: string }
  | { type: "agent.run.pause"; threadId: string }
  | { type: "agent.run.resume"; threadId: string }
  | { type: "agent.run.stop"; threadId: string }
  | { type: "agent.policy.update"; threadId: string; policy: AgentPolicy }
  | {
      type: "agent.model.update";
      threadId: string;
      model: string;
      reasoningEffort: "low" | "medium" | "high";
    }
  | { type: "agent.approval.respond"; threadId: string; approvalId: string; approved: boolean };

export type AgentCommandResult =
  | { ok: true; snapshot: AgentSnapshot }
  | { ok: false; error: string; snapshot: AgentSnapshot };

export type AgentEvent =
  | { type: "agent.snapshot"; snapshot: AgentSnapshot }
  | { type: "agent.message.delta"; threadId: string; messageId: string; delta: string }
  | { type: "agent.action"; action: AgentActionTrace }
  | { type: "agent.approval-request"; request: AgentApprovalRequest }
  | { type: "agent.connection"; connection: AgentConnection }
  | { type: "agent.evidence"; evidence: Omit<AgentEvidence, "dataUrl"> }
  | { type: "agent.error"; threadId?: string; message: string };

export type AgentAPI = {
  getSnapshot: () => Promise<AgentSnapshot>;
  dispatch: (command: AgentCommand) => Promise<AgentCommandResult>;
  getEvidence: (id: string) => Promise<AgentEvidence | null>;
  subscribe: (listener: (event: AgentEvent) => void) => () => void;
};

export type AgentPersistedThread = AgentThread & {
  codexThreadId: string | null;
  ephemeral: boolean;
};

export type AgentPersistedState = {
  version: 1;
  threads: AgentPersistedThread[];
  messages: AgentMessage[];
  actions: AgentActionTrace[];
  activeThreadId: string | null;
  globalDefaults: AgentPolicy;
};

export type BrowserPageElement = {
  ref: string;
  role: string;
  tag: string;
  label: string;
  placeholder?: string;
  valueKind?: "empty" | "filled" | "checked" | "unchecked";
  disabled?: boolean;
};

export type BrowserPageContext = {
  snapshotId: string;
  url: string;
  title: string;
  text: string;
  headings: string[];
  elements: BrowserPageElement[];
  scroll: {
    x: number;
    y: number;
    width: number;
    height: number;
    viewportWidth: number;
    viewportHeight: number;
  };
  sensitiveRects: Array<{ x: number; y: number; width: number; height: number }>;
  captchaWidgets: Array<{
    kind: "recaptcha" | "hcaptcha" | "captcha";
    rect: { x: number; y: number; width: number; height: number };
    interaction: "checkbox-or-challenge";
  }>;
};

export type BrowserPageRequest =
  | { requestId: string; type: "context" }
  | { requestId: string; type: "click"; snapshotId: string; ref?: string; x?: number; y?: number }
  | {
      requestId: string;
      type: "type";
      snapshotId: string;
      ref: string;
      text: string;
      replace: boolean;
    }
  | {
      requestId: string;
      type: "select";
      snapshotId: string;
      ref: string;
      value?: string;
      label?: string;
    }
  | { requestId: string; type: "press"; snapshotId: string; ref?: string; key: string }
  | { requestId: string; type: "scroll"; snapshotId: string; ref?: string; x: number; y: number }
  | { requestId: string; type: "submit"; snapshotId: string; ref: string }
  | { requestId: string; type: "redact"; snapshotId: string; enabled: boolean };

export type BrowserPageResponse = {
  requestId: string;
  ok: boolean;
  context?: BrowserPageContext;
  result?: JsonObject;
  error?: string;
};

export type BrowserPageRequestInput = {
  [K in BrowserPageRequest["type"]]: Omit<Extract<BrowserPageRequest, { type: K }>, "requestId">;
}[BrowserPageRequest["type"]];

import type { JsonObject } from "./json";
