import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { brotliCompress, brotliDecompress } from "node:zlib";
import type { AgentActionTrace, AgentMessage } from "../shared/agent-contracts";

const compress = promisify(brotliCompress);
const decompress = promisify(brotliDecompress);

export type AgentMemoryChunk = {
  id: string;
  threadId: string;
  level: 0 | 1 | 2;
  title: string;
  summary: string;
  keywords: string[];
  sourceMessageIds: string[];
  sourceActionIds: string[];
  createdAt: string;
};

export type AgentMemoryHit = AgentMemoryChunk & { score: number; archiveExcerpt: string };

type MemoryManifest = {
  version: 1;
  threadId: string;
  archiveFile: string;
  updatedAt: string;
  sourceCount: number;
  chunks: AgentMemoryChunk[];
};

type Archive = {
  version: 1;
  threadId: string;
  messages: AgentMessage[];
  actions: AgentActionTrace[];
};

const timestamp = (): string => new Date().toISOString();
const tokens = (value: string): string[] =>
  [
    ...new Set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9:/.-]+/g, " ")
        .split(/\s+/)
        .filter(
          (token) =>
            token.length >= 3 &&
            !["the", "and", "for", "with", "that", "this", "from"].includes(token),
        ),
    ),
  ].slice(0, 80);

const atomicWrite = async (filePath: string, value: string | Uint8Array): Promise<void> => {
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, value);
  await rename(temporaryPath, filePath);
};

export class AgentMemoryStore {
  constructor(private readonly directory: string) {}

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
  }

  async compact(
    threadId: string,
    messages: AgentMessage[],
    actions: AgentActionTrace[],
  ): Promise<AgentMemoryChunk[]> {
    await this.initialize();
    const archive: Archive = {
      version: 1,
      threadId,
      messages: structuredClone(messages),
      actions: structuredClone(actions),
    };
    const archiveFile = `${threadId}.archive.br`;
    await atomicWrite(
      path.join(this.directory, archiveFile),
      await compress(Buffer.from(JSON.stringify(archive))),
    );

    const chunks: AgentMemoryChunk[] = [];
    const records = [
      ...messages.map((message) => ({
        id: message.id,
        createdAt: message.createdAt,
        text: `${message.role}: ${message.text}`,
        messageId: message.id,
        actionId: undefined,
      })),
      ...actions.map((action) => ({
        id: action.id,
        createdAt: action.startedAt,
        text: `action ${action.toolName}: ${action.summary} (${action.status})`,
        messageId: undefined,
        actionId: action.id,
      })),
    ].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    for (let offset = 0; offset < records.length; offset += 24) {
      const group = records.slice(offset, offset + 24);
      const body = group.map((record) => record.text).join("\n");
      chunks.push({
        id: `${threadId}:${offset}`,
        threadId,
        level: 1,
        title: `Checkpoint ${Math.floor(offset / 24) + 1}`,
        summary: body.slice(0, 2_400),
        keywords: tokens(body),
        sourceMessageIds: group.flatMap((record) => (record.messageId ? [record.messageId] : [])),
        sourceActionIds: group.flatMap((record) => (record.actionId ? [record.actionId] : [])),
        createdAt: timestamp(),
      });
    }
    const manifest: MemoryManifest = {
      version: 1,
      threadId,
      archiveFile,
      updatedAt: timestamp(),
      sourceCount: messages.length + actions.length,
      chunks,
    };
    await atomicWrite(
      path.join(this.directory, `${threadId}.manifest.json`),
      JSON.stringify(manifest, null, 2),
    );
    return structuredClone(chunks);
  }

  async search(threadId: string, query: string, limit = 5): Promise<AgentMemoryHit[]> {
    const manifest = await this.readManifest(threadId);
    if (!manifest || !query.trim()) return [];
    const queryTokens = tokens(query);
    const archive = await this.decodeArchive(manifest);
    return manifest.chunks
      .map((chunk) => {
        const score = queryTokens.reduce(
          (total, token) =>
            total +
            (chunk.keywords.includes(token)
              ? 3
              : chunk.summary.toLowerCase().includes(token)
                ? 1
                : 0),
          0,
        );
        const excerpt = [
          ...archive.messages
            .filter((message) => chunk.sourceMessageIds.includes(message.id))
            .map((message) => message.text),
          ...archive.actions
            .filter((action) => chunk.sourceActionIds.includes(action.id))
            .map((action) => action.summary),
        ]
          .join("\n")
          .slice(0, 1_200);
        return { ...chunk, score, archiveExcerpt: excerpt };
      })
      .filter((hit) => hit.score > 0)
      .sort(
        (left, right) => right.score - left.score || right.createdAt.localeCompare(left.createdAt),
      )
      .slice(0, Math.min(20, Math.max(1, limit)));
  }

  async readArchive(threadId: string): Promise<Archive | null> {
    const manifest = await this.readManifest(threadId);
    return manifest ? this.decodeArchive(manifest) : null;
  }

  private async readManifest(threadId: string): Promise<MemoryManifest | null> {
    try {
      const parsed: unknown = JSON.parse(
        await readFile(path.join(this.directory, `${threadId}.manifest.json`), "utf8"),
      );
      if (!parsed || typeof parsed !== "object" || (parsed as { version?: unknown }).version !== 1)
        return null;
      return parsed as MemoryManifest;
    } catch {
      return null;
    }
  }

  private async decodeArchive(manifest: MemoryManifest): Promise<Archive> {
    const bytes = await readFile(path.join(this.directory, manifest.archiveFile));
    return JSON.parse((await decompress(bytes)).toString("utf8")) as Archive;
  }
}
