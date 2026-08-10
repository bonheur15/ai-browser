import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { AppStateStore } = await import("../dist-electron/main/state-store.js");

test("seeds two persistent Spaces and a Personal tab", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ai-browser-state-"));
  try {
    const store = new AppStateStore(path.join(directory, "app-state.json"));
    await store.load();
    const state = store.getState();

    assert.deepEqual(
      state.spaces.map((space) => space.name),
      ["Personal", "Work"],
    );
    assert.equal(
      state.spaces.every((space) => space.kind === "persistent"),
      true,
    );
    assert.equal(state.tabs.length, 1);
    assert.equal(state.tabs[0].spaceId, "personal");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("private Space state is filtered out of persisted state", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ai-browser-state-"));
  try {
    const store = new AppStateStore(path.join(directory, "app-state.json"));
    await store.load();
    const privateSpace = store.addSpace({ name: "Private", kind: "private" });
    store.addTab({
      id: "private-tab",
      spaceId: privateSpace.id,
      title: "Temporary",
      url: "https://example.com",
      status: "loaded",
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    });
    await store.flush();

    const persisted = JSON.parse(await readFile(path.join(directory, "app-state.json"), "utf8"));
    assert.equal(
      persisted.spaces.some((space) => space.kind === "private"),
      false,
    );
    assert.equal(
      persisted.tabs.some((tab) => tab.id === "private-tab"),
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the last persistent Space cannot be deleted", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ai-browser-state-"));
  try {
    const store = new AppStateStore(path.join(directory, "app-state.json"));
    await store.load();
    assert.equal(store.removeSpace("personal"), true);
    assert.equal(store.removeSpace("work"), false);
    await store.flush();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("migrates version-one state and persists appearance settings", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ai-browser-settings-"));
  try {
    const statePath = path.join(directory, "app-state.json");
    await writeFile(
      statePath,
      JSON.stringify({
        version: 1,
        spaces: [],
        tabs: [],
        bookmarks: [],
        sites: [],
        scope: "all",
        activeSpaceId: "",
        activeTabId: null,
        drawer: null,
        selectedSiteId: null,
      }),
      "utf8",
    );
    const store = new AppStateStore(statePath);
    await store.load();
    assert.equal(store.getState().version, 2);
    assert.deepEqual(store.getState().settings.appearance, { mode: "dark", accent: "mint" });

    store.update((state) => {
      state.settings.appearance = { mode: "light", accent: "violet" };
    });
    await store.flush();
    const persisted = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(persisted.version, 2);
    assert.deepEqual(persisted.settings.appearance, { mode: "light", accent: "violet" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
