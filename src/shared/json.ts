export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export type JsonObject = { [key: string]: JsonValue };

export const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isJsonValue = (value: unknown): value is JsonValue => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value) && Object.values(value).every(isJsonValue);
};
