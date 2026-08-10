export type AgentTabLock = { threadId: string };

export class AgentTabLocks {
  private readonly locks = new Map<string, AgentTabLock>();

  constructor(private readonly setInteractionLocked: (tabId: string, locked: boolean) => void) {}

  set(tabId: string, threadId: string, locked: boolean): void {
    if (locked) {
      this.locks.set(tabId, { threadId });
      this.setInteractionLocked(tabId, true);
      return;
    }
    this.locks.delete(tabId);
    this.setInteractionLocked(tabId, false);
  }

  release(threadId: string): void {
    for (const [tabId, lock] of this.locks) {
      if (lock.threadId === threadId) this.set(tabId, threadId, false);
    }
  }

  get(tabId: string): AgentTabLock | undefined {
    return this.locks.get(tabId);
  }

  has(tabId: string): boolean {
    return this.locks.has(tabId);
  }
}
