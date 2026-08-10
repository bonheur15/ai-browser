import type { Tab } from "../shared/contracts";
import type {
  AgentActionClass,
  AgentPolicy,
  BrowserPageContext,
  BrowserPageRequest,
  BrowserPageRequestInput,
} from "../shared/agent-contracts";
import type { CodexServerRequest, DynamicToolNamespace, JsonObject } from "./codex-protocol";
import { browserDynamicTools } from "./codex-app-server-client";
import { AgentPolicyEngine, type PolicyDecision } from "./agent-policy";
import { BrowserRuntime } from "../main/browser-runtime";

type ToolContentItem =
  | { type: "inputText"; text: string }
  | { type: "inputImage"; imageUrl: string };

export type BrowserToolResponse = {
  success: boolean;
  contentItems: ToolContentItem[];
};

export type BrowserAgentCallbacks = {
  requestApproval: (input: { actionClass: AgentActionClass; summary: string; spaceId?: string; tabId?: string }) => Promise<boolean>;
  onAction: (input: { toolName: string; actionClass: AgentActionClass; spaceId?: string; tabId?: string; summary: string; status: "running" | "succeeded" | "failed" | "denied" }) => void;
};

const text = (value: unknown, name: string, max = 2_000): string => {
  if (typeof value !== "string") throw new Error(`${name} must be text`);
  const result = value.trim();
  if (!result && name !== "url") throw new Error(`${name} cannot be empty`);
  return result.slice(0, max);
};

const optionalText = (value: unknown, name: string, max = 2_000): string | undefined => {
  if (value === undefined || value === null) return undefined;
  return text(value, name, max);
};

const numberValue = (value: unknown, name: string, min: number, max: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return Math.max(min, Math.min(max, value));
};

const objectValue = (value: unknown): JsonObject => {
  if (typeof value === "string") {
    try {
      return objectValue(JSON.parse(value));
    } catch {
      throw new Error("Tool arguments are not valid JSON");
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Tool arguments must be an object");
  return value as JsonObject;
};

const httpOrigin = (value: string): string | null => {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
};

const destinationOrigin = (value: string): string => httpOrigin(value) ?? "https://www.google.com";

const success = (...items: ToolContentItem[]): BrowserToolResponse => ({ success: true, contentItems: items });
const failure = (message: string): BrowserToolResponse => ({ success: false, contentItems: [{ type: "inputText", text: `Browser action denied or failed: ${message}` }] });

export class BrowserAgentTools {
  readonly namespace: DynamicToolNamespace;

  constructor(
    private readonly browser: BrowserRuntime,
    private readonly policies: AgentPolicyEngine,
  ) {
    this.namespace = browserDynamicTools(toolDefinitions);
  }

  actionClass(toolName: string): AgentActionClass {
    const normalized = toolName.replace(/^browser\./, "");
    return actionClasses[normalized] ?? "read";
  }

  async execute(threadId: string, policy: AgentPolicy, request: CodexServerRequest, callbacks: BrowserAgentCallbacks): Promise<BrowserToolResponse> {
    const toolName = request.method === "item/tool/call" && typeof request.params?.tool === "string" ? request.params.tool : "";
    const normalized = toolName.replace(/^browser\./, "");
    const actionClass = this.actionClass(toolName);
    const args = objectValue(request.params?.arguments ?? {});
    let target: { tab?: Tab; spaceId?: string; url?: string } = {};
    let summary = normalized.replace(/_/g, " ");
    try {
      target = this.resolveTarget(args);
      const decision = this.policyDecision(policy, actionClass, target);
      if (!decision.allowed) {
        callbacks.onAction({ toolName: normalized, actionClass, ...target, summary: decision.reason, status: "denied" });
        return failure(decision.reason);
      }

      summary = this.summary(normalized, args, target);
      callbacks.onAction({ toolName: normalized, actionClass, ...target, summary, status: "running" });
      if (this.policies.requiresApproval(policy, actionClass)) {
        const approved = await callbacks.requestApproval({ actionClass, summary, spaceId: target.spaceId, tabId: target.tab?.id });
        if (!approved) {
          callbacks.onAction({ toolName: normalized, actionClass, ...target, summary, status: "denied" });
          return failure("The user did not approve this action");
        }
      }

      const result = await this.run(normalized, args, policy, target);
      callbacks.onAction({ toolName: normalized, actionClass, ...target, summary, status: result.success ? "succeeded" : "failed" });
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "The browser action failed";
      callbacks.onAction({ toolName: normalized || "unknown", actionClass, ...target, summary, status: "failed" });
      return failure(message);
    }
  }

  private async run(normalized: string, args: JsonObject, policy: AgentPolicy, target: { tab?: Tab; spaceId?: string; url?: string }): Promise<BrowserToolResponse> {
    switch (normalized) {
      case "list_spaces": {
        const snapshot = this.browser.snapshot();
        const spaces = snapshot.spaces
          .filter((space) => space.kind !== "private" || policy.allowPrivate)
          .filter((space) => !policy.allowedSpaceIds || policy.allowedSpaceIds.includes(space.id))
          .map((space) => ({ id: space.id, name: space.name, color: space.color, kind: space.kind }));
        return success({ type: "inputText", text: JSON.stringify({ spaces }) });
      }
      case "list_tabs": {
        const snapshot = this.browser.snapshot();
        const tabs = snapshot.tabs
          .filter((tab) => !policy.allowedTabIds || policy.allowedTabIds.includes(tab.id))
          .map((tab) => ({ tab, space: snapshot.spaces.find((space) => space.id === tab.spaceId) }))
          .filter((entry): entry is { tab: Tab; space: NonNullable<typeof entry.space> } => Boolean(entry.space))
          .filter(({ tab, space }) => space.kind !== "private" || policy.allowPrivate)
          .filter(({ tab }) => !policy.allowedSpaceIds || policy.allowedSpaceIds.includes(tab.spaceId))
          .filter(({ tab }) => this.policies.originAllowed(policy.allowedOrigins, tab.url))
          .map(({ tab, space }) => ({ id: tab.id, spaceId: tab.spaceId, spaceName: space.name, title: tab.title, url: tab.url, status: tab.status }));
        return success({ type: "inputText", text: JSON.stringify({ tabs }) });
      }
      case "create_tab": {
        const spaceId = text(args.spaceId, "spaceId", 120);
        const url = optionalText(args.url, "url", 4_000) ?? "about:blank";
        const space = this.browser.getAgentSpace(spaceId);
        const canCreate = this.policies.canCreateTab(policy, space);
        if (!canCreate.allowed) return failure(canCreate.reason);
        if (!this.policies.originAllowed(policy.allowedOrigins, destinationOrigin(url))) return failure("The new tab origin is outside the thread's scope");
        const tab = await this.browser.agentCreateTab(spaceId, url);
        return success({ type: "inputText", text: JSON.stringify({ tab: this.tabSummary(tab, space.name) }) });
      }
      case "close_tab":
        await this.browser.agentCloseTab(this.requireTab(target).id);
        return success({ type: "inputText", text: "Tab closed" });
      case "activate_tab":
        await this.browser.agentActivateTab(this.requireTab(target).id);
        return success({ type: "inputText", text: "Tab activated" });
      case "clone_tab": {
        const tab = this.requireTab(target);
        const spaceId = text(args.spaceId, "spaceId", 120);
        const space = this.browser.getAgentSpace(spaceId);
        const canCreate = this.policies.canCreateTab(policy, space);
        if (!canCreate.allowed) return failure(canCreate.reason);
        if (!this.policies.originAllowed(policy.allowedOrigins, tab.url)) return failure("The source tab origin is outside the thread's scope");
        const created = await this.browser.agentCloneTab(tab.id, spaceId);
        return success({ type: "inputText", text: JSON.stringify({ tab: this.tabSummary(created, space.name), loginStateTransferred: false }) });
      }
      case "move_tab": {
        const tab = this.requireTab(target);
        const spaceId = text(args.spaceId, "spaceId", 120);
        const space = this.browser.getAgentSpace(spaceId);
        const canCreate = this.policies.canCreateTab(policy, space);
        if (!canCreate.allowed) return failure(canCreate.reason);
        if (!this.policies.originAllowed(policy.allowedOrigins, tab.url)) return failure("The source tab origin is outside the thread's scope");
        const created = await this.browser.agentMoveTab(tab.id, spaceId);
        return success({ type: "inputText", text: JSON.stringify({ tab: this.tabSummary(created, space.name), loginStateTransferred: false }) });
      }
      case "navigate": {
        const tab = this.requireTab(target);
        const input = text(args.input, "input", 4_000);
        if (!this.policies.originAllowed(policy.allowedOrigins, destinationOrigin(input))) return failure("The destination origin is outside the thread's scope");
        await this.browser.agentNavigate(tab.id, input);
        return success({ type: "inputText", text: `Navigating ${destinationOrigin(input)}` });
      }
      case "back":
        await this.browser.agentBack(this.requireTab(target).id);
        return success({ type: "inputText", text: "Navigated back" });
      case "forward":
        await this.browser.agentForward(this.requireTab(target).id);
        return success({ type: "inputText", text: "Navigated forward" });
      case "reload":
        await this.browser.agentReload(this.requireTab(target).id);
        return success({ type: "inputText", text: "Reloaded the page" });
      case "get_page_context": {
        const context = await this.browser.agentPageContext(this.requireTab(target).id);
        return success({ type: "inputText", text: JSON.stringify(context) });
      }
      case "capture_screenshot": {
        const screenshot = await this.browser.agentCaptureScreenshot(this.requireTab(target).id);
        return success(
          { type: "inputText", text: `Screenshot captured for ${screenshot.title || screenshot.url}` },
          { type: "inputImage", imageUrl: screenshot.dataUrl },
        );
      }
      case "scroll": {
        const tab = this.requireTab(target);
        const context = await this.browser.agentPageContext(tab.id);
        const response = await this.browser.agentPageRequest(tab.id, {
          type: "scroll",
          snapshotId: context.snapshotId,
          ref: optionalText(args.ref, "ref", 80),
          x: numberValue(args.x ?? 0, "x", -2_000, 2_000),
          y: numberValue(args.y ?? 600, "y", -2_000, 2_000),
        });
        return response.ok ? success({ type: "inputText", text: JSON.stringify(response.result ?? {}) }) : failure(response.error ?? "Unable to scroll");
      }
      case "click":
      case "type":
      case "select":
      case "press_key":
      case "submit_form":
        return this.runPageMutation(normalized, args, policy, this.requireTab(target));
      case "list_credentials": {
        if (!policy.allowVault) return failure("Vault access is disabled for this thread");
        const tab = target.tab;
        const origin = tab ? httpOrigin(tab.url) ?? undefined : optionalText(args.origin, "origin", 500);
        const spaceId = target.spaceId ?? optionalText(args.spaceId, "spaceId", 120);
        if (!spaceId) return failure("A Space is required to list credentials");
        const credentials = this.browser.listAgentCredentials(spaceId, origin);
        return success({ type: "inputText", text: JSON.stringify({ credentials: credentials.map(({ id, hostname, origin: credentialOrigin, username }) => ({ id, hostname, origin: credentialOrigin, username })) }) });
      }
      case "fill_credential": {
        if (!policy.allowVault) return failure("Vault access is disabled for this thread");
        const tab = this.requireTab(target);
        const credentialId = text(args.credentialId, "credentialId", 120);
        const credential = this.browser.listAgentCredentials(tab.spaceId).find((candidate) => candidate.id === credentialId);
        if (!credential || credential.origin !== httpOrigin(tab.url)) return failure("That credential does not belong to the active page");
        const ok = await this.browser.agentFillCredential(credentialId, tab.id);
        return ok ? success({ type: "inputText", text: "Credential filled locally; the password was not returned" }) : failure("The page did not expose a compatible login form");
      }
      default:
        return failure(`Unknown browser tool: ${normalized}`);
    }
  }

  private async runPageMutation(normalized: string, args: JsonObject, _policy: AgentPolicy, tab: Tab): Promise<BrowserToolResponse> {
    const context = await this.browser.agentPageContext(tab.id);
    let request: BrowserPageRequestInput;
    if (normalized === "click") {
      const ref = optionalText(args.ref, "ref", 80);
      const hasCoordinates = typeof args.x === "number" && typeof args.y === "number";
      if (!ref && !hasCoordinates) throw new Error("click requires an element ref or screenshot coordinates");
      request = { type: "click", snapshotId: context.snapshotId, ref, ...(hasCoordinates ? { x: numberValue(args.x, "x", 0, context.scroll.viewportWidth), y: numberValue(args.y, "y", 0, context.scroll.viewportHeight) } : {}) };
    } else if (normalized === "type") {
      request = { type: "type", snapshotId: context.snapshotId, ref: text(args.ref, "ref", 80), text: text(args.text, "text", 20_000), replace: args.replace !== false };
    } else if (normalized === "select") {
      request = { type: "select", snapshotId: context.snapshotId, ref: text(args.ref, "ref", 80), value: optionalText(args.value, "value", 1_000), label: optionalText(args.label, "label", 1_000) };
    } else if (normalized === "press_key") {
      request = { type: "press", snapshotId: context.snapshotId, ref: optionalText(args.ref, "ref", 80), key: text(args.key, "key", 40) };
    } else {
      request = { type: "submit", snapshotId: context.snapshotId, ref: text(args.ref, "ref", 80) };
    }
    const response = await this.browser.agentPageRequest(tab.id, request);
    return response.ok ? success({ type: "inputText", text: JSON.stringify(response.result ?? {}) }) : failure(response.error ?? "The page action failed");
  }

  private resolveTarget(args: JsonObject): { tab?: Tab; spaceId?: string; url?: string } {
    const tabId = optionalText(args.tabId, "tabId", 120);
    const spaceId = optionalText(args.spaceId, "spaceId", 120);
    const url = optionalText(args.url, "url", 4_000) ?? optionalText(args.input, "input", 4_000);
    const tab = tabId ? this.browser.getAgentTab(tabId) : undefined;
    return { tab, spaceId: spaceId ?? tab?.spaceId, url };
  }

  private policyDecision(policy: AgentPolicy, actionClass: AgentActionClass, target: { tab?: Tab; spaceId?: string; url?: string }): PolicyDecision {
    const space = target.spaceId ? this.browser.getAgentSpace(target.spaceId) : target.tab ? this.browser.getAgentSpace(target.tab.spaceId) : undefined;
    const policyUrl = target.url ? (httpOrigin(target.url) ?? "https://www.google.com") : target.tab?.url;
    return this.policies.decide(policy, actionClass, { space, tab: target.tab, url: policyUrl });
  }

  private requireTab(target: { tab?: Tab }): Tab {
    if (!target.tab) throw new Error("A valid tabId is required");
    return target.tab;
  }

  private tabSummary(tab: Tab, spaceName: string): Record<string, unknown> {
    return { id: tab.id, spaceId: tab.spaceId, spaceName, title: tab.title, url: tab.url, status: tab.status };
  }

  private summary(tool: string, args: JsonObject, target: { tab?: Tab; spaceId?: string }): string {
    const location = target.tab ? ` on ${target.tab.title || target.tab.url}` : target.spaceId ? ` in Space ${target.spaceId}` : "";
    if (tool === "type") return `Type ${String(args.text ?? "").length} characters${location}`;
    if (tool === "navigate") return `Navigate ${destinationOrigin(String(args.input ?? ""))}${location}`;
    if (tool === "fill_credential") return `Fill saved credential${location}`;
    if (tool === "submit_form") return `Submit form${location}`;
    return `${tool.replace(/_/g, " ")}${location}`;
  }
}

const actionClasses: Record<string, AgentActionClass> = {
  list_spaces: "read",
  list_tabs: "read",
  get_page_context: "read",
  capture_screenshot: "read",
  list_credentials: "read",
  create_tab: "tab-management",
  close_tab: "destructive",
  activate_tab: "tab-management",
  clone_tab: "tab-management",
  move_tab: "tab-management",
  navigate: "navigate",
  back: "navigate",
  forward: "navigate",
  reload: "navigate",
  scroll: "page-interaction",
  click: "page-interaction",
  type: "page-interaction",
  select: "page-interaction",
  press_key: "page-interaction",
  submit_form: "form-submit",
  fill_credential: "credential-fill",
};

const stringSchema = (description: string, maxLength?: number): JsonObject => ({ type: "string", description, ...(maxLength ? { maxLength } : {}) });
const objectSchema = (properties: JsonObject, required: string[] = []): JsonObject => ({ type: "object", properties, required, additionalProperties: false });

const toolDefinitions = [
  { name: "list_spaces", description: "List Spaces available to this thread.", inputSchema: objectSchema({}) },
  { name: "list_tabs", description: "List tabs available to this thread, including their Space and URL.", inputSchema: objectSchema({}) },
  { name: "create_tab", description: "Create a tab in a specific Space. Use an HTTP(S) URL or search text.", inputSchema: objectSchema({ spaceId: stringSchema("Destination Space id"), url: stringSchema("HTTP(S) URL or search text", 4_000) }, ["spaceId"]) },
  { name: "close_tab", description: "Close a tab.", inputSchema: objectSchema({ tabId: stringSchema("Tab id") }, ["tabId"]) },
  { name: "activate_tab", description: "Make a tab visible to the user.", inputSchema: objectSchema({ tabId: stringSchema("Tab id") }, ["tabId"]) },
  { name: "clone_tab", description: "Clone a tab URL into another Space without transferring login state.", inputSchema: objectSchema({ tabId: stringSchema("Source tab id"), spaceId: stringSchema("Destination Space id") }, ["tabId", "spaceId"]) },
  { name: "move_tab", description: "Move a tab URL into another Space without transferring login state.", inputSchema: objectSchema({ tabId: stringSchema("Source tab id"), spaceId: stringSchema("Destination Space id") }, ["tabId", "spaceId"]) },
  { name: "navigate", description: "Navigate a tab to an HTTP(S) URL or Google search.", inputSchema: objectSchema({ tabId: stringSchema("Tab id"), input: stringSchema("URL or search text", 4_000) }, ["tabId", "input"]) },
  { name: "back", description: "Go back in a tab.", inputSchema: objectSchema({ tabId: stringSchema("Tab id") }, ["tabId"]) },
  { name: "forward", description: "Go forward in a tab.", inputSchema: objectSchema({ tabId: stringSchema("Tab id") }, ["tabId"]) },
  { name: "reload", description: "Reload a tab.", inputSchema: objectSchema({ tabId: stringSchema("Tab id") }, ["tabId"]) },
  { name: "get_page_context", description: "Read bounded, structured page context with safe element references.", inputSchema: objectSchema({ tabId: stringSchema("Tab id") }, ["tabId"]) },
  { name: "capture_screenshot", description: "Capture a redacted screenshot of a tab.", inputSchema: objectSchema({ tabId: stringSchema("Tab id") }, ["tabId"]) },
  { name: "scroll", description: "Scroll a page or referenced scrollable element.", inputSchema: objectSchema({ tabId: stringSchema("Tab id"), ref: stringSchema("Optional element ref"), x: { type: "number" }, y: { type: "number" } }, ["tabId"]) },
  { name: "click", description: "Click a semantic page element, or bounded screenshot coordinates.", inputSchema: objectSchema({ tabId: stringSchema("Tab id"), ref: stringSchema("Element ref"), x: { type: "number" }, y: { type: "number" } }, ["tabId"]) },
  { name: "type", description: "Type non-secret text into a page element. Password and payment fields must use the Vault.", inputSchema: objectSchema({ tabId: stringSchema("Tab id"), ref: stringSchema("Element ref"), text: stringSchema("Text to type", 20_000), replace: { type: "boolean" } }, ["tabId", "ref", "text"]) },
  { name: "select", description: "Select an option in a page select menu.", inputSchema: objectSchema({ tabId: stringSchema("Tab id"), ref: stringSchema("Select element ref"), value: stringSchema("Option value"), label: stringSchema("Option label") }, ["tabId", "ref"]) },
  { name: "press_key", description: "Press a keyboard key on a page element.", inputSchema: objectSchema({ tabId: stringSchema("Tab id"), ref: stringSchema("Optional element ref"), key: stringSchema("Key name", 40) }, ["tabId", "key"]) },
  { name: "submit_form", description: "Submit a page form using a form or submit-control ref.", inputSchema: objectSchema({ tabId: stringSchema("Tab id"), ref: stringSchema("Form or submit-control ref") }, ["tabId", "ref"]) },
  { name: "list_credentials", description: "List saved credential summaries without passwords.", inputSchema: objectSchema({ spaceId: stringSchema("Space id"), origin: stringSchema("Optional origin") }) },
  { name: "fill_credential", description: "Fill a saved credential directly into the matching website form; the password is never returned.", inputSchema: objectSchema({ tabId: stringSchema("Tab id"), credentialId: stringSchema("Credential id") }, ["tabId", "credentialId"]) },
];
