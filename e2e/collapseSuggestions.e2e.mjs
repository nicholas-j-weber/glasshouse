import { assert, mockApi, setApiKey, setAutoApply, setCollapseSuggestionsByDefault, test, withFreshPage } from "./support.mjs";

// Addendum AC coverage: every chat message's suggestions block sits behind
// a "N changes" disclosure toggle — expanded by default (matching every
// prior addendum's shipped behavior), a global Settings toggle to start
// collapsed instead, and a per-message override that always wins regardless
// of that default.
export async function run(browser, baseUrl) {
  let ok = true;

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");
    await mockApi(page, () => ({
      text: `Got it.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"new_memory","label":"Pet","body":"A cat named Milo"},{"type":"conversation_summary_update","body":"turn one"}]\n-->`,
    }));

    ok = (await test("the collapse-suggestions setting defaults to off, and messages start expanded", async () => {
      await page.click('button[aria-label="Settings"]');
      assert(!(await page.locator('input[aria-label="Collapse suggestion details by default"]').isChecked()), "should default to unchecked/off");
      await page.click('button[aria-label="Close settings"]');

      await page.fill(".chat-input-row textarea", "I have a cat named Milo");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(400);

      const toggle = page.locator(".chat-suggestions-toggle");
      assert(await toggle.isVisible(), "the disclosure toggle should be visible");
      assert((await toggle.textContent()).includes("2 changes"), "the toggle should count both suggestions in the message");
      assert(await page.locator(".chat-applied-list").isVisible(), "content should be visible (expanded) by default");
    })) && ok;

    ok = (await test("clicking the toggle collapses the block, hiding its content", async () => {
      await page.click(".chat-suggestions-toggle");
      await page.waitForTimeout(150);
      assert((await page.locator(".chat-applied-list").count()) === 0, "content should be removed from the DOM once collapsed");
      assert(await page.locator(".chat-suggestions-toggle").isVisible(), "the toggle itself should remain visible even while collapsed");
    })) && ok;

    ok = (await test("clicking it again re-expands the block", async () => {
      await page.click(".chat-suggestions-toggle");
      await page.waitForTimeout(150);
      assert(await page.locator(".chat-applied-list").isVisible(), "content should reappear once re-expanded");
    })) && ok;
  });

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");
    await setCollapseSuggestionsByDefault(page, true);
    await mockApi(page, () => ({
      text: `Noted.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"new_memory","label":"Fact","body":"a detail"},{"type":"conversation_summary_update","body":"turn one"}]\n-->`,
    }));

    ok = (await test("with the global setting on, a new message's suggestions start collapsed", async () => {
      await page.fill(".chat-input-row textarea", "remember this detail");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(400);

      assert((await page.locator(".chat-applied-list").count()) === 0, "content should start hidden when the global default is on");
      assert(await page.locator(".chat-suggestions-toggle", { hasText: "2 changes" }).isVisible(), "the toggle should still show the count while collapsed");
    })) && ok;

    ok = (await test("a per-message expand overrides the global collapsed-by-default setting", async () => {
      await page.click(".chat-suggestions-toggle");
      await page.waitForTimeout(150);
      assert(await page.locator(".chat-applied-list").isVisible(), "manually expanding this one message should work even though the global default is collapsed");
    })) && ok;
  });

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");
    await setAutoApply(page, false);
    await setCollapseSuggestionsByDefault(page, true);
    await mockApi(page, () => ({
      text: `Sure.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"tone_update","body":"too formal"},{"type":"conversation_summary_update","body":"turn one"}]\n-->`,
    }));

    ok = (await test("a message with a card actively being revised stays expanded regardless of the collapsed-by-default setting", async () => {
      await page.fill(".chat-input-row textarea", "adjust the tone");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(400);

      // Collapsed by default (setting is on) — confirm that first.
      assert((await page.locator(".change-card").count()) === 0, "sanity check: pending cards should start hidden under the collapsed-by-default setting");

      await page.click(".chat-suggestions-toggle");
      await page.waitForTimeout(150);
      const card = page.locator(".chat-pane:not(.chat-pane--embedded) .change-card", { hasText: "too formal" });
      await card.locator(".revise-with-ai-button").click();

      // Re-collapse the block via its own toggle — it shouldn't actually
      // hide anything while this message's card is mid-revision.
      await page.click(".chat-suggestions-toggle");
      await page.waitForTimeout(150);
      assert(await card.isVisible(), "the actively-revising card must stay visible even if the block's toggle is clicked closed");
    })) && ok;
  });

  return ok;
}
