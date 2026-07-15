import { describe, expect, it } from "vitest";
import { parseSheetExport } from "./sheetExportValidation";

function makeVersion(id: string) {
  return {
    id,
    parentId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    attribution: { kind: "manual_edit" },
    sheet: {
      tone: {
        id: "tone",
        label: "Tone",
        body: "Clear and direct.",
        pinRank: 0,
        active: true,
        lastModified: "2026-01-01T00:00:00.000Z",
        provenance: { source: "manual" },
      },
      memories: [],
      freeformNotes: "",
    },
  };
}

describe("parseSheetExport", () => {
  it("accepts a well-formed export", () => {
    const valid = { formatVersion: "1.0", headVersionId: "v1", versions: [makeVersion("v1")] };
    expect(parseSheetExport(valid)).toEqual(valid);
  });

  it("rejects non-object input", () => {
    expect(() => parseSheetExport("not an object")).toThrow(/JSON object/);
    expect(() => parseSheetExport(null)).toThrow(/JSON object/);
  });

  it("rejects an unsupported formatVersion", () => {
    expect(() => parseSheetExport({ formatVersion: "2.0", headVersionId: "v1", versions: [] })).toThrow(
      /format version/,
    );
  });

  it("rejects a missing/invalid headVersionId", () => {
    expect(() => parseSheetExport({ formatVersion: "1.0", versions: [] })).toThrow(/headVersionId/);
  });

  it("rejects a non-array versions field", () => {
    expect(() => parseSheetExport({ formatVersion: "1.0", headVersionId: "v1", versions: "nope" })).toThrow(
      /versions array/,
    );
  });

  it("rejects a malformed version entry", () => {
    expect(() =>
      parseSheetExport({ formatVersion: "1.0", headVersionId: "v1", versions: [{ notAVersion: true }] }),
    ).toThrow(/Malformed version/);
  });

  it("rejects a headVersionId that doesn't match any version", () => {
    expect(() =>
      parseSheetExport({ formatVersion: "1.0", headVersionId: "missing", versions: [makeVersion("v1")] }),
    ).toThrow(/does not match/);
  });
});

describe("parseSheetExport — \"1.1\" dual-pool format", () => {
  it("accepts a well-formed 1.1 export with a global section", () => {
    const valid = {
      formatVersion: "1.1",
      headVersionId: "v1",
      versions: [makeVersion("v1")],
      globalHeadVersionId: "g1",
      globalVersions: [makeVersion("g1")],
    };
    expect(parseSheetExport(valid)).toEqual(valid);
  });

  it("rejects a 1.1 export missing globalHeadVersionId", () => {
    expect(() =>
      parseSheetExport({
        formatVersion: "1.1",
        headVersionId: "v1",
        versions: [makeVersion("v1")],
        globalVersions: [makeVersion("g1")],
      }),
    ).toThrow(/globalHeadVersionId/);
  });

  it("rejects a 1.1 export with a non-array globalVersions", () => {
    expect(() =>
      parseSheetExport({
        formatVersion: "1.1",
        headVersionId: "v1",
        versions: [makeVersion("v1")],
        globalHeadVersionId: "g1",
        globalVersions: "nope",
      }),
    ).toThrow(/globalVersions array/);
  });

  it("rejects a 1.1 export whose globalHeadVersionId matches nothing in globalVersions", () => {
    expect(() =>
      parseSheetExport({
        formatVersion: "1.1",
        headVersionId: "v1",
        versions: [makeVersion("v1")],
        globalHeadVersionId: "missing",
        globalVersions: [makeVersion("g1")],
      }),
    ).toThrow(/globalHeadVersionId does not match/);
  });

  it("still accepts a legacy 1.0 export with no global section at all", () => {
    const legacy = { formatVersion: "1.0", headVersionId: "v1", versions: [makeVersion("v1")] };
    expect(parseSheetExport(legacy)).toEqual(legacy);
  });
});
