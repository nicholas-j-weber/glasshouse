import { assert, mockApi, setApiKey, test, withFreshPage } from "./support.mjs";

// "Tokens consumed" starts at zero, increases by the
// real usage the (mocked) API reports after a call, accumulates across
// multiple calls, and "Context size" keeps behaving as the pre-existing
// live client-side estimate throughout — the two statistics are genuinely
// independent, not one replacing the other.
export async function run(browser, baseUrl) {
  let ok = true;

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");

    ok =
      (await test("Tokens consumed starts at 0 and Context size shows an estimate before any call", async () => {
        const stats = await page.locator(".token-stat").allTextContents();
        assert(stats.some((s) => s.includes("Tokens consumed: 0")), `expected zero tokens consumed initially, got ${JSON.stringify(stats)}`);
        assert(stats.some((s) => /Context size: ~\d+ tokens/.test(s)), `expected a Context size estimate, got ${JSON.stringify(stats)}`);
      })) && ok;

    const contextSizeBefore = await page.locator(".token-stat", { hasText: "Context size" }).textContent();

    await mockApi(page, () => ({
      text: `Reply.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"conversation_summary_update","body":"turn body"}]\n-->`,
      usage: { inputTokens: 111, outputTokens: 22 },
    }));

    ok =
      (await test("Tokens consumed increases by the real usage reported after a call", async () => {
        await page.fill(".chat-input-row textarea", "hello there");
        await page.click('.chat-pane .chat-input-row button[type="submit"]');
        await page.waitForTimeout(500);
        const stats = await page.locator(".token-stat").allTextContents();
        assert(stats.some((s) => s.includes("Tokens consumed: 133")), `expected 111+22=133 tokens consumed, got ${JSON.stringify(stats)}`);

        // the turn's conversation_summary_update auto-applies
        // the instant it's received — no manual accept needed for the
        // sheet to actually grow, which Context size must reflect.
      })) && ok;

    ok =
      (await test("Tokens consumed accumulates across multiple calls", async () => {
        await page.fill(".chat-input-row textarea", "another message");
        await page.click('.chat-pane .chat-input-row button[type="submit"]');
        await page.waitForTimeout(500);
        const stats = await page.locator(".token-stat").allTextContents();
        assert(stats.some((s) => s.includes("Tokens consumed: 266")), `expected 133+133=266 tokens consumed, got ${JSON.stringify(stats)}`);
      })) && ok;

    ok =
      (await test("Context size remains a live, distinct estimate — unaffected by cumulative Tokens consumed", async () => {
        const contextSizeAfter = await page.locator(".token-stat", { hasText: "Context size" }).textContent();
        assert(/Context size: ~\d+ tokens/.test(contextSizeAfter), `expected Context size to still be an estimate, got "${contextSizeAfter}"`);
        assert(contextSizeAfter !== contextSizeBefore, "Context size should reflect the sheet growing (new conversation summary entry), not stay frozen");
      })) && ok;

    ok =
      (await test("Context size has an explanatory tooltip distinguishing it from Tokens consumed", async () => {
        const title = await page.locator(".token-stat", { hasText: "Context size" }).getAttribute("title");
        assert(title && title.length > 0, "Context size should have a tooltip");
        const consumedTitle = await page.locator(".token-stat", { hasText: "Tokens consumed" }).getAttribute("title");
        assert(consumedTitle && consumedTitle.length > 0, "Tokens consumed should have a tooltip");
        assert(title !== consumedTitle, "the two tooltips should explain different things");
      })) && ok;

    ok =
      (await test("the Token Estimator collapses via its own edge handle, same mechanism as the side menus but vertical", async () => {
        assert(await page.locator(".token-estimator-title").textContent(), "title should be present and show its label");
        assert(await page.locator(".token-estimator-content").isVisible(), "drawer should start open");

        await page.click(".token-estimator-handle");
        assert(!(await page.locator(".token-estimator").isVisible()), "the whole box should be hidden once collapsed, not just its content");
        assert(await page.locator(".token-estimator-handle").isVisible(), "the handle should stay visible/reachable even while collapsed, like the sidebar handles");

        await page.click(".token-estimator-handle");
        assert(await page.locator(".token-estimator-content").isVisible(), "clicking the handle again should reopen the drawer");
      })) && ok;
  });

  return ok;
}
