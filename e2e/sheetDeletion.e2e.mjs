import { assert, closeContext, createChat, openContext, setApiKey, test, withFreshPage } from "./support.mjs";

// Cascade-delete edge cases — deleting the only
// sheet, and deleting the currently active sheet with others remaining.
// Both must fall back to a working state, never leave the app with zero
// sheets to operate on.
export async function run(browser, baseUrl) {
  let ok = true;

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");

    ok = (await test("deleting the only sheet auto-recreates a fresh default", async () => {
      await page.locator(".sheet-switcher-item").first().locator('button[aria-label^="Delete"]').click();
      await page.waitForTimeout(400);
      assert((await page.locator(".sheet-switcher-item").count()) === 1, "expected exactly one sheet to remain (a fresh default)");
      assert(await page.locator(".chat-input-row textarea").isVisible(), "app should still be functional, not stuck loading");
      await openContext(page);
      assert(await page.locator(".sheet-panel").isVisible(), "Context/SheetPanel should be reachable for the fresh default sheet too");
      await closeContext(page); // next test needs the chats sidebar reachable again
    })) && ok;

    ok = (await test("deleting the active sheet falls back to another remaining sheet", async () => {
      await createChat(page, "Second");
      await page.waitForTimeout(300);
      const activeBefore = await page.locator(".sheet-switcher-item--active .sheet-switcher-name").textContent();
      assert(activeBefore === "Second", `expected the newly created sheet to be active, got "${activeBefore}"`);

      await page.locator(".sheet-switcher-item--active").locator('button[aria-label^="Delete"]').click();
      await page.waitForTimeout(400);

      assert((await page.locator(".sheet-switcher-item").count()) === 1, "expected one sheet to remain");
      const activeAfter = await page.locator(".sheet-switcher-item--active .sheet-switcher-name").textContent();
      assert(activeAfter !== "Second", "active sheet must have fallen back away from the deleted one");
    })) && ok;
  });

  return ok;
}
