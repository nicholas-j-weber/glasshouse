import { assert, setApiKey, test, withFreshPage } from "./support.mjs";

// a confirmed real bug — five checkboxes' worth of
// settings (plus their hint text, on top of the original API key/model
// fields) can now exceed a short viewport's height, and .modal had no
// max-height/overflow-y to scroll the rest into view. Reproduced live at
// 900x500 before fixing: the modal centered itself off both the top and
// bottom edges with nothing reachable to bring the cut-off parts back.
// Width bumped from the original 900 to 1100: 900 is below
// the new 1024px mobile-layout breakpoint, which now hides .chats-sidebar
// (and .sheet-switcher inside it) entirely — this test is about a *short*
// viewport, not a narrow one, so it needs to stay clear of that width
// threshold rather than get coverage of it by accident.
export async function run(browser, baseUrl) {
  let ok = true;

  await withFreshPage(browser, async (page) => {
    // A taller viewport first, purely so setApiKey's own Settings-modal
    // interaction (Close button) isn't itself affected by the short
    // viewport this test is specifically trying to reproduce.
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");

    await page.setViewportSize({ width: 1100, height: 500 });
    await page.click('button[aria-label="Settings"]');
    await page.waitForTimeout(200);

    ok = (await test("the Settings modal fits within a short viewport instead of overflowing it uncontrollably", async () => {
      const rect = await page.locator(".modal").evaluate((el) => el.getBoundingClientRect());
      assert(rect.top >= 0, "the modal's top (header/close button) should not sit above the viewport");
      assert(rect.bottom <= 500, "the modal's bottom should not extend past the viewport");
    })) && ok;

    ok = (await test("the header and close button stay visible even though the body is taller than the viewport", async () => {
      assert(await page.locator(".modal-header h2", { hasText: "Settings" }).isVisible(), "the header title should stay visible");
      assert(await page.locator('button[aria-label="Close settings"]').isVisible(), "the close button should stay reachable, not scrolled away with the content");
    })) && ok;

    ok = (await test("the last setting (previously cut off) is reachable by scrolling the body", async () => {
      const lastCheckbox = page.locator('input[aria-label="Collapse History entries by default"]');
      await lastCheckbox.scrollIntoViewIfNeeded();
      assert(await lastCheckbox.isVisible(), "the last checkbox should be reachable via scroll, not permanently cut off");
    })) && ok;
  });

  return ok;
}
