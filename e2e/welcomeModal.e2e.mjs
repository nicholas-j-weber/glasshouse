import { assert, mockApi, test, withFreshPage } from "./support.mjs";

// a one-time explanation shown on first load, with
// two distinct dismissals — closing (overlay click, ×, or "Dismiss") only
// hides it for this page load and reappears on the next fresh one; "Don't
// show again" is the only path that persists. Every other spec in this
// suite pre-dismisses this permanently via withFreshPage's default
// (skipWelcomeDismiss omitted) so it doesn't block their own unrelated
// clicks — this file is the one that actually exercises real first-load
// behavior, via skipWelcomeDismiss: true.
export async function run(browser, baseUrl) {
  let ok = true;

  await withFreshPage(
    browser,
    async (page) => {
      await page.goto(baseUrl);

      ok = (await test("the welcome modal shows on a genuinely fresh load", async () => {
        assert(await page.locator(".modal-header h2", { hasText: "Welcome to Glasshouse" }).isVisible(), "the welcome modal should appear on first load");
      })) && ok;

      ok = (await test("clicking outside the modal (the overlay) closes it, but it reappears on reload", async () => {
        // Settings/Welcome are native <dialog> now — there's no .modal-overlay
        // wrapper div to click on to reach the backdrop area, so this clicks a
        // raw viewport position instead (5,5 is well outside the centered dialog
        // at this test's default 1280x720 viewport).
        await page.mouse.click(5, 5);
        await page.waitForTimeout(150);
        assert((await page.locator(".modal-header h2", { hasText: "Welcome to Glasshouse" }).count()) === 0, "clicking the overlay should close it");

        await page.reload();
        await page.waitForTimeout(200);
        assert(await page.locator(".modal-header h2", { hasText: "Welcome to Glasshouse" }).isVisible(), "closing (not 'Don't show again') should not persist across reloads");
      })) && ok;
    },
    { skipWelcomeDismiss: true },
  );

  await withFreshPage(
    browser,
    async (page) => {
      await page.goto(baseUrl);

      ok = (await test("the × close button also closes it, but doesn't persist either", async () => {
        await page.click('button[aria-label="Close welcome message"]');
        await page.waitForTimeout(150);
        assert((await page.locator(".modal-header h2", { hasText: "Welcome to Glasshouse" }).count()) === 0, "the close button should close it");

        await page.reload();
        await page.waitForTimeout(200);
        assert(await page.locator(".modal-header h2", { hasText: "Welcome to Glasshouse" }).isVisible(), "the × button should not persist across reloads either");
      })) && ok;
    },
    { skipWelcomeDismiss: true },
  );

  await withFreshPage(
    browser,
    async (page) => {
      await page.goto(baseUrl);

      ok = (await test("the Dismiss button closes it, doesn't block the app underneath, but doesn't persist", async () => {
        await page.locator(".modal-action-button", { hasText: "Dismiss" }).click();
        await page.waitForTimeout(150);
        assert((await page.locator(".modal-header h2", { hasText: "Welcome to Glasshouse" }).count()) === 0, "the Dismiss button should close it");
        await page.waitForSelector(".sheet-switcher");
        assert(await page.locator(".sheet-switcher").isVisible(), "the app underneath should be fully usable once closed");

        await page.reload();
        await page.waitForTimeout(200);
        assert(await page.locator(".modal-header h2", { hasText: "Welcome to Glasshouse" }).isVisible(), "Dismiss should not persist across reloads");
      })) && ok;
    },
    { skipWelcomeDismiss: true },
  );

  await withFreshPage(
    browser,
    async (page) => {
      await page.goto(baseUrl);

      ok = (await test("the Don't show again button closes it and does persist across reload", async () => {
        await page.click(".modal-action-button--secondary");
        await page.waitForTimeout(150);
        assert((await page.locator(".modal-header h2", { hasText: "Welcome to Glasshouse" }).count()) === 0, "Don't show again should close it");

        await page.reload();
        await page.waitForTimeout(200);
        assert((await page.locator(".modal-header h2", { hasText: "Welcome to Glasshouse" }).count()) === 0, "Don't show again should stay dismissed across reloads, unlike the other dismiss paths");
      })) && ok;
    },
    { skipWelcomeDismiss: true },
  );

  await withFreshPage(
    browser,
    async (page) => {
      await page.goto(baseUrl);

      // an API key field lives in the welcome modal
      // too, sharing SettingsModal's exact storage — a first-time viewer's
      // first action shouldn't be a failed chat send just to discover a
      // key is needed at all.
      ok = (await test("the welcome modal's API key field writes to the same storage Settings reads, and lets chat actually work", async () => {
        const keyInput = page.locator('input[aria-label="Anthropic API key"]');
        assert(await keyInput.isVisible(), "the API key field should be visible in the welcome modal");
        assert((await keyInput.inputValue()) === "", "should start empty");

        await keyInput.fill("sk-ant-fake-key-from-welcome");
        await page.locator(".modal-action-button", { hasText: "Dismiss" }).click();
        await page.waitForSelector(".sheet-switcher");

        await page.click('button[aria-label="Settings"]');
        assert(
          (await page.locator('input[aria-label="Anthropic API key"]').inputValue()) === "sk-ant-fake-key-from-welcome",
          "Settings should show the same key entered in the welcome modal — shared storage, not a separate field",
        );
        await page.click('button[aria-label="Close settings"]');

        await mockApi(page, () => "ok, key worked.");
        await page.fill(".chat-input-row textarea", "hello");
        await page.click('.chat-pane .chat-input-row button[type="submit"]');
        await page.waitForTimeout(400);
        assert((await page.locator(".chat-message--error").count()) === 0, "chat should work with no 'No API key set' error, having entered the key via the welcome modal");
        assert(await page.locator(".chat-message--assistant", { hasText: "ok, key worked" }).isVisible(), "the reply should come through normally");
      })) && ok;
    },
    { skipWelcomeDismiss: true },
  );

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");

    ok = (await test("every other spec's default (welcome pre-dismissed) leaves the app immediately usable", async () => {
      assert((await page.locator(".modal-header h2", { hasText: "Welcome to Glasshouse" }).count()) === 0, "withFreshPage's default should pre-dismiss the welcome modal");
    })) && ok;
  });

  await withFreshPage(
    browser,
    async (page) => {
      await page.goto(baseUrl);

      // widened past Settings' base 360px so the
      // welcome text wraps into fewer lines — confirmed live this was
      // needed once the API key field pushed the modal's
      // content past what fit without scrolling at ordinary heights.
      ok = (await test("the welcome modal is wider than the base modal width Settings still uses", async () => {
        const width = await page.locator(".modal").evaluate((el) => el.getBoundingClientRect().width);
        assert(width > 360, `expected the welcome modal to be wider than the base 360px, got ${width}`);
      })) && ok;
    },
    { skipWelcomeDismiss: true },
  );

  await withFreshPage(
    browser,
    async (page) => {
      // The explanatory paragraphs that used to sit above the fields here
      // (what Glasshouse is, how Context/compression work) were removed —
      // WelcomeModal.tsx now only has the API key/model row plus one hint
      // paragraph, since setup is what actually blocks a first-time viewer.
      // Less content than when this regression was first found, but the
      // guard is still worth keeping.
      await page.setViewportSize({ width: 1280, height: 600 });
      await page.goto(baseUrl);
      await page.waitForTimeout(200);

      ok = (await test("the API key/model row and hint text fit without scrolling at a 600px-tall viewport", async () => {
        const body = page.locator(".modal-body");
        const bodyScroll = await body.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
        assert(bodyScroll.scrollHeight <= bodyScroll.clientHeight, `expected no overflow at 600px tall, got scrollHeight ${bodyScroll.scrollHeight} vs clientHeight ${bodyScroll.clientHeight}`);
      })) && ok;
    },
    { skipWelcomeDismiss: true },
  );

  return ok;
}
