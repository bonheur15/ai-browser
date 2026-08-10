import { session, type Session } from "electron";
import type { Space } from "../shared/contracts";

const CLEAR_DATA_TYPES = [
  "backgroundFetch",
  "cache",
  "cookies",
  "fileSystems",
  "indexedDB",
  "localStorage",
  "serviceWorkers",
  "webSQL",
] as const;

const partitionFor = (space: Space): string =>
  space.kind === "private" ? `private-${space.id}` : `persist:space-${space.id}`;

export class SpaceSessionManager {
  private readonly sessions = new Map<string, Session>();

  get(space: Space): Session {
    const existing = this.sessions.get(space.id);
    if (existing) return existing;

    const current = session.fromPartition(partitionFor(space));
    current.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    this.sessions.set(space.id, current);
    return current;
  }

  async inspectOrigin(space: Space, origin: string): Promise<{ cookieCount: number; storagePresent: boolean }> {
    const current = this.get(space);
    try {
      const cookies = await current.cookies.get({ url: origin });
      return { cookieCount: cookies.length, storagePresent: cookies.length > 0 };
    } catch {
      return { cookieCount: 0, storagePresent: false };
    }
  }

  async clearOrigin(space: Space, origin: string): Promise<void> {
    const current = this.get(space);
    await current.clearData({
      origins: [origin],
      dataTypes: [...CLEAR_DATA_TYPES],
      originMatchingMode: "origin-in-all-contexts",
    });
  }

  async flush(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((current) => current.cookies.flushStore()));
  }

  forget(spaceId: string): void {
    this.sessions.delete(spaceId);
  }
}
