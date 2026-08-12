import type { Bean, Gear, Session, Settings, Shot } from '../../domain/types.ts';

/** Tables that participate in sync. `outbox` itself is local-only and never synced. */
export type SyncedTableName = 'beans' | 'gear' | 'sessions' | 'shots' | 'settings';

export type RowFor<T extends SyncedTableName> = T extends 'beans'
  ? Bean
  : T extends 'gear'
    ? Gear
    : T extends 'sessions'
      ? Session
      : T extends 'shots'
        ? Shot
        : Settings;

/**
 * A pending local change. Written inside the same transaction as the row itself, so the
 * outbox can never disagree with what is actually stored.
 */
export interface OutboxEntry {
  /** Auto-incremented; also the drain order. */
  seq?: number;
  table: SyncedTableName;
  rowId: string;
  op: 'upsert' | 'delete';
  at: number;
}

export interface PushBatch {
  table: SyncedTableName;
  upserts: unknown[];
  deletes: string[];
}

/**
 * The seam for a future cloud backend. **Nothing implements this in v1** — there is no
 * server and no account. It exists so that adding one (Supabase, a Cloudflare Worker,
 * anything) is a new file under `db/sync/` rather than a rewrite of every screen.
 *
 * Conflict policy, decided up front so both sides can agree on it:
 * - Last write wins, compared on `updatedAt` (epoch ms).
 * - A tombstone beats a concurrent edit regardless of `updatedAt`: a delete the user
 *   performed on one device should not be resurrected by a stale edit from another.
 * - Clocks are trusted. Skew between a phone and a laptop is seconds; shot logs are not
 *   sensitive to that. If it ever matters, replace `updatedAt` with a server-assigned
 *   sequence — every row already routes through the repo layer, so it is one change.
 */
export interface SyncAdapter {
  readonly name: string;
  /** Push queued local changes. Resolves with the entries that were accepted. */
  push(batches: PushBatch[]): Promise<{ acceptedSeqs: number[] }>;
  /** Pull everything changed server-side since `since` (epoch ms). */
  pull(since: number): Promise<{ batches: PushBatch[]; serverTime: number }>;
}
