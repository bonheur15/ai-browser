import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { AgentStateStore, defaultAgentPolicy } = await import("../dist-electron/ai/agent-state-store.js");
const { AgentPolicyEngine } = await import("../dist-electron/ai/agent-policy.js");

const space = (id, kind = "persistent") => ({
  id,
  name: id,
  color: "#9be7c4",
  icon: "◉",
  kind,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const tab = (id, spaceId, url = "https://example.com/") => ({
  id,
  spaceId,
  title: id,
  url,
  status: "loaded",
  createdAt: new Date().toISOString(),
  lastActiveAt: new Date().toISOString(),
});

test("agent state persists thread metadata and excludes secret-shaped fields", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ai-browser-agent-state-"));
  try {
    const statePath = path.join(directory, "agent-state.json");
    const store = new AgentStateStore(statePath);
    await store.load();
    const thread = store.createThread({ title: "Research task" });
    store.appendMessage({ threadId: thread.id, role: "user", kind: "text", text: "Open the docs" });
    await store.flush();

    const persisted = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(persisted.threads[0].title, "Research task");
    assert.equal(persisted.messages[0].text, "Open the docs");
    assert.equal(Object.hasOwn(persisted, "password"), false);
    assert.equal(Object.hasOwn(persisted, "cookies"), false);
    assert.equal(Object.hasOwn(persisted, "rawDom"), false);

    const restored = new AgentStateStore(statePath);
    await restored.load();
    assert.equal(restored.getThread(thread.id).title, "Research task");
    assert.equal(restored.getMessages(thread.id)[0].text, "Open the docs");

    store.updateThread(thread.id, { status: "running" });
    await store.flush();
    const interrupted = new AgentStateStore(statePath);
    await interrupted.load();
    assert.equal(interrupted.getThread(thread.id).status, "paused");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("private agent threads are available in memory but never written to disk", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ai-browser-agent-private-"));
  try {
    const statePath = path.join(directory, "agent-state.json");
    const store = new AgentStateStore(statePath);
    await store.load();
    const thread = store.createThread({ title: "Private task", ephemeral: true });
    store.appendMessage({ threadId: thread.id, role: "user", kind: "text", text: "Use this private tab" });
    await store.flush();

    const persisted = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(persisted.threads.some((candidate) => candidate.id === thread.id), false);
    assert.equal(persisted.messages.some((candidate) => candidate.threadId === thread.id), false);
    assert.equal(store.getThread(thread.id).ephemeral, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("policy engine enforces modes, Spaces, origins, and approvals", () => {
  const personal = space("personal");
  const privateSpace = space("private", "private");
  const personalTab = tab("personal-tab", personal.id);
  const engine = new AgentPolicyEngine(() => ({ spaces: [personal, privateSpace], tabs: [personalTab] }));
  const full = defaultAgentPolicy();

  assert.deepEqual(engine.decide(full, "navigate", { tab: personalTab }), { allowed: true });
  assert.equal(engine.decide(full, "navigate", { space: privateSpace }).allowed, false);
  assert.equal(engine.decide({ ...full, allowPrivate: true }, "navigate", { space: privateSpace }).allowed, true);
  assert.equal(engine.decide({ ...full, mode: "observe" }, "navigate", { tab: personalTab }).allowed, false);
  assert.equal(engine.decide({ ...full, allowedOrigins: ["https://docs.example.com"] }, "navigate", { url: "https://docs.example.com/file" }).allowed, true);
  assert.equal(engine.decide({ ...full, allowedOrigins: ["https://docs.example.com"] }, "navigate", { url: "https://mail.example.com/" }).allowed, false);
  assert.equal(engine.originAllowed(["*.example.com"], "https://mail.example.com/"), true);
  assert.equal(engine.originAllowed(["*.example.com"], "https://example.com.evil.test/"), false);
  assert.equal(engine.requiresApproval({ ...full, mode: "guided" }, "form-submit"), true);
  assert.equal(engine.requiresApproval({ ...full, mode: "full" }, "form-submit"), false);
  assert.equal(engine.canCreateTab({ ...full, maxTabs: 1 }, personal).allowed, false);
});
