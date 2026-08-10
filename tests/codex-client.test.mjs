import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { CodexAppServerClient } = await import("../dist-electron/ai/codex-app-server-client.js");

test("Codex client correlates concurrent responses and rejects malformed messages", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ai-browser-codex-fixture-"));
  const executable = path.join(directory, "codex");
  const previousPath = process.env.PATH;
  await writeFile(executable, `#!/usr/bin/env node
const readline = require("node:readline");
const send = (id, result) => process.stdout.write(JSON.stringify({ id, result }) + "\\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") send(message.id, { ok: true });
  else if (message.method === "model/list") send(message.id, { data: [{ id: "gpt-5.6-luna", displayName: "GPT-5.6 Luna" }] });
  else if (message.method === "echo") setTimeout(() => send(message.id, { value: message.params.value }), message.params.value === "first" ? 20 : 0);
  else if (message.method === "malformed") process.stdout.write("this-is-not-json\\n");
});
`, "utf8");
  await chmod(executable, 0o755);
  process.env.PATH = `${directory}${path.delimiter}${previousPath ?? ""}`;

  const client = new CodexAppServerClient();
  try {
    await client.start();
    const [first, second] = await Promise.all([
      client.request("echo", { value: "first" }),
      client.request("echo", { value: "second" }),
    ]);
    assert.equal(first.value, "first");
    assert.equal(second.value, "second");
    await assert.rejects(client.request("malformed"), /Malformed Codex protocol message/);
  } finally {
    await client.stop();
    process.env.PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
  }
});

