import { assert, setApiKey, test, withFreshPage } from "./support.mjs";

// the app's first responsive rules. Below 1024px the
// always-visible Chats sidebar is replaced by a full-screen overlay
// triggered from a header button, and Context/History/Library/Settings
// collapse into a single ☰ dropdown (App.css's 1024px breakpoint) — this
// file exists because the original bug (375px rendering 658px wide, chat
// input unreachable; 768px crushing the chat column to ~130px with Send
// overlapping the input) was found via live measurement, not code review,
// so this uses real geometry (getBoundingClientRect/scrollWidth/
// getComputedStyle) rather than just checking classes are present,
// matching this suite's established practice (wordWrap.e2e.mjs,
// settingsModalScroll.e2e.mjs).
//
// The Chats trigger is located by container (.app-header-left), not by
// aria-label — the label text itself flips between "Open chats"/"Close
// chats" depending on state, which is exactly what these tests are
// exercising, so matching on it would make the locator itself
// state-dependent. Context/History/Library/Settings, once the hamburger
// reveals them, are located by their own stable selectors
// (.context-trigger, aria-label) since — unlike Chats — none of those
// flip their own identifying attribute based on open/closed state.
export async function run(browser, baseUrl) {
  let ok = true;

  await withFreshPage(browser, async (page) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto(baseUrl);
    await page.waitForSelector(".chat-column");
    const chatsTrigger = page.locator(".app-header-left .mobile-nav-trigger");
    const hamburger = page.locator(".header-menu-trigger");

    ok =
      (await test("no horizontal overflow at 375px, and the chat input is reachable", async () => {
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        assert(scrollWidth <= 375, `document should not overflow 375px, got ${scrollWidth}`);
        assert(await page.locator(".chat-input-row textarea").isVisible(), "the chat input should be reachable without horizontal scroll");
      })) && ok;

    ok =
      (await test("the chats sidebar and its edge handle are actually display: none at 375px, not just visually collapsed", async () => {
        assert((await page.locator(".chats-sidebar").evaluate((el) => getComputedStyle(el).display)) === "none", "chats-sidebar should be display: none");
        assert(!(await page.locator(".chats-sidebar-handle").isVisible()), "the chats edge handle should not be visible");
      })) && ok;

    ok =
      (await test("the mobile Chats trigger and the hamburger are visible at 375px; the header-menu row itself is not", async () => {
        assert(await chatsTrigger.isVisible(), "the Chats trigger should be visible");
        assert(await hamburger.isVisible(), "the hamburger trigger should be visible");
        assert(!(await page.locator(".header-menu").isVisible()), "the Context/History/Library/Settings row should stay hidden until the hamburger is tapped");
      })) && ok;

    ok =
      (await test("tapping the hamburger reveals Context/History/Library/Settings, each with a text label", async () => {
        await hamburger.click();
        assert(await page.locator(".header-menu.header-menu--open").isVisible(), "the dropdown should open");
        assert((await hamburger.getAttribute("aria-expanded")) === "true", "the hamburger should report itself expanded");

        for (const label of ["Context", "History", "Library", "Settings"]) {
          assert(await page.locator(".header-menu", { hasText: label }).isVisible(), `${label} should be reachable inside the dropdown`);
        }
        // Icon-only on desktop, labeled here — a vertical stacked list
        // reads far less clearly icon-only than a horizontal toolbar does.
        assert(await page.locator(".header-menu .header-menu-item-label", { hasText: "History" }).isVisible(), "non-Context items should show a text label, not just an icon");
      })) && ok;

    ok =
      (await test("Escape closes the hamburger dropdown", async () => {
        assert(await page.locator(".header-menu--open").isVisible(), "sanity check: dropdown should still be open");
        await page.keyboard.press("Escape");
        assert((await page.locator(".header-menu--open").count()) === 0, "Escape should close the dropdown");
        assert((await hamburger.getAttribute("aria-expanded")) === "false", "the hamburger should report itself collapsed again");
      })) && ok;

    ok =
      (await test("clicking outside the dropdown closes it", async () => {
        await hamburger.click();
        assert(await page.locator(".header-menu--open").isVisible(), "sanity check: dropdown should be open");
        await page.mouse.click(10, 400); // well outside the header, inside the chat column
        assert((await page.locator(".header-menu--open").count()) === 0, "clicking outside should close the dropdown");
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
      (await test("tapping Context (via the hamburger) opens a full-viewport overlay with its tabs reachable", async () => {
        await hamburger.click();
        await page.click(".header-menu .context-trigger");
        // The dropdown should close as soon as an item inside it is picked
        // — Context/History/Library/Settings' own onClick handlers each
        // close it explicitly, same as a native menu.
        assert((await page.locator(".header-menu--open").count()) === 0, "picking an item should close the dropdown");
        // SheetPanel shows "Loading…" until its own first-mount async
        // IndexedDB read settles (same race ManageWithAIPanel has
        // elsewhere) — wait for the tabs rather than asserting immediately.
        await page.waitForSelector(".modal-overlay .sheet-panel-tabs");
        assert(await page.locator(".modal-overlay .sheet-panel-tabs").isVisible(), "the Context panel's tabs should be visible inside the overlay");
        assert(await page.locator(".modal-overlay .sheet-panel-tab", { hasText: "Memories" }).isVisible(), "the Memories tab should be reachable");
      })) && ok;

    ok =
      (await test("opening Chats while Context is open closes Context (mutual exclusion)", async () => {
        assert(await page.locator(".modal-overlay").isVisible(), "sanity check: Context overlay should still be open");
        await chatsTrigger.click();
        assert((await page.locator(".modal-overlay").count()) === 1, "exactly one overlay should be open");
        assert(await page.locator(".modal-overlay .sheet-switcher").isVisible(), "the open overlay should now be Chats");
        await chatsTrigger.click();
      })) && ok;
  });

  await withFreshPage(browser, async (page) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto(baseUrl);
    await page.waitForSelector(".chat-column");
    await setApiKey(page, "sk-ant-fake-key");
    const chatsTrigger = page.locator(".app-header-left .mobile-nav-trigger");

    ok =
      (await test("Manage with AI opened from inside the mobile Context overlay hands off to the Chats overlay", async () => {
        await page.click(".header-menu-trigger");
        await page.click(".header-menu .context-trigger");
        await page.waitForSelector(".modal-overlay .sheet-panel-tabs");
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
      (await test("desktop widths show no regression: mobile/hamburger triggers hidden, header buttons and sidebar handle back to normal", async () => {
        assert(!(await page.locator(".app-header-left .mobile-nav-trigger").isVisible()), "the Chats trigger should not be visible at desktop widths");
        assert(!(await page.locator(".header-menu-trigger").isVisible()), "the hamburger should not be visible at desktop widths");

        // Context/History/Library/Settings render directly in the header
        // now, not behind the hamburger — .header-menu is just their plain
        // static container at this width.
        assert(await page.locator(".header-menu .context-trigger").isVisible(), "Context should be directly reachable in the header");
        assert(await page.locator('.header-menu button[aria-label="History"]').isVisible(), "History should be directly reachable in the header");
        assert(await page.locator('.header-menu button[aria-label="Library"]').isVisible(), "Library should be directly reachable in the header");
        assert(await page.locator('.header-menu button[aria-label="Settings"]').isVisible(), "Settings should be directly reachable in the header");
        assert(!(await page.locator(".header-menu-item-label").first().isVisible()), "the icon-only desktop buttons shouldn't show the mobile-dropdown's text labels");

        const chatsWidth = await page.locator(".chats-sidebar").evaluate((el) => el.getBoundingClientRect().width);
        assert(Math.abs(chatsWidth - 250) < 1, `chats-sidebar should still measure ~250px wide, got ${chatsWidth}`);
        assert(await page.locator(".chats-sidebar-handle").isVisible(), "the edge handle should still be visible at desktop widths");
      })) && ok;
  });

  return ok;
}
