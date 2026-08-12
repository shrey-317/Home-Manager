import { db, type EspressoDB } from '../schema.ts';
import type { PushBatch, SyncAdapter, SyncedTableName } from './types.ts';

const SYNCED_TABLES: SyncedTableName[] = ['beans', 'gear', 'sessions', 'shots', 'settings'];

/**
 * Collects pending local changes into per-table batches.
 *
 * Reads the *current* row rather than a snapshot taken at write time: if a shot was edited
 * three times before a sync ran, the server should receive the latest state once, not a
 * replay of the intermediate versions.
 */
export async function collectPending(dbi: EspressoDB = db): Promise<PushBatch[]> {
  const entries = await dbi.outbox.orderBy('seq').toArray();
  if (entries.length === 0) return [];

  const batches: PushBatch[] = [];
  for (const table of SYNCED_TABLES) {
    const forTable = entries.filter((e) => e.table === table);
    if (forTable.length === 0) continue;

    const upsertIds = new Set<string>();
    const deleteIds = new Set<string>();
    for (const e of forTable) {
      if (e.op === 'delete') {
        upsertIds.delete(e.rowId);
        deleteIds.add(e.rowId);
      } else if (!deleteIds.has(e.rowId)) {
        upsertIds.add(e.rowId);
      }
    }

    const rows = await dbi.table(table).bulkGet([...upsertIds]);
    batches.push({
      table,
      upserts: rows.filter((r): r is NonNullable<typeof r> => r != null),
      deletes: [...deleteIds],
    });
  }
  return batches;
}

/** Clear accepted entries and drop the `dirty` flag on rows with nothing left queued. */
export async function markPushed(seqs: number[], dbi: EspressoDB = db): Promise<void> {
  if (seqs.length === 0) return;
  // Array form of `transaction`, because the table list is computed rather than literal.
  const tables = [dbi.outbox, ...SYNCED_TABLES.map((t) => dbi.table(t))];
  await dbi.transaction('rw', tables, async () => {
    const entries = await dbi.outbox.bulkGet(seqs);
    await dbi.outbox.bulkDelete(seqs);

    for (const entry of entries) {
      if (!entry) continue;
      const stillQueued = await dbi.outbox
        .where('[table+rowId]')
        .equals([entry.table, entry.rowId])
        .count();
      if (stillQueued > 0) continue;
      const table = dbi.table(entry.table);
      const row = await table.get(entry.rowId);
      if (row) await table.put({ ...row, dirty: 0 });
    }
  });
}

export async function pendingCount(dbi: EspressoDB = db): Promise<number> {
  return dbi.outbox.count();
}

/**
 * Runs one push/pull cycle against an adapter.
 *
 * **No adapter ships in v1** — there is no server and no account, by design. This function
 * exists so that wiring one up later is an implementation of `SyncAdapter` plus a call site,
 * with no changes to screens or repos. It is covered by tests using a fake adapter.
 */
export async function syncOnce(
  adapter: SyncAdapter,
  since: number,
  dbi: EspressoDB = db,
): Promise<{ pushed: number; pulled: number; serverTime: number }> {
  const batches = await collectPending(dbi);
  let pushed = 0;
  if (batches.length > 0) {
    const { acceptedSeqs } = await adapter.push(batches);
    await markPushed(acceptedSeqs, dbi);
    pushed = acceptedSeqs.length;
  }

  const { batches: incoming, serverTime } = await adapter.pull(since);
  let pulled = 0;
  for (const batch of incoming) {
    const table = dbi.table(batch.table);
    for (const raw of batch.upserts) {
      const remote = raw as { id: string; updatedAt: number };
      const local = (await table.get(remote.id)) as
        | { updatedAt: number; deletedAt?: number | null }
        | undefined;
      // Last-write-wins on updatedAt; a local tombstone beats a remote edit.
      if (local?.deletedAt) continue;
      if (local && local.updatedAt >= remote.updatedAt) continue;
      await table.put({ ...remote, dirty: 0 });
      pulled += 1;
    }
    for (const id of batch.deletes) {
      const local = await table.get(id);
      if (!local) continue;
      await table.put({ ...local, deletedAt: serverTime, updatedAt: serverTime, dirty: 0 });
      pulled += 1;
    }
  }
  return { pushed, pulled, serverTime };
}
