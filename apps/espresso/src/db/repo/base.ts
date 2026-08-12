import type { Table } from 'dexie';
import type { Synced } from '../../domain/types.ts';
import { db as defaultDb, type EspressoDB } from '../schema.ts';
import type { RowFor, SyncedTableName } from '../sync/types.ts';

/**
 * The one place that writes to IndexedDB.
 *
 * Every mutation here does three things atomically: stamp `updatedAt`, set `dirty = 1`,
 * and append an outbox entry. Screens must never call `db.<table>.put()` directly — if
 * they do, a future sync will silently miss that change, which is the kind of bug that
 * only shows up on a second device months later.
 *
 * Deletes are tombstones (`deletedAt` set). Reads filter them out, so from the UI's point
 * of view a deleted row is gone, but the row survives to tell a server it was deleted.
 */

/**
 * Row shape accepted when creating: the caller supplies the domain fields, we add the
 * envelope. Written as a distributive conditional so that on a discriminated union like
 * `Gear` each member keeps its own `kind`/`spec` pairing — a plain `Omit<Gear, …>` would
 * collapse to a common shape and happily accept a machine with a basket's spec.
 */
export type NewRow<R extends Synced> = R extends unknown
  ? Omit<R, keyof Synced> & { id?: string }
  : never;

/** Fields a caller may change. The envelope is ours to manage. */
export type RowPatch<R extends Synced> = R extends unknown ? Partial<Omit<R, keyof Synced>> : never;

export function newId(): string {
  // `crypto.randomUUID` needs a secure context; the fallback keeps http://localhost and
  // older WebViews working. Not cryptographically meaningful either way — these are keys.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Dexie's per-table generics don't survive a `SyncedTableName` lookup, so we erase them
 * once here rather than casting at every call site.
 */
type ErasedRow = Synced & Record<string, unknown>;
function tableOf(dbi: EspressoDB, name: SyncedTableName): Table<ErasedRow, string> {
  return dbi.table(name) as unknown as Table<ErasedRow, string>;
}

export async function createRow<T extends SyncedTableName>(
  name: T,
  data: NewRow<RowFor<T>>,
  dbi: EspressoDB = defaultDb,
): Promise<RowFor<T>> {
  const { id, ...rest } = data as { id?: string } & Record<string, unknown>;
  const row = {
    ...rest,
    id: id ?? newId(),
    updatedAt: Date.now(),
    deletedAt: null,
    dirty: 1 as const,
  } as ErasedRow;

  await dbi.transaction('rw', tableOf(dbi, name), dbi.outbox, async () => {
    await tableOf(dbi, name).put(row);
    await dbi.outbox.add({ table: name, rowId: row.id, op: 'upsert', at: row.updatedAt });
  });
  return row as unknown as RowFor<T>;
}

export async function updateRow<T extends SyncedTableName>(
  name: T,
  id: string,
  patch: RowPatch<RowFor<T>>,
  dbi: EspressoDB = defaultDb,
): Promise<RowFor<T>> {
  const table = tableOf(dbi, name);
  let updated: ErasedRow | undefined;

  await dbi.transaction('rw', table, dbi.outbox, async () => {
    const existing = await table.get(id);
    if (!existing) throw new Error(`${name}: no row with id ${id}`);
    updated = { ...existing, ...(patch as Record<string, unknown>), updatedAt: Date.now(), dirty: 1 };
    await table.put(updated);
    await dbi.outbox.add({ table: name, rowId: id, op: 'upsert', at: updated.updatedAt });
  });

  return updated as unknown as RowFor<T>;
}

/** Tombstone a row. Reads stop seeing it; sync still learns about the deletion. */
export async function deleteRow<T extends SyncedTableName>(
  name: T,
  id: string,
  dbi: EspressoDB = defaultDb,
): Promise<void> {
  const table = tableOf(dbi, name);
  await dbi.transaction('rw', table, dbi.outbox, async () => {
    const existing = await table.get(id);
    if (!existing) return;
    const at = Date.now();
    await table.put({ ...existing, deletedAt: at, updatedAt: at, dirty: 1 });
    await dbi.outbox.add({ table: name, rowId: id, op: 'delete', at });
  });
}

/** Single row by id, or undefined if missing *or* tombstoned. */
export async function getRow<T extends SyncedTableName>(
  name: T,
  id: string,
  dbi: EspressoDB = defaultDb,
): Promise<RowFor<T> | undefined> {
  const row = await tableOf(dbi, name).get(id);
  if (!row || row.deletedAt) return undefined;
  return row as unknown as RowFor<T>;
}

/** All live (non-tombstoned) rows in a table. */
export async function listRows<T extends SyncedTableName>(
  name: T,
  dbi: EspressoDB = defaultDb,
): Promise<RowFor<T>[]> {
  const rows = await tableOf(dbi, name).toArray();
  return rows.filter((r) => !r.deletedAt) as unknown as RowFor<T>[];
}

/** Drops tombstones from an already-fetched list. For use with live queries. */
export function live<R extends Synced>(rows: R[] | undefined): R[] {
  return (rows ?? []).filter((r) => !r.deletedAt);
}

/**
 * A whole table as a **single** query, for use inside `useLiveQuery`.
 *
 * Deliberately not an `async` function. Dexie tracks which tables a live query touched by
 * observing the queries issued inside its own execution zone, and that zone is lost after the
 * first `await` in a native async function. A read path like
 * `useLiveQuery(async () => { const s = await getSession(); return getShots(s.id); })` therefore
 * subscribes only to `sessions`, and writing a shot never refreshes the screen — which is
 * exactly the bug this replaced.
 *
 * So: hooks issue one un-awaited query per table and do the joining in plain JavaScript.
 * Tombstones are included here and filtered by `live()` at the call site.
 */
export function queryTable<T extends SyncedTableName>(
  name: T,
  dbi: EspressoDB = defaultDb,
): Promise<RowFor<T>[]> {
  return tableOf(dbi, name).toArray() as unknown as Promise<RowFor<T>[]>;
}
