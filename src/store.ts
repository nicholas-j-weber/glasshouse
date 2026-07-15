import type { ContextSheetDB } from "./db";
import { db as defaultDb } from "./db";
import { notifyHeadChanged } from "./headSubscription";
import { createSkeletonSheet } from "./skeleton";
import type { Memory, Sheet, SheetExport, Version, VersionAttribution } from "./types";

function generateId(): string {
  return crypto.randomUUID();
}

// Addendum O: Sheets persisted with the old dedicated conversationSummary
// field (Addendum I through the version just before this one) have real,
// accumulated conversation history in a field the current Sheet type no
// longer declares. Without migration, that content would just silently
// disappear the moment it's read back under the new shape.
//
// Ids are deterministic (derived from the legacy field's own stable id),
// not crypto.randomUUID() — this function reruns on every read of an
// unmigrated stored version (nothing here rewrites storage), and random
// ids would make React keys and edit_memory/deactivate_memory targeting
// unstable across re-renders until the user's next edit finally persists
// a migrated version.
function migrateLegacyConversationSummary(legacy: Memory): Memory[] {
  if (!legacy.body || legacy.body.trim().length === 0) return [];

  const lines = legacy.body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const anchorTime = Date.parse(legacy.lastModified) || Date.now();

  return lines.map((line, index) => {
    const text = line.replace(/^\d+\.\s*/, ""); // strip the old stored "N. " prefix
    // Synthetic, strictly ascending timestamps preceding the anchor, so
    // sorting by lastModified (serializer.ts's orderConversationTurns)
    // reconstructs the original order even though these lines never had
    // individual timestamps of their own.
    const syntheticTime = new Date(anchorTime - (lines.length - index) * 1000).toISOString();
    return {
      id: `${legacy.id}-migrated-${index}`,
      label: "Conversation Summary",
      body: text,
      pinRank: null,
      active: true,
      lastModified: syntheticTime,
      kind: "conversation_turn" as const,
      provenance: legacy.provenance ?? { source: "manual" as const },
    };
  });
}

// Backward-compatibility shim, read-time-only: never rewrites the stored
// Version (§4.3's snapshots stay immutable, full history preserved) — only
// the in-memory Sheet handed to callers is normalized. The stray
// conversationSummary property (if present) is always stripped, even when
// empty, so it can never get carried forward into a newly-created real
// version and cause the same content to be migrated twice.
function normalizeSheet(sheet: Sheet): Sheet {
  const legacy = (sheet as Sheet & { conversationSummary?: Memory }).conversationSummary;
  if (!legacy) return sheet;

  const legacyTurns = migrateLegacyConversationSummary(legacy);
  const { conversationSummary: _legacy, ...rest } = sheet as Sheet & { conversationSummary?: Memory };
  return { ...rest, memories: [...rest.memories, ...legacyTurns] };
}

function normalizeVersion(version: Version): Version {
  return { ...version, sheet: normalizeSheet(version.sheet) };
}

async function readVersion(db: ContextSheetDB, id: string): Promise<Version | undefined> {
  const version = await db.versions.get(id);
  return version ? normalizeVersion(version) : undefined;
}

// Only the app's single real database (not the isolated instances tests
// construct) should notify subscribers — otherwise store.test.ts's
// per-test databases would fire events with no bearing on the running app.
function notifyIfDefaultDb(db: ContextSheetDB): void {
  if (db === defaultDb) notifyHeadChanged();
}

// §8.1: ensures a head version exists for the given sheet, creating the
// default skeleton (default Tone, no memories — Addendum J/O) if this sheet
// has no versions yet. Idempotent — safe to call on every mount.
//
// Addendum S, 8.4: scoped by sheetId — every sheet has its own independent
// version chain and head pointer (the `head` table's row id is the sheetId
// itself now, not a fixed singleton string).
export async function ensureInitialized(sheetId: string, db: ContextSheetDB = defaultDb): Promise<Version> {
  const existing = await getHeadVersion(sheetId, db);
  if (existing) return existing;

  const skeleton: Version = {
    id: generateId(),
    sheetId,
    parentId: null,
    createdAt: new Date().toISOString(),
    attribution: { kind: "manual_edit" },
    sheet: createSkeletonSheet(),
  };

  await db.versions.add(skeleton);
  await db.head.put({ id: sheetId, versionId: skeleton.id });
  notifyIfDefaultDb(db);
  return skeleton;
}

export async function getHeadVersion(sheetId: string, db: ContextSheetDB = defaultDb): Promise<Version | undefined> {
  const headRecord = await db.head.get(sheetId);
  if (!headRecord) return undefined;
  return readVersion(db, headRecord.versionId);
}

// §4.1/§4.3: creates a new version as a child of the current head and
// advances head to it. Callers must only invoke this for accepted content
// changes (§4.1) — active/inactive toggles and pin-only reorders (§4.2,
// Addendum A 4.2.1) are not version-worthy and must not call this.
export async function createVersion(
  sheet: Sheet,
  attribution: VersionAttribution,
  sheetId: string,
  db: ContextSheetDB = defaultDb,
): Promise<Version> {
  const head = await getHeadVersion(sheetId, db);
  const version: Version = {
    id: generateId(),
    sheetId,
    parentId: head?.id ?? null,
    createdAt: new Date().toISOString(),
    attribution,
    sheet,
  };

  await db.versions.add(version);
  await db.head.put({ id: sheetId, versionId: version.id });
  notifyIfDefaultDb(db);
  return version;
}

// §4.4: moves the head pointer back to version N. Non-destructive —
// versions created after N remain in storage but fall off the active
// line (Addendum A 4.2.1's pending pin state is session-only and isn't
// touched here; it's the caller's responsibility to discard it).
export async function revertToVersion(
  versionId: string,
  sheetId: string,
  db: ContextSheetDB = defaultDb,
): Promise<void> {
  const target = await readVersion(db, versionId);
  if (!target) {
    throw new Error(`Cannot revert: version ${versionId} not found`);
  }
  await db.head.put({ id: sheetId, versionId });
  notifyIfDefaultDb(db);
}

// §4.4: "the current head and its ancestors" — walks parentId back from
// head. Returned oldest-first (skeleton first, head last).
export async function getActiveLineage(sheetId: string, db: ContextSheetDB = defaultDb): Promise<Version[]> {
  const head = await getHeadVersion(sheetId, db);
  if (!head) return [];

  const lineage: Version[] = [head];
  let current = head;
  while (current.parentId !== null) {
    const parent = await readVersion(db, current.parentId);
    if (!parent) break; // parent chain is append-only; absence would be a bug, not user error
    lineage.push(parent);
    current = parent;
  }
  return lineage.reverse();
}

// §8.3.1: export is head + its ancestors — "sufficient to reconstruct
// rollback history" — not every version ever created. §4.4 may leave
// reverted-past branches in storage that are no longer reachable from
// head; those are intentionally excluded.
export async function exportSheet(sheetId: string, db: ContextSheetDB = defaultDb): Promise<SheetExport> {
  const lineage = await getActiveLineage(sheetId, db);
  const head = lineage[lineage.length - 1];
  if (!head) {
    throw new Error("Cannot export: no sheet has been initialized");
  }
  return {
    formatVersion: "1.0",
    headVersionId: head.id,
    versions: lineage,
  };
}

// §8.3.1: "Import replaces the local store's version chain with the
// imported one and sets head to headVersionId."
//
// Addendum S: scoped to the target sheetId only — clears just this sheet's
// versions (not the whole shared table, now that other sheets live in it)
// and stamps sheetId onto every imported version, so an older export file
// (predating Addendum S, with no sheetId at all) still imports cleanly into
// whichever sheet it's imported into.
//
// Addendum AV: confirmed real bug — db.ts's versions store is keyed "id,
// sheetId, parentId", i.e. id is a *table-wide* primary key across every
// sheet, not scoped per sheetId. Re-stamping sheetId while keeping each
// version's original id (as this used to do) only avoids colliding with
// the *target* sheet's own rows; it does nothing about the *source* sheet
// the file was exported from, which is untouched and still holds those
// exact same ids if it still exists in this database — exactly the case
// when exporting one chat and importing into a different, newly-created
// one. bulkAdd then fails a ConstraintError on every single row, since
// every id in the file still exists somewhere. Every id is now freshly
// minted on import — an idMap keeps parentId chains (and headVersionId)
// pointing at the right new id, so the lineage's shape is unaffected, just
// its ids. Re-importing into the sheet the file actually came from still
// works exactly as before (its old rows are deleted first either way);
// this only changes what were previously (silently, until they collided)
// spurious id matches.
export async function importSheet(data: SheetExport, sheetId: string, db: ContextSheetDB = defaultDb): Promise<void> {
  const idMap = new Map(data.versions.map((v) => [v.id, generateId()]));
  const remapped = data.versions.map((v) => ({
    ...v,
    id: idMap.get(v.id)!,
    sheetId,
    parentId: v.parentId === null ? null : (idMap.get(v.parentId) ?? null),
  }));
  const newHeadVersionId = idMap.get(data.headVersionId) ?? data.headVersionId;

  await db.transaction("rw", db.versions, db.head, async () => {
    await db.versions.where("sheetId").equals(sheetId).delete();
    await db.versions.bulkAdd(remapped);
    await db.head.put({ id: sheetId, versionId: newHeadVersionId });
  });
  notifyIfDefaultDb(db);
}
