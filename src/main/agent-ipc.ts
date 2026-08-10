import { type BaseWindow, ipcMain } from "electron";
import { isAgentPolicy } from "../ai/agent-policy";
import type { AgentRuntime } from "../ai/agent-runtime";
import type { AgentCommand } from "../shared/agent-contracts";

const COMMAND_TYPES = new Set([
  "agent.thread.create",
  "agent.thread.select",
  "agent.thread.rename",
  "agent.thread.delete",
  "agent.message.send",
  "agent.run.pause",
  "agent.run.resume",
  "agent.run.stop",
  "agent.policy.update",
  "agent.model.update",
  "agent.approval.respond",
]);

export const registerAgentIPC = (window: BaseWindow, runtime: AgentRuntime): void => {
  ipcMain.handle("agent:get-snapshot", () => runtime.snapshot());
  ipcMain.handle("agent:dispatch", (_event, command: unknown) => {
    if (!isAgentCommand(command))
      return { ok: false, error: "Invalid agent command", snapshot: runtime.snapshot() };
    return runtime.dispatch(command);
  });
  ipcMain.handle("agent:get-evidence", (_event, id: unknown) =>
    runtime.getEvidence(typeof id === "string" ? id : ""),
  );

  window.on("closed", () => {
    ipcMain.removeHandler("agent:get-snapshot");
    ipcMain.removeHandler("agent:dispatch");
    ipcMain.removeHandler("agent:get-evidence");
  });
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isString = (value: unknown): value is string => typeof value === "string";

const isAgentCommand = (value: unknown): value is AgentCommand => {
  if (!isObject(value) || !isString(value.type) || !COMMAND_TYPES.has(value.type)) return false;
  switch (value.type) {
    case "agent.thread.create":
      return value.title === undefined || isString(value.title);
    case "agent.thread.select":
    case "agent.thread.rename":
    case "agent.thread.delete":
    case "agent.run.pause":
    case "agent.run.resume":
    case "agent.run.stop":
      return isString(value.threadId);
    case "agent.message.send":
      return isString(value.threadId) && isString(value.text);
    case "agent.policy.update":
      return isString(value.threadId) && isAgentPolicy(value.policy);
    case "agent.model.update":
      return (
        isString(value.threadId) &&
        isString(value.model) &&
        ["low", "medium", "high"].includes(String(value.reasoningEffort))
      );
    case "agent.approval.respond":
      return (
        isString(value.threadId) &&
        isString(value.approvalId) &&
        typeof value.approved === "boolean"
      );
  }
  return false;
};
