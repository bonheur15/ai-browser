export type AgentTabLock = { threadId: string };

export class AgentTabLocks {
  private readonly locks = new Map<string, AgentTabLock>();

  constructor(
    private readonly setInteractionLocked: (tabId: string, locked: boolean) => void = () =>
      undefined,
  ) {}

  set(tabId: string, threadId: string, locked: boolean): void {
    if (locked) {
      const existing = this.locks.get(tabId);
      if (existing?.threadId === threadId) return;
      this.locks.set(tabId, { threadId });
      if (!existing) this.setInteractionLocked(tabId, true);
      return;
    }
    if (this.locks.get(tabId)?.threadId !== threadId) return;
    this.locks.delete(tabId);
    this.setInteractionLocked(tabId, false);
  }

  release(threadId: string): void {
    for (const [tabId, lock] of this.locks) {
      if (lock.threadId === threadId) this.set(tabId, threadId, false);
    }
  }

  releaseAll(): void {
    for (const [tabId] of this.locks) {
      this.locks.delete(tabId);
      this.setInteractionLocked(tabId, false);
    }
  }

  get(tabId: string): AgentTabLock | undefined {
    return this.locks.get(tabId);
  }

  has(tabId: string): boolean {
    return this.locks.has(tabId);
  }
}
