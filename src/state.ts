// Tracks state per community: which users we've welcomed, recent message buffer, own messages awaiting reconciliation.

export interface SeenMessage {
  id: string;
  userId: string;
  username: string;
  content: string;
  createdAt: string;
  parentMessageId: string | null;
}

export interface PendingPost {
  content: string;
  postedAt: number;
}

export class CommunityState {
  readonly welcomed = new Set<string>(); // userIds we've welcomed
  readonly recent: SeenMessage[] = []; // last N messages, oldest→newest
  readonly pending: PendingPost[] = []; // optimistic posts awaiting message_update echo
  readonly ownMessageIds = new Set<string>(); // confirmed-persisted Chance posts
  readonly maxRecent = 30;

  pushRecent(m: SeenMessage) {
    this.recent.push(m);
    if (this.recent.length > this.maxRecent) this.recent.shift();
  }

  markPending(content: string) {
    this.pending.push({ content: content.trim(), postedAt: Date.now() });
    // GC stale pendings after 30s
    const cutoff = Date.now() - 30_000;
    while (this.pending.length && this.pending[0]!.postedAt < cutoff) this.pending.shift();
  }

  reconcile(content: string): boolean {
    const idx = this.pending.findIndex((p) => p.content === content.trim());
    if (idx < 0) return false;
    this.pending.splice(idx, 1);
    return true;
  }
}
