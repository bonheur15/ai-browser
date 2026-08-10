import assert from "node:assert/strict";
import test from "node:test";

const { isJsonObject, isJsonValue } = await import("../dist-electron/shared/json.js");
const { DEFAULT_URL, navigationUrl, originFor } = await import(
  "../dist-electron/main/browser-navigation.js"
);
const { AgentTabLocks } = await import("../dist-electron/main/agent-tab-locks.js");

test("JSON boundary validators accept JSON and reject runtime-only values", () => {
  assert.equal(isJsonValue({ nested: ["ok", 3, null] }), true);
  assert.equal(isJsonObject({ nested: true }), true);
  assert.equal(isJsonValue(undefined), false);
  assert.equal(isJsonValue({ invalid: undefined }), false);
  assert.equal(
    isJsonValue(() => "not JSON"),
    false,
  );
});

test("navigation normalizes blank input, URLs, and search terms", () => {
  assert.equal(navigationUrl("   "), DEFAULT_URL);
  assert.equal(navigationUrl(" https://example.com/path "), "https://example.com/path");
  assert.equal(
    navigationUrl("electron security"),
    "https://www.google.com/search?q=electron%20security",
  );
  assert.equal(originFor("https://example.com/path"), "https://example.com");
  assert.equal(originFor("file:///tmp/example"), null);
});

test("agent tab locks release by thread without persisting state", () => {
  const interactionChanges = [];
  const locks = new AgentTabLocks((tabId, locked) => interactionChanges.push({ tabId, locked }));

  locks.set("tab-1", "thread-1", true);
  assert.deepEqual(locks.get("tab-1"), { threadId: "thread-1" });
  locks.release("thread-2");
  assert.deepEqual(locks.get("tab-1"), { threadId: "thread-1" });
  locks.release("thread-1");
  assert.equal(locks.get("tab-1"), undefined);
  assert.deepEqual(interactionChanges, [
    { tabId: "tab-1", locked: true },
    { tabId: "tab-1", locked: false },
  ]);
});

test("agent tab locks preserve the current owner and can be cleared globally", () => {
  const interactionChanges = [];
  const locks = new AgentTabLocks((tabId, locked) => interactionChanges.push({ tabId, locked }));

  locks.set("tab-1", "thread-1", true);
  locks.set("tab-1", "thread-2", true);
  locks.set("tab-1", "thread-1", false);
  assert.deepEqual(locks.get("tab-1"), { threadId: "thread-2" });

  locks.set("tab-2", "thread-2", true);
  locks.releaseAll();
  assert.equal(locks.get("tab-1"), undefined);
  assert.equal(locks.get("tab-2"), undefined);
  assert.deepEqual(interactionChanges, [
    { tabId: "tab-1", locked: true },
    { tabId: "tab-2", locked: true },
    { tabId: "tab-1", locked: false },
    { tabId: "tab-2", locked: false },
  ]);
});
