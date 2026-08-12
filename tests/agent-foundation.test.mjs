import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { AgentStateStore, defaultAgentPolicy } = await import(
  "../dist-electron/ai/agent-state-store.js"
);
const { AgentMemoryStore } = await import("../dist-electron/ai/agent-memory-store.js");
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
    store.appendMessage({
      threadId: thread.id,
      role: "user",
      kind: "text",
      text: "Use this private tab",
    });
    await store.flush();

    const persisted = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(
      persisted.threads.some((candidate) => candidate.id === thread.id),
      false,
    );
    assert.equal(
      persisted.messages.some((candidate) => candidate.threadId === thread.id),
      false,
    );
    assert.equal(store.getThread(thread.id).ephemeral, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("policy engine enforces modes, Spaces, origins, and approvals", () => {
  const personal = space("personal");
  const privateSpace = space("private", "private");
  const personalTab = tab("personal-tab", personal.id);
  const engine = new AgentPolicyEngine(() => ({
    spaces: [personal, privateSpace],
    tabs: [personalTab],
  }));
  const full = defaultAgentPolicy();

  assert.deepEqual(engine.decide(full, "navigate", { tab: personalTab }), { allowed: true });
  assert.equal(engine.decide(full, "navigate", { space: privateSpace }).allowed, false);
  assert.equal(
    engine.decide({ ...full, allowPrivate: true }, "navigate", { space: privateSpace }).allowed,
    true,
  );
  assert.equal(
    engine.decide({ ...full, mode: "observe" }, "navigate", { tab: personalTab }).allowed,
    false,
  );
  assert.equal(
    engine.decide({ ...full, allowedOrigins: ["https://docs.example.com"] }, "navigate", {
      url: "https://docs.example.com/file",
    }).allowed,
    true,
  );
  assert.equal(
    engine.decide({ ...full, allowedOrigins: ["https://docs.example.com"] }, "navigate", {
      url: "https://mail.example.com/",
    }).allowed,
    false,
  );
  assert.equal(engine.originAllowed(["*.example.com"], "https://mail.example.com/"), true);
  assert.equal(engine.originAllowed(["*.example.com"], "https://example.com.evil.test/"), false);
  assert.equal(engine.requiresApproval({ ...full, mode: "guided" }, "form-submit"), true);
  assert.equal(engine.requiresApproval({ ...full, mode: "full" }, "form-submit"), false);
  assert.equal(engine.canCreateTab({ ...full, maxTabs: 1 }, personal).allowed, false);
});

test("global Agent defaults only affect threads created after the update", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ai-browser-agent-defaults-"));
  try {
    const store = new AgentStateStore(path.join(directory, "agent-state.json"));
    await store.load();
    store.updateGlobalDefaults({ ...defaultAgentPolicy(), mode: "guided" });
    const existing = store.createThread({ title: "Existing" });
    store.updateGlobalDefaults({ ...defaultAgentPolicy(), mode: "observe" });
    const next = store.createThread({ title: "Next" });

    assert.equal(existing.policy.mode, "guided");
    assert.equal(next.policy.mode, "observe");
    assert.equal(store.getThread(existing.id).policy.mode, "guided");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("goals persist lifecycle state and migrate with agent state", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ai-browser-agent-goal-"));
  try {
    const statePath = path.join(directory, "agent-state.json");
    const store = new AgentStateStore(statePath);
    await store.load();
    const thread = store.createThread({ title: "Long task" });
    const goal = store.createGoal({
      threadId: thread.id,
      title: "Daily research",
      objective: "Review the approved sources",
      status: "draft",
      endsAt: null,
      wakeAt: null,
      maxIterations: 10,
      allowedOrigins: ["https://example.com"],
    });
    store.updateGoal(goal.id, {
      status: "sleeping",
      wakeAt: new Date(Date.now() + 60_000).toISOString(),
      iteration: 2,
    });
    await store.flush();

    const persisted = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(persisted.version, 2);
    assert.equal(persisted.goals[0].status, "sleeping");
    const restored = new AgentStateStore(statePath);
    await restored.load();
    assert.equal(restored.getGoal(goal.id).iteration, 2);
    assert.equal(restored.getGoal(goal.id).wakeAt !== null, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("memory compaction preserves the cold archive and ranks relevant checkpoints", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ai-browser-memory-"));
  try {
    const memory = new AgentMemoryStore(directory);
    const messages = [
      {
        id: "m1",
        threadId: "thread-1",
        role: "user",
        kind: "text",
        text: "Research the approved documentation source",
        createdAt: "2026-08-12T10:00:00.000Z",
      },
      {
        id: "m2",
        threadId: "thread-1",
        role: "assistant",
        kind: "text",
        text: "The documentation source is https://example.com/docs",
        createdAt: "2026-08-12T10:01:00.000Z",
      },
      {
        id: "m3",
        threadId: "thread-1",
        role: "assistant",
        kind: "text",
        text: "A separate unrelated note about weather",
        createdAt: "2026-08-12T10:02:00.000Z",
      },
    ];
    const actions = [
      {
        id: "a1",
        threadId: "thread-1",
        toolName: "navigate",
        actionClass: "navigate",
        summary: "Navigate https://example.com/docs",
        status: "succeeded",
        startedAt: "2026-08-12T10:01:30.000Z",
      },
    ];
    const chunks = await memory.compact("thread-1", messages, actions);
    assert.equal(chunks.length, 1);
    const hits = await memory.search("thread-1", "documentation source", 3);
    assert.equal(hits.length, 1);
    assert.match(hits[0].archiveExcerpt, /documentation/);
    const archive = await memory.readArchive("thread-1");
    assert.equal(archive.messages.length, 3);
    assert.equal(archive.actions[0].toolName, "navigate");
    assert.equal((await readFile(path.join(directory, "thread-1.archive.br"))).length > 0, true);
    assert.equal(
      (await readFile(path.join(directory, "thread-1.manifest.json"), "utf8")).includes(
        "sourceMessageIds",
      ),
      true,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
