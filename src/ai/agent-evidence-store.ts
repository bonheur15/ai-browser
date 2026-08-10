import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { nativeImage } from "electron";

export type StoredEvidence = {
  id: string;
  threadId: string;
  title: string;
  url: string;
  createdAt: string;
  fileName: string;
};

type EvidenceDocument = {
  version: 1;
  records: StoredEvidence[];
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export class AgentEvidenceStore {
  private records = new Map<string, StoredEvidence>();
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly directory: string) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await readFile(path.join(this.directory, "index.json"), "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (!isObject(parsed) || parsed.version !== 1 || !Array.isArray(parsed.records)) return;
      for (const record of parsed.records) {
        if (isEvidenceRecord(record)) this.records.set(record.id, record);
      }
    } catch (error: unknown) {
      const code = isObject(error) && "code" in error ? error.code : undefined;
      if (code !== "ENOENT") console.error("[agent-evidence] unable to read evidence index", error);
    }
  }

  async save(input: { threadId: string; title: string; url: string; dataUrl: string }): Promise<StoredEvidence | null> {
    try {
      const image = nativeImage.createFromDataURL(input.dataUrl);
      if (image.isEmpty()) return null;
      const size = image.getSize();
      const thumbnail = image.resize({ width: Math.min(480, Math.max(1, size.width)) });
      const id = randomUUID();
      const record: StoredEvidence = {
        id,
        threadId: input.threadId,
        title: input.title.slice(0, 180),
        url: input.url.slice(0, 2_000),
        createdAt: new Date().toISOString(),
        fileName: `${id}.png`,
      };
      await mkdir(this.directory, { recursive: true });
      await writeFile(path.join(this.directory, record.fileName), thumbnail.toPNG());
      this.records.set(id, record);
      await this.trimThread(input.threadId);
      await this.writeIndex();
      return structuredClone(record);
    } catch (error: unknown) {
      console.error("[agent-evidence] unable to save evidence", error);
      return null;
    }
  }

  async get(id: string): Promise<{ record: StoredEvidence; dataUrl: string } | null> {
    const record = this.records.get(id);
    if (!record) return null;
    try {
      const data = await readFile(path.join(this.directory, record.fileName));
      return { record: structuredClone(record), dataUrl: `data:image/png;base64,${data.toString("base64")}` };
    } catch {
      this.records.delete(id);
      await this.writeIndex();
      return null;
    }
  }

  async removeForThread(threadId: string): Promise<void> {
    const removed = [...this.records.values()].filter((record) => record.threadId === threadId);
    for (const record of removed) {
      this.records.delete(record.id);
      await unlink(path.join(this.directory, record.fileName)).catch(() => undefined);
    }
    await this.writeIndex();
  }

  async flush(): Promise<void> {
    await this.writeIndex();
  }

  private async trimThread(threadId: string): Promise<void> {
    const threadRecords = [...this.records.values()]
      .filter((record) => record.threadId === threadId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    for (const record of threadRecords.slice(0, Math.max(0, threadRecords.length - 20))) {
      this.records.delete(record.id);
      await unlink(path.join(this.directory, record.fileName)).catch(() => undefined);
    }
  }

  private async writeIndex(): Promise<void> {
    const document: EvidenceDocument = { version: 1, records: [...this.records.values()] };
    const indexPath = path.join(this.directory, "index.json");
    const temporaryPath = `${indexPath}.tmp`;
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(this.directory, { recursive: true });
      await writeFile(temporaryPath, JSON.stringify(document, null, 2), "utf8");
      await rename(temporaryPath, indexPath);
    }).catch((error: unknown) => {
      console.error("[agent-evidence] unable to persist evidence index", error);
    });
    await this.writeChain;
  }
}

const isEvidenceRecord = (value: unknown): value is StoredEvidence => {
  if (!isObject(value)) return false;
  return ["id", "threadId", "title", "url", "createdAt", "fileName"].every((key) => typeof value[key] === "string");
};
