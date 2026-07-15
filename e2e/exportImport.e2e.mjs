import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addMemory, assert, createChat, setApiKey, showSheetPanelTab, test, withFreshPage } from "./support.mjs";

// Addendum U coverage: export/import round-trips both the local sheet and
// the global memory pool — verified through a real file download from one
// browser context and a real upload into a completely separate, empty one,
// since that's the actual thing §8.3 promises ("inspect your context
// outside the app") and jsdom/mocking can't meaningfully fake a real file.
export async function run(browser, baseUrl) {
  let ok = true;
  const tmpFile = path.join(os.tmpdir(), `context-sheets-e2e-export-${Date.now()}.json`);
  let exportedJson;

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");

    const memSection = page.locator(".sheet-section", { hasText: "Memories" }).first();
    await showSheetPanelTab(page, "memories");
    await addMemory(memSection, "Favorite Color", "Blue");
    await page.waitForTimeout(300);

    const toneSection = page.locator(".inline-field", { hasText: "Tone" }).first();
    await showSheetPanelTab(page, "chat");
    await toneSection.locator("textarea").fill("EXPORT_TEST_TONE");
    await toneSection.locator("button", { hasText: "Save" }).click();
    await page.waitForTimeout(300);

    ok = (await test("export produces a 1.1 file with both the local sheet and the global pool", async () => {
      const [download] = await Promise.all([page.waitForEvent("download"), page.click(".export-import-buttons button:has-text('Export')")]);
      const downloadPath = await download.path();
      exportedJson = JSON.parse(fs.readFileSync(downloadPath, "utf-8"));
      fs.writeFileSync(tmpFile, JSON.stringify(exportedJson));

      assert(exportedJson.formatVersion === "1.1", `expected formatVersion 1.1, got ${exportedJson.formatVersion}`);
      assert(Boolean(exportedJson.globalHeadVersionId && exportedJson.globalVersions), "expected a global section in the export");
      const globalHead = exportedJson.globalVersions.find((v) => v.id === exportedJson.globalHeadVersionId);
      assert(globalHead.sheet.memories.some((m) => m.body === "Blue"), "global section should contain the shared memory");
    })) && ok;
  });

  // A completely fresh, isolated browser context — no shared IndexedDB with
  // the export above — importing the file must reconstruct everything.
  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");

    const memSection = page.locator(".sheet-section", { hasText: "Memories" }).first();

    ok = (await test("a fresh install has no memory of the exported data before importing", async () => {
      assert(!(await memSection.locator(".memory-list").textContent()).includes("Favorite Color"), "fresh install must not already have the memory");
    })) && ok;

    ok = (await test("importing the file restores both the local Tone and the global memory", async () => {
      await page.setInputFiles("input[type=file]", tmpFile);
      await page.waitForTimeout(500);

      assert((await memSection.locator(".memory-list").textContent()).includes("Favorite Color"), "global memory should be restored");
      const toneSection = page.locator(".inline-field", { hasText: "Tone" }).first();
      assert((await toneSection.locator("textarea").inputValue()).includes("EXPORT_TEST_TONE"), "local tone should be restored");
    })) && ok;

    ok = (await test("the restored memory is visible on a brand-new sheet, proving it's genuinely global", async () => {
      await createChat(page, "Second Chat");
      await page.waitForTimeout(400);
      assert((await memSection.locator(".memory-list").textContent()).includes("Favorite Color"), "restored memory should be visible from a new sheet too");
    })) && ok;
  });

  // Addendum AV: the two blocks above always import into a totally fresh,
  // empty browser context — no shared IndexedDB with the export's source
  // sheet — which is exactly why this never caught the real reported bug:
  // db.ts's versions store keys id table-wide, not per sheetId, so
  // importing into a *different* chat while the *source* chat still exists
  // in the same database collided on every single version's id and threw
  // ConstraintError. This block reproduces that exact scenario in one
  // session instead.
  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");
    const sameSessionFile = path.join(os.tmpdir(), `context-sheets-e2e-export-same-session-${Date.now()}.json`);

    const toneSection = page.locator(".inline-field", { hasText: "Tone" }).first();
    await toneSection.locator("textarea").fill("SAME_SESSION_TONE");
    await toneSection.locator("button", { hasText: "Save" }).click();
    await page.waitForTimeout(300);

    const [download] = await Promise.all([page.waitForEvent("download"), page.click(".export-import-buttons button:has-text('Export')")]);
    fs.writeFileSync(sameSessionFile, fs.readFileSync(await download.path()));

    // Chat 1 (the export's source) stays right where it is — untouched,
    // still in the same IndexedDB — while a second, different chat is
    // created and the same file is imported into *that* one instead.
    await createChat(page, "Duplicate Target");
    await page.waitForTimeout(300);

    ok = (await test("importing an export into a different, still-existing chat in the same session doesn't throw ConstraintError (Addendum AV, fixes a confirmed real bug)", async () => {
      await page.setInputFiles("input[type=file]", sameSessionFile);
      await page.waitForTimeout(500);

      assert((await page.locator(".export-import-error").count()) === 0, "import should succeed, not surface a ConstraintError");
      const toneTextarea = page.locator(".inline-field", { hasText: "Tone" }).first().locator("textarea");
      assert((await toneTextarea.inputValue()).includes("SAME_SESSION_TONE"), "the new chat should now have the imported tone");
    })) && ok;

    ok = (await test("the original chat the file was exported from is completely unaffected", async () => {
      await page.locator(".sheet-switcher-name", { hasText: "Chat 1" }).click();
      await page.waitForTimeout(300);
      const toneTextarea = page.locator(".inline-field", { hasText: "Tone" }).first().locator("textarea");
      assert((await toneTextarea.inputValue()).includes("SAME_SESSION_TONE"), "the source chat should still have its own (identical-content, different-id) version intact");
    })) && ok;

    fs.rmSync(sameSessionFile, { force: true });
  });

  fs.rmSync(tmpFile, { force: true });
  return ok;
}
