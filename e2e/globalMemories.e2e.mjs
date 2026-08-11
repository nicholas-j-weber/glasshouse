import { addMemory, assert, closeContext, createChat, mockApi, openHistory, setApiKey, showSheetPanelTab, test, withFreshPage } from "./support.mjs";

// ordinary memories are shared across every sheet;
// Tone and Conversation Summary stay per-sheet; edits/deletes from any
// sheet propagate to the shared pool; reverting a sheet's local history
// never touches the global pool; deactivate/reorder stay overlay-only; and
// an edit_memory suggestion targeting an unknown id fails visibly.
//
// chat-mode suggestions now auto-apply (no manual
// Accept click) — this file also covers new_memory auto-applying with a
// toast, Undo actually reverting it, and a failed suggestion still failing
// visibly (now via a toast instead of a status badge on a pending card).
export async function run(browser, baseUrl) {
  let ok = true;

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");
    await mockApi(page, () => `Reply.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"conversation_summary_update","body":"local turn body"}]\n-->`);

    const memSection = () => page.locator(".sheet-section", { hasText: "Memories" }).first();
    const toneSection = () => page.locator(".inline-field", { hasText: "Tone" }).first();
    const convoSection = () => page.locator(".sheet-section", { hasText: "Conversation Summary" }).first();

    ok = (await test("an ordinary memory added on Chat 1 is visible on a newly-created Chat 2", async () => {
      await showSheetPanelTab(page, "memories");
      await addMemory(memSection(), "Favorite Color", "Blue");
      await page.waitForTimeout(300);

      await showSheetPanelTab(page, "chat");
      await toneSection().locator("textarea").fill("SHEET1_DISTINCTIVE_TONE");
      await toneSection().locator("button", { hasText: "Save" }).click();
      await page.waitForTimeout(300);

      // Context is a full app-body takeover at every width now (not a
      // sidebar) — close it to reach the chat input and the chats sidebar
      // underneath.
      await closeContext(page);
      await page.fill(".chat-input-row textarea", "hello from sheet 1");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(500); // conversation_summary_update auto-applies now — no accept click needed

      await createChat(page, "Chat Two");
      await page.waitForTimeout(400);

      await showSheetPanelTab(page, "memories");
      assert((await memSection().locator(".memory-list").textContent()).includes("Favorite Color"), "global memory should be visible on Chat 2");
    })) && ok;

    ok = (await test("Tone and Conversation Summary stay independent per sheet", async () => {
      await showSheetPanelTab(page, "chat");
      assert(!(await toneSection().locator("textarea").inputValue()).includes("SHEET1_DISTINCTIVE_TONE"), "Chat 2's tone must not be Chat 1's");
      assert(!(await convoSection().textContent()).includes("local turn body"), "Chat 1's conversation turn must not leak into Chat 2");
    })) && ok;

    ok = (await test("editing the shared memory from Chat 2 is reflected back on Chat 1", async () => {
      await showSheetPanelTab(page, "memories");
      await memSection().locator('.memory-row button[aria-label="Edit"]').click();
      await memSection().locator(".memory-row--editing textarea").fill("Teal");
      await memSection().locator(".memory-row--editing button", { hasText: "Save" }).click();
      await page.waitForTimeout(400);

      await closeContext(page);
      await page.locator(".sheet-switcher-name", { hasText: "Chat 1" }).click();
      await page.waitForTimeout(400);

      await showSheetPanelTab(page, "memories");
      assert((await memSection().locator(".memory-list").textContent()).includes("Teal"), "Chat 1 should see the edit made from Chat 2");
      await showSheetPanelTab(page, "chat");
      assert((await toneSection().locator("textarea").inputValue()).includes("SHEET1_DISTINCTIVE_TONE"), "Chat 1's own tone must be untouched");
      assert((await convoSection().textContent()).includes("local turn body"), "Chat 1's own turn must be untouched");
    })) && ok;

    ok = (await test("deleting the shared memory from Chat 1 removes it from Chat 2 too", async () => {
      await showSheetPanelTab(page, "memories");
      await memSection().locator('.memory-row button[aria-label="Delete"]').click();
      await page.waitForTimeout(400);
      await closeContext(page);
      await page.locator(".sheet-switcher-name", { hasText: "Chat Two" }).click();
      await page.waitForTimeout(400);
      await showSheetPanelTab(page, "memories");
      assert(!(await memSection().locator(".memory-list").textContent()).includes("Teal"), "deleted global memory must be gone everywhere");
    })) && ok;

    ok = (await test("reverting a sheet's local history does not touch the global memory pool", async () => {
      await showSheetPanelTab(page, "memories");
      await addMemory(memSection(), "Persisted Fact", "stays put");
      await page.waitForTimeout(400);

      await showSheetPanelTab(page, "chat");
      const notesSection = page.locator(".inline-field", { hasText: "Freeform Notes" }).first();
      await notesSection.locator("textarea").fill("some local note");
      await notesSection.locator("button", { hasText: "Save" }).click();
      await page.waitForTimeout(400);

      // History moved out to its own header button/modal — independent of
      // Context, reachable regardless of whether Context is open or closed.
      await openHistory(page);
      const revertButtons = page.locator(".modal--history .version-row button:has-text('Revert to here')");
      assert((await revertButtons.count()) > 0, "expected at least one revertable local version");
      await revertButtons.first().click();
      await page.waitForTimeout(400);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);

      await showSheetPanelTab(page, "memories");
      assert((await memSection().locator(".memory-list").textContent()).includes("Persisted Fact"), "global memory must survive a local revert");
    })) && ok;
  });

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");

    let callCount = 0;
    await mockApi(page, () => {
      callCount++;
      if (callCount === 1) {
        return `Reply.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"conversation_summary_update","body":"turn"},{"type":"edit_memory","memoryId":"does-not-exist","label":"X","body":"Y"}]\n-->`;
      }
      return "ok";
    });

    ok = (await test("deactivating a memory manually is a session-only overlay toggle", async () => {
      await showSheetPanelTab(page, "memories");
      const memSection = page.locator(".sheet-section", { hasText: "Memories" }).first();
      await addMemory(memSection, "Deactivate Me", "body");
      await page.waitForTimeout(300);

      const row = memSection.locator(".memory-row", { hasText: "Deactivate Me" });
      await row.locator("input[type=checkbox]").uncheck();
      await page.waitForTimeout(200);
      assert(await row.evaluate((el) => el.classList.contains("memory-row--inactive")), "memory should show as inactive");
    })) && ok;

    ok = (await test("Pin toggles a memory, with the button itself signaling current state", async () => {
      const memSection = page.locator(".sheet-section", { hasText: "Memories" }).first();
      await addMemory(memSection, "Pin Me", "body");
      await page.waitForTimeout(300);

      const row = memSection.locator(".memory-row", { hasText: "Pin Me" });
      const pinButton = row.locator('button[aria-label="Pin"]');
      assert(await pinButton.isVisible(), "an unpinned memory's button should be labeled Pin");
      assert(!(await pinButton.evaluate((el) => el.classList.contains("icon-button--active"))), "an unpinned memory's Pin button should not look active");
      const unpinnedBorderColor = await pinButton.evaluate((el) => getComputedStyle(el).borderColor);

      await pinButton.click();
      await page.waitForTimeout(200);

      const unpinButton = row.locator('button[aria-label="Unpin"]');
      assert(await unpinButton.isVisible(), "clicking Pin should relabel the same button to Unpin");
      assert(await unpinButton.evaluate((el) => el.classList.contains("icon-button--active")), "a pinned memory's button should visibly look active — the glyph itself doesn't change");
      // class presence alone isn't proof the CSS actually took
      // effect — .memory-row-actions button's higher-specificity border
      // shorthand silently swallowed .icon-button--active's border-color
      // the first time this shipped, with the class correctly applied the
      // whole time. Checking the real computed color is what would have
      // caught that.
      const pinnedBorderColor = await unpinButton.evaluate((el) => getComputedStyle(el).borderColor);
      assert(pinnedBorderColor !== unpinnedBorderColor, "the pinned button's border color should actually differ, not just carry an inert class");

      await unpinButton.click();
      await page.waitForTimeout(200);
      assert(await row.locator('button[aria-label="Pin"]').isVisible(), "clicking Unpin should relabel it back to Pin");
    })) && ok;

    ok = (await test("an edit_memory suggestion targeting an unknown id fails visibly, not silently", async () => {
      await closeContext(page); // Context was left open from the previous test
      await page.fill(".chat-input-row textarea", "hi");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(500);

      // Both suggestions auto-apply immediately. The valid
      // turn succeeds silently (conversation_summary_update never gets a
      // toast — see suggestionSession.ts's toastTextFor); the bad
      // edit_memory fails visibly, now via a toast instead of a status
      // badge on a pending card. There's no separate permanent transcript
      // record anymore (SuggestionSessionView's old inline "applied" list
      // was removed — Context/History are the durable record now, the
      // toast is just the moment-of announcement).
      assert(await page.locator(".toast--failed").isVisible(), "a suggestion targeting an unknown id should fail visibly via a toast");
      assert((await page.locator(".toast--applied").count()) === 0, "the failed suggestion shouldn't also show a success toast");

      await showSheetPanelTab(page, "chat");
      const convoSection = page.locator(".sheet-section", { hasText: "Conversation Summary" }).first();
      assert((await convoSection.textContent()).includes("turn"), "the valid conversation_summary_update in the same batch should still have applied");
    })) && ok;
  });

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");
    await mockApi(page, () => `<!-- SHEET_SUGGESTIONS\n[{"type":"new_memory","label":"Pet","body":"A cat named Milo"}]\n-->`);

    const memSection = () => page.locator(".sheet-section", { hasText: "Memories" }).first();

    ok = (await test("a new_memory suggestion auto-applies immediately, with a toast", async () => {
      await page.fill(".chat-input-row textarea", "remember my pet");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(400);

      // Checked with Context closed — the toast lives in the chat column,
      // which a full app-body takeover Context overlay would sit on top of.
      const toast = page.locator(".toast--applied", { hasText: "Pet" });
      assert(await toast.isVisible(), "an applied new_memory should announce itself via a toast");
      assert(await toast.locator('button[aria-label="Undo"]').isVisible(), "the toast should offer Undo while it's showing");

      // Applied immediately — no accept click anywhere in this test.
      await showSheetPanelTab(page, "memories");
      assert((await memSection().locator(".memory-list").textContent()).includes("A cat named Milo"), "the memory should already be added with no manual accept step");
      await closeContext(page);
    })) && ok;

    ok = (await test("clicking Undo on a toast reverts the auto-applied memory", async () => {
      const toast = page.locator(".toast--applied", { hasText: "Pet" });
      await toast.locator('button[aria-label="Undo"]').click();
      await page.waitForTimeout(300);

      assert((await page.locator(".toast--applied").count()) === 0, "the toast should dismiss itself once undone");
      await showSheetPanelTab(page, "memories");
      assert(!(await memSection().locator(".memory-list").textContent()).includes("A cat named Milo"), "Undo should actually revert the memory, not just hide the toast");
    })) && ok;
  });

  return ok;
}
