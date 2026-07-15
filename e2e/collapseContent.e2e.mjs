import {
  assert,
  mockApi,
  setApiKey,
  setCollapseHistoryByDefault,
  setCollapseTurnsByDefault,
  showSheetPanelTab,
  test,
  withFreshPage,
} from "./support.mjs";

// Addendum AR coverage: two independent collapse-by-default toggles (both
// off by default) — This Chat's turn/summary rows collapse to one
// ellipsized line, and History's per-version diff-line list collapses to a
// "N changes" count — each with a per-item override that always wins over
// the global default, mirroring Addendum AC's collapse-suggestions pattern.
export async function run(browser, baseUrl) {
  let ok = true;

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");

    ok = (await test("both collapse-by-default settings default to off", async () => {
      await page.click('button[aria-label="Settings"]');
      assert(
        !(await page.locator('input[aria-label="Collapse conversation turns and summaries by default"]').isChecked()),
        "This Chat collapse-by-default should default to unchecked/off",
      );
      assert(
        !(await page.locator('input[aria-label="Collapse History entries by default"]').isChecked()),
        "History collapse-by-default should default to unchecked/off",
      );
      await page.click('button[aria-label="Close settings"]');
    })) && ok;

    ok = (await test("a conversation turn starts expanded, and its own toggle collapses/expands it", async () => {
      await mockApi(page, () => `ok.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"conversation_summary_update","body":"User asked something. AI replied with a fairly long explanation covering several points in detail."}]\n-->`);
      await page.fill(".chat-input-row textarea", "hello");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(400);

      const turnRow = page.locator(".memory-row", { hasText: "User asked something" }).first();
      const body = turnRow.locator(".memory-row-body");
      assert(!(await body.evaluate((el) => el.classList.contains("memory-row-body--collapsed"))), "should start expanded (setting is off)");

      await turnRow.locator(".memory-row-collapse-toggle").click();
      await page.waitForTimeout(150);
      assert(await body.evaluate((el) => el.classList.contains("memory-row-body--collapsed")), "clicking the toggle should collapse this row");

      await turnRow.locator(".memory-row-collapse-toggle").click();
      await page.waitForTimeout(150);
      assert(!(await body.evaluate((el) => el.classList.contains("memory-row-body--collapsed"))), "clicking it again should re-expand");
    })) && ok;

    ok = (await test("an AI-created summary can be collapsed the same way, independent of turns", async () => {
      // Addendum AX: summaries are AI-generated only now — the manual "Add
      // summary" form was removed as redundant with "Add entry"/"Add
      // memory". A second turn, compressed on its own, produces one here.
      await mockApi(page, () => `ok.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"conversation_summary_update","body":"A second turn to compress."}]\n-->`);
      await page.fill(".chat-input-row textarea", "hello2");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(400);

      let secondTurnId;
      await page.click(".manage-ai-trigger");
      await mockApi(page, (reqBody) => {
        secondTurnId = reqBody.system.match(/A second turn to compress\. \(id: ([a-f0-9-]+)\)/)[1];
        return { text: `<!-- SHEET_SUGGESTIONS\n[{"type":"compress_conversation","body":"A condensed digest of earlier turns.","turnIds":["${secondTurnId}"]}]\n-->` };
      });
      await page.fill(".manage-ai-input-row textarea", "compress the second turn only");
      await page.click(".manage-ai-go");
      await page.waitForTimeout(400);
      await page.locator(".change-card").locator('button[aria-label="Accept"]').click();
      await page.waitForTimeout(400);
      await page.click(".manage-ai-back");
      await showSheetPanelTab(page, "chat");
      await page.waitForTimeout(200);

      const summaryRow = page.locator(".conversation-summary-digest");
      const body = summaryRow.locator(".memory-row-body");
      assert(!(await body.evaluate((el) => el.classList.contains("memory-row-body--collapsed"))), "the summary should start expanded too");

      await summaryRow.locator(".memory-row-collapse-toggle").click();
      await page.waitForTimeout(150);
      assert(await body.evaluate((el) => el.classList.contains("memory-row-body--collapsed")), "the summary's own toggle should collapse just itself");

      const turnBody = page.locator(".memory-row", { hasText: "User asked something" }).first().locator(".memory-row-body");
      assert(!(await turnBody.evaluate((el) => el.classList.contains("memory-row-body--collapsed"))), "collapsing the summary should not affect the first (untouched) turn's own state");
    })) && ok;
  });

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");
    await mockApi(page, () => `ok.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"conversation_summary_update","body":"An existing turn on screen."}]\n-->`);
    await page.fill(".chat-input-row textarea", "hello");
    await page.click('.chat-pane .chat-input-row button[type="submit"]');
    await page.waitForTimeout(400);

    ok = (await test("turning the This Chat setting on live-collapses a turn already on screen", async () => {
      const body = page.locator(".memory-row", { hasText: "An existing turn on screen" }).locator(".memory-row-body");
      assert(!(await body.evaluate((el) => el.classList.contains("memory-row-body--collapsed"))), "sanity check: starts expanded");

      await setCollapseTurnsByDefault(page, true);
      assert(await body.evaluate((el) => el.classList.contains("memory-row-body--collapsed")), "flipping the global default should visibly collapse a row already on screen, not just future ones");
    })) && ok;

    ok = (await test("a per-row expand override wins over the collapsed-by-default global setting", async () => {
      const turnRow = page.locator(".memory-row", { hasText: "An existing turn on screen" });
      await turnRow.locator(".memory-row-collapse-toggle").click();
      await page.waitForTimeout(150);
      assert(
        !(await turnRow.locator(".memory-row-body").evaluate((el) => el.classList.contains("memory-row-body--collapsed"))),
        "manually expanding this one row should work even though the global default is collapsed",
      );
    })) && ok;
  });

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");
    await mockApi(page, () => `ok.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"conversation_summary_update","body":"first turn"}]\n-->`);
    await page.fill(".chat-input-row textarea", "hello");
    await page.click('.chat-pane .chat-input-row button[type="submit"]');
    await page.waitForTimeout(400);
    await showSheetPanelTab(page, "history");
    await page.waitForTimeout(200);

    ok = (await test("a History entry's diff list starts expanded, and its own toggle collapses it", async () => {
      const versionRow = page.locator(".version-row").first();
      assert(await versionRow.locator(".version-diff").isVisible(), "should start expanded (setting is off)");
      assert((await versionRow.locator(".version-diff-toggle").textContent()).includes("1 change"), "the toggle should show the count");

      await versionRow.locator(".version-diff-toggle").click();
      await page.waitForTimeout(150);
      assert((await versionRow.locator(".version-diff").count()) === 0, "clicking the toggle should collapse this entry's diff list");
    })) && ok;
  });

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");
    await mockApi(page, () => `ok.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"conversation_summary_update","body":"first turn"}]\n-->`);
    await page.fill(".chat-input-row textarea", "hello");
    await page.click('.chat-pane .chat-input-row button[type="submit"]');
    await page.waitForTimeout(400);
    await showSheetPanelTab(page, "history");
    await page.waitForTimeout(200);

    ok = (await test("clicking a History entry's toggle a second time re-expands it, and no override means the global default still applies", async () => {
      const versionRow = page.locator(".version-row").first();
      await versionRow.locator(".version-diff-toggle").click();
      await page.waitForTimeout(150);
      assert((await versionRow.locator(".version-diff").count()) === 0, "first click collapses");
      await versionRow.locator(".version-diff-toggle").click();
      await page.waitForTimeout(150);
      assert(await versionRow.locator(".version-diff").isVisible(), "second click re-expands");
    })) && ok;
  });

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");
    await mockApi(page, () => `ok.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"conversation_summary_update","body":"first turn"}]\n-->`);
    await page.fill(".chat-input-row textarea", "hello");
    await page.click('.chat-pane .chat-input-row button[type="submit"]');
    await page.waitForTimeout(400);
    await showSheetPanelTab(page, "history");
    await page.waitForTimeout(200);

    ok = (await test("turning the History setting on live-collapses an entry already on screen", async () => {
      const versionRow = page.locator(".version-row").first();
      await setCollapseHistoryByDefault(page, true);
      assert((await versionRow.locator(".version-diff").count()) === 0, "flipping the global default should visibly collapse an entry already on screen");
    })) && ok;
  });

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");

    ok = (await test("a deactivated conversation turn starts collapsed by default, even with the global setting off (Addendum AT)", async () => {
      await mockApi(page, () => `ok.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"conversation_summary_update","body":"A turn about to be compressed away."}]\n-->`);
      await page.fill(".chat-input-row textarea", "hello");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(400);

      const turnRow = page.locator(".memory-row", { hasText: "A turn about to be compressed away" });
      assert(
        !(await turnRow.locator(".memory-row-body").evaluate((el) => el.classList.contains("memory-row-body--collapsed"))),
        "sanity check: an active turn should still start expanded — the setting is off",
      );

      // compress_conversation's deactivation is the only path that
      // permanently flips active: false (a manual checkbox toggle is
      // session-only overlay, §4.2) — accept one to get a real inactive turn.
      let turnIds = [];
      await page.click(".manage-ai-trigger");
      await mockApi(page, (body) => {
        turnIds = [...body.system.matchAll(/\(id: ([a-f0-9-]+)\)/g)].map((m) => m[1]);
        return { text: `<!-- SHEET_SUGGESTIONS\n[{"type":"compress_conversation","body":"Digest.","turnIds":${JSON.stringify(turnIds)}}]\n-->` };
      });
      await page.fill(".manage-ai-input-row textarea", "compress");
      await page.click(".manage-ai-go");
      await page.waitForTimeout(400);
      await page.locator(".change-card").locator('button[aria-label="Accept"]').click();
      await page.waitForTimeout(400);
      await page.click(".manage-ai-back");
      await page.waitForTimeout(200);

      const body = turnRow.locator(".memory-row-body");
      assert(await body.evaluate((el) => el.classList.contains("memory-row-body--collapsed")), "a newly-deactivated turn should start collapsed automatically, with no click needed");

      const summaryBody = page.locator(".conversation-summary-digest").locator(".memory-row-body");
      assert(
        !(await summaryBody.evaluate((el) => el.classList.contains("memory-row-body--collapsed"))),
        "the new active summary should not be affected by the inactive-turn default",
      );
    })) && ok;

    ok = (await test("a per-row expand override still wins even for an inactive turn", async () => {
      const turnRow = page.locator(".memory-row", { hasText: "A turn about to be compressed away" });
      await turnRow.locator(".memory-row-collapse-toggle").click();
      await page.waitForTimeout(150);
      assert(
        !(await turnRow.locator(".memory-row-body").evaluate((el) => el.classList.contains("memory-row-body--collapsed"))),
        "manually expanding an inactive turn should work despite its own collapsed-by-default treatment",
      );
    })) && ok;
  });

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");
    await mockApi(page, () => `ok.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"conversation_summary_update","body":"turn one"}]\n-->`);
    await page.fill(".chat-input-row textarea", "hello");
    await page.click('.chat-pane .chat-input-row button[type="submit"]');
    await page.waitForTimeout(400);
    await showSheetPanelTab(page, "history");
    await page.waitForTimeout(200);

    // Addendum AZ: a confirmed real bug — with the diff list collapsed, the
    // "N changes" toggle and "Revert to here" sat directly against each
    // other with 0px between them.
    ok = (await test("there's visible vertical space between the collapsed diff toggle and Revert to here", async () => {
      const nonHeadRow = page.locator(".version-row:not(.version-row--head)").first();
      await nonHeadRow.locator(".version-diff-toggle").click();
      await page.waitForTimeout(150);

      const toggleBox = await nonHeadRow.locator(".version-diff-toggle").boundingBox();
      const revertBox = await nonHeadRow.locator("button", { hasText: "Revert to here" }).boundingBox();
      const gap = revertBox.y - (toggleBox.y + toggleBox.height);
      assert(gap >= 4, `expected a visible gap between the toggle and Revert to here, got ${gap}px`);
    })) && ok;
  });

  return ok;
}
