import { assert, setApiKey, test, withFreshPage } from "./support.mjs";

// the app's first responsive rules. Below 1024px the
// always-visible Chats/Context sidebars are replaced by full-screen
// overlays triggered from new header buttons — this file exists because
// the original bug (375px rendering 658px wide, chat input unreachable;
// 768px crushing the chat column to ~130px with Send overlapping the
// input) was found via live measurement, not code review, so this uses
// real geometry (getBoundingClientRect/scrollWidth/getComputedStyle)
// rather than just checking classes are present, matching this suite's
// established practice (wordWrap.e2e.mjs, settingsModalScroll.e2e.mjs).
//
// Triggers are located by container (.app-header-left / .header-icon-
// buttons), not by aria-label — the label text itself flips between
// "Open chats"/"Close chats" depending on state, which is exactly what
// these tests are exercising, so matching on it would make the locator
// itself state-dependent.
export async function run(browser, baseUrl) {
  let ok = true;

  await withFreshPage(browser, async (page) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto(baseUrl);
    await page.waitForSelector(".chat-column");
    const chatsTrigger = page.locator(".app-header-left .mobile-nav-trigger");
    const contextTrigger = page.locator(".header-icon-buttons .mobile-nav-trigger");

    ok =
      (await test("no horizontal overflow at 375px, and the chat input is reachable", async () => {
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        assert(scrollWidth <= 375, `document should not overflow 375px, got ${scrollWidth}`);
        assert(await page.locator(".chat-input-row textarea").isVisible(), "the chat input should be reachable without horizontal scroll");
      })) && ok;

    ok =
      (await test("the desktop sidebars and edge handles are actually display: none at 375px, not just visually collapsed", async () => {
        assert((await page.locator(".chats-sidebar").evaluate((el) => getComputedStyle(el).display)) === "none", "chats-sidebar should be display: none");
        assert((await page.locator(".controls-sidebar").evaluate((el) => getComputedStyle(el).display)) === "none", "controls-sidebar should be display: none");
        assert(!(await page.locator(".chats-sidebar-handle").isVisible()), "the chats edge handle should not be visible");
        assert(!(await page.locator(".controls-sidebar-handle").isVisible()), "the controls edge handle should not be visible");
      })) && ok;

    ok =
      (await test("the mobile Chats/Context triggers are visible at 375px", async () => {
        assert(await chatsTrigger.isVisible(), "the Chats trigger should be visible");
        assert(await contextTrigger.isVisible(), "the Context trigger should be visible");
      })) && ok;

    ok =
      (await test("tapping Chats opens a full-viewport overlay with the chat list, Back closes it", async () => {
        await chatsTrigger.click();
        assert(await page.locator(".modal-overlay .sheet-switcher").isVisible(), "the chat list should be visible inside the overlay");
        assert((await chatsTrigger.getAttribute("aria-pressed")) === "true", "the trigger should report itself pressed while open");
        assert((await chatsTrigger.getAttribute("aria-label")) === "Close chats", "the trigger's label should flip to reflect its open state");

        const rect = await page.locator(".modal-overlay .mobile-panel").evaluate((el) => el.getBoundingClientRect());
        const headerRect = await page.locator(".app-header").evaluate((el) => el.getBoundingClientRect());
        assert(rect.top >= headerRect.bottom - 1, "the overlay should start at or below the header, not overlap it");

        await page.click('.modal-overlay button[aria-label="Back"]');
        assert((await page.locator(".modal-overlay").count()) === 0, "Back should close the overlay entirely");
        assert((await chatsTrigger.getAttribute("aria-label")) === "Open chats", "the trigger's label should flip back once closed");
      })) && ok;

    ok =
      (await test("tapping the Chats trigger again while open also closes it (toggle-close)", async () => {
        await chatsTrigger.click();
        assert(await page.locator(".modal-overlay").isVisible(), "sanity check: overlay should be open");
        await chatsTrigger.click();
        assert((await page.locator(".modal-overlay").count()) === 0, "re-tapping the active trigger should close the overlay");
        assert((await chatsTrigger.getAttribute("aria-pressed")) === "false", "the trigger should report itself unpressed once closed");
      })) && ok;

    ok =
      (await test("tapping Context opens a full-viewport overlay with its tabs reachable", async () => {
        await contextTrigger.click();
        // SheetPanel shows "Loading…" until its own first-mount async
        // IndexedDB read settles (same race ManageWithAIPanel has
        // elsewhere) — wait for the tabs rather than asserting immediately.
        await page.waitForSelector(".modal-overlay .sheet-panel-tabs");
        assert(await page.locator(".modal-overlay .sheet-panel-tabs").isVisible(), "the Context panel's tabs should be visible inside the overlay");
        assert(await page.locator(".modal-overlay .sheet-panel-tab", { hasText: "Memories" }).isVisible(), "the Memories tab should be reachable");
        assert((await contextTrigger.getAttribute("aria-pressed")) === "true", "the Context trigger should report itself pressed while open");
      })) && ok;

    ok =
      (await test("opening Chats while Context is open closes Context (mutual exclusion)", async () => {
        assert(await page.locator(".modal-overlay").isVisible(), "sanity check: Context overlay should still be open");
        await chatsTrigger.click();
        assert((await page.locator(".modal-overlay").count()) === 1, "exactly one overlay should be open");
        assert(await page.locator(".modal-overlay .sheet-switcher").isVisible(), "the open overlay should now be Chats");
        assert((await contextTrigger.getAttribute("aria-pressed")) === "false", "the Context trigger should no longer report itself pressed");
        await chatsTrigger.click();
      })) && ok;
  });

  await withFreshPage(browser, async (page) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto(baseUrl);
    await page.waitForSelector(".chat-column");
    await setApiKey(page, "sk-ant-fake-key");
    const chatsTrigger = page.locator(".app-header-left .mobile-nav-trigger");
    const contextTrigger = page.locator(".header-icon-buttons .mobile-nav-trigger");

    ok =
      (await test("Manage with AI opened from inside the mobile Context overlay hands off to the Chats overlay", async () => {
        await contextTrigger.click();
        await page.click('.modal-overlay button:has-text("Manage with AI")');

        assert((await page.locator(".modal-overlay .sheet-panel").count()) === 0, "the Context overlay's content should be gone after the hand-off");
        assert(await page.locator(".modal-overlay .manage-ai-panel").isVisible(), "ManageWithAIPanel should now be showing inside the Chats-slot overlay");
        assert((await chatsTrigger.getAttribute("aria-pressed")) === "true", "the Chats trigger should report itself pressed after the hand-off");
      })) && ok;

    ok =
      (await test("Escape steps back one level at a time: first to the Chats list, then closes the overlay", async () => {
        assert(await page.locator(".modal-overlay .manage-ai-panel").isVisible(), "sanity check: Manage with AI should still be open");

        await page.keyboard.press("Escape");
        assert((await page.locator(".modal-overlay").count()) === 1, "the first Escape should only back out of Manage with AI, not close the overlay");
        assert(await page.locator(".modal-overlay .sheet-switcher").isVisible(), "the first Escape should reveal the Chats list");

        await page.keyboard.press("Escape");
        assert((await page.locator(".modal-overlay").count()) === 0, "the second Escape should close the overlay entirely");
      })) && ok;
  });

  await withFreshPage(browser, async (page) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");

    ok =
      (await test("desktop widths show no regression: triggers hidden, sidebars and handles back to normal", async () => {
        assert(!(await page.locator(".app-header-left .mobile-nav-trigger").isVisible()), "the Chats trigger should not be visible at desktop widths");
        assert(!(await page.locator(".header-icon-buttons .mobile-nav-trigger").isVisible()), "the Context trigger should not be visible at desktop widths");

        const chatsWidth = await page.locator(".chats-sidebar").evaluate((el) => el.getBoundingClientRect().width);
        assert(Math.abs(chatsWidth - 250) < 1, `chats-sidebar should still measure ~250px wide, got ${chatsWidth}`);
        assert(await page.locator(".chats-sidebar-handle").isVisible(), "the edge handle should still be visible at desktop widths");
      })) && ok;
  });

  return ok;
}
