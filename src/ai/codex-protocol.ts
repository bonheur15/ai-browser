export type JsonObject = Record<string, unknown>;

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
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
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
  supportedReasoningEfforts?: Array<{ reasoningEffort?: string; effort?: string; description?: string }>;
  defaultReasoningEffort?: string;
};

export const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isJsonRpcResponse = (value: unknown): value is JsonRpcResponse => {
  if (!isJsonObject(value)) return false;
  return value.jsonrpc === "2.0" && typeof value.id === "number" && ("result" in value || "error" in value);
};

export const isJsonRpcRequest = (value: unknown): value is JsonRpcRequest => {
  if (!isJsonObject(value)) return false;
  return value.jsonrpc === "2.0" && typeof value.id === "number" && typeof value.method === "string";
};

export const isJsonRpcNotification = (value: unknown): value is JsonRpcNotification => {
  if (!isJsonObject(value)) return false;
  return value.jsonrpc === "2.0" && typeof value.method === "string" && !("id" in value);
};
