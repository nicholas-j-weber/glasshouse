import type { SheetExport } from "./types";

// Validates an untrusted parsed-JSON value against the export file
// shape before it's ever handed to store.importSheet(), which replaces the
// entire local version chain — a malformed file should produce a clear
// error, not a half-imported or crashed store.

function validateVersionsArray(versions: unknown, label: string): void {
  if (!Array.isArray(versions)) {
    throw new Error(`Missing or invalid ${label} array.`);
  }
  for (const entry of versions) {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("Malformed version entry in export file.");
    }
    const version = entry as Record<string, unknown>;
    if (typeof version.id !== "string" || typeof version.sheet !== "object" || version.sheet === null) {
      throw new Error("Malformed version entry in export file.");
    }
  }
}

function headExistsIn(versions: SheetExport["versions"], headVersionId: unknown): boolean {
  return versions.some((v) => v.id === headVersionId);
}

export function parseSheetExport(data: unknown): SheetExport {
  if (typeof data !== "object" || data === null) {
    throw new Error("Not a valid export file: expected a JSON object.");
  }
  const obj = data as Record<string, unknown>;

  if (obj.formatVersion !== "1.0" && obj.formatVersion !== "1.1") {
    throw new Error(`Unsupported export format version: ${JSON.stringify(obj.formatVersion)}`);
  }
  if (typeof obj.headVersionId !== "string") {
    throw new Error("Missing or invalid headVersionId.");
  }
  validateVersionsArray(obj.versions, "versions");

  const versions = obj.versions as SheetExport["versions"];
  if (!headExistsIn(versions, obj.headVersionId)) {
    throw new Error("headVersionId does not match any version in the export file.");
  }

  if (obj.formatVersion === "1.0") {
    return { formatVersion: "1.0", headVersionId: obj.headVersionId, versions };
  }

  // "1.1" — global section is required once the file
  // claims to be "1.1" at all (both present together, never half-there).
  if (typeof obj.globalHeadVersionId !== "string") {
    throw new Error("Missing or invalid globalHeadVersionId.");
  }
  validateVersionsArray(obj.globalVersions, "globalVersions");

  const globalVersions = obj.globalVersions as SheetExport["versions"];
  if (!headExistsIn(globalVersions, obj.globalHeadVersionId)) {
    throw new Error("globalHeadVersionId does not match any version in globalVersions.");
  }

  return {
    formatVersion: "1.1",
    headVersionId: obj.headVersionId,
    versions,
    globalHeadVersionId: obj.globalHeadVersionId,
    globalVersions,
  };
}
