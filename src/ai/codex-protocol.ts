import { isJsonObject, isJsonValue, type JsonObject, type JsonValue } from "../shared/json";

export type { JsonObject, JsonPrimitive, JsonValue } from "../shared/json";

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: JsonObject;
};

export type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: JsonObject;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: JsonValue;
  error?: { code?: number; message?: string; data?: JsonValue };
};

export type CodexServerRequest = JsonRpcRequest;

export type DynamicToolSpec = {
  type: "function";
  name: string;
  description: string;
  inputSchema: JsonObject;
};

export type DynamicToolNamespace = {
  type: "namespace";
  name: string;
  description: string;
  tools: DynamicToolSpec[];
};

export type CodexModel = {
  id?: string;
  model?: string;
  displayName?: string;
  description?: string;
  hidden?: boolean;
  supportedReasoningEfforts?: Array<{
    reasoningEffort?: string;
    effort?: string;
    description?: string;
  }>;
  defaultReasoningEffort?: string;
};

export const isJsonRpcResponse = (value: unknown): value is JsonRpcResponse => {
  if (!isJsonObject(value)) return false;
  return (
    (value.jsonrpc === undefined || value.jsonrpc === "2.0") &&
    typeof value.id === "number" &&
    ("result" in value || "error" in value) &&
    (value.result === undefined || isJsonValue(value.result))
  );
};

export const isJsonRpcRequest = (value: unknown): value is JsonRpcRequest => {
  if (!isJsonObject(value)) return false;
  return (
    (value.jsonrpc === undefined || value.jsonrpc === "2.0") &&
    typeof value.id === "number" &&
    typeof value.method === "string"
  );
};

export const isJsonRpcNotification = (value: unknown): value is JsonRpcNotification => {
  if (!isJsonObject(value)) return false;
  return (
    (value.jsonrpc === undefined || value.jsonrpc === "2.0") &&
    typeof value.method === "string" &&
    !("id" in value)
  );
};
