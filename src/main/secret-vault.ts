import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeStorage } from "electron";
import type { CredentialSummary, StoredCredential } from "../shared/contracts";

type VaultDocument = {
  version: 1;
  credentials: StoredCredential[];
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export class SecretVault {
  private credentials = new Map<string, StoredCredential>();
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  readonly available: boolean;

  constructor(private readonly filePath: string) {
    const backend = process.platform === "linux" ? safeStorage.getSelectedStorageBackend() : null;
    this.available = safeStorage.isEncryptionAvailable() && backend !== "basic_text";
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.available) return;

    try {
      const encoded = await readFile(this.filePath, "utf8");
      const plaintext = safeStorage.decryptString(Buffer.from(encoded, "base64"));
      const parsed: unknown = JSON.parse(plaintext);
      if (!isObject(parsed) || parsed.version !== 1 || !Array.isArray(parsed.credentials)) return;
      for (const candidate of parsed.credentials) {
        if (isCredential(candidate)) this.credentials.set(candidate.id, candidate);
      }
    } catch (error: unknown) {
      const code = isObject(error) && "code" in error ? error.code : undefined;
      if (code !== "ENOENT") {
        console.error("[vault] unable to decrypt or read the credential vault", error);
      }
    }
  }

  summaries(spaceId?: string): CredentialSummary[] {
    return [...this.credentials.values()]
      .filter((credential) => !spaceId || credential.spaceId === spaceId)
      .map(({ password: _password, ...summary }) => summary)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  get(credentialId: string, spaceId?: string): StoredCredential | null {
    const credential = this.credentials.get(credentialId);
    if (!credential || (spaceId && credential.spaceId !== spaceId)) return null;
    return { ...credential };
  }

  async save(credential: StoredCredential): Promise<void> {
    if (!this.available) throw new Error("Secure credential storage is unavailable");
    this.credentials.set(credential.id, credential);
    await this.flush();
  }

  async remove(credentialId: string, spaceId?: string): Promise<boolean> {
    const credential = this.credentials.get(credentialId);
    if (!credential || (spaceId && credential.spaceId !== spaceId)) return false;
    this.credentials.delete(credentialId);
    await this.flush();
    return true;
  }

  async removeForOrigin(spaceId: string, origin: string): Promise<void> {
    for (const [id, credential] of this.credentials) {
      if (credential.spaceId === spaceId && credential.origin === origin) this.credentials.delete(id);
    }
    await this.flush();
  }

  async flush(): Promise<void> {
    if (!this.available) return;
    const document: VaultDocument = {
      version: 1,
      credentials: [...this.credentials.values()],
    };
    const encrypted = safeStorage.encryptString(JSON.stringify(document));
    const temporaryPath = `${this.filePath}.tmp`;
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      await writeFile(temporaryPath, encrypted.toString("base64"), "utf8");
      await rename(temporaryPath, this.filePath);
    }).catch((error: unknown) => {
      console.error("[vault] unable to persist encrypted credentials", error);
    });
    await this.writeChain;
  }
}

const isCredential = (value: unknown): value is StoredCredential => {
  if (!isObject(value)) return false;
  return ["id", "spaceId", "origin", "hostname", "username", "password", "createdAt", "updatedAt"]
    .every((key) => typeof value[key] === "string");
};
