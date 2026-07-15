import { assert, setApiKey, test, withFreshPage } from "./support.mjs";

// Addendum BJ coverage: Model is a <select> (with an "Other…" escape hatch
// that reveals a text input), not the <datalist>-backed text input
// Addendum BI shipped — that turned out to be broken on live testing, not
// just DOM inspection: a native datalist filters its suggestions against
// whatever the field's current value already is, so a field pre-filled
// with a complete, valid model id ("claude-sonnet-5") showed only that one
// option and hid the rest. A <select> always lists every option
// regardless of the current value, which is the actual bug fix here; the
// "Other…" escape hatch is what still lets a model id newer than
// KNOWN_MODELS be entered, preserving the forward-compatibility that was
// the reason a plain <select> was avoided in the first place.
const EXPECTED_MODELS = ["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5-20251001", "claude-fable-5"];

export async function run(browser, baseUrl) {
  let ok = true;

  await withFreshPage(
    browser,
    async (page) => {
      await page.goto(baseUrl);

      ok = (await test("the welcome modal's Model select sits beside the API key field, defaulting to claude-sonnet-5", async () => {
        const apiKeyBox = await page.locator('input[aria-label="Anthropic API key"]').boundingBox();
        const modelSelect = page.locator('select[aria-label="Model"]');
        const modelBox = await modelSelect.boundingBox();
        assert(Math.abs(modelBox.y - apiKeyBox.y) < 2, "Model should sit on the same row as the API key field, not stacked below it");
        assert(modelBox.x > apiKeyBox.x, "Model should sit to the right of the API key field");
        assert((await modelSelect.inputValue()) === "claude-sonnet-5", "should default to claude-sonnet-5");
        // Addendum BK: a <select> doesn't respect line-height the way a
        // text input does, so identical padding/border alone left it ~5px
        // shorter — confirmed live before fixing.
        assert(modelBox.height === apiKeyBox.height, `expected equal heights, got API key ${apiKeyBox.height} vs Model ${modelBox.height}`);
      })) && ok;

      ok = (await test("the welcome modal's Model select always lists every known model plus Other…, regardless of the current value", async () => {
        // The bug this addendum fixes: a <datalist> filtered its options
        // against the current value, showing only the one already
        // selected. A real <select> always exposes every <option> in the
        // DOM — this is what actually catches a regression back to that.
        const options = await page.locator('select[aria-label="Model"] option').evaluateAll((els) => els.map((e) => e.value));
        assert(
          JSON.stringify(options) === JSON.stringify([...EXPECTED_MODELS, "custom"]),
          `expected ${JSON.stringify([...EXPECTED_MODELS, "custom"])}, got ${JSON.stringify(options)}`,
        );
      })) && ok;

      ok = (await test("choosing a known model in the welcome modal persists to the same storage Settings reads", async () => {
        await page.locator('select[aria-label="Model"]').selectOption("claude-opus-4-8");
        await page.locator(".welcome-dismiss", { hasText: "Got it" }).click();
        await page.waitForSelector(".sheet-switcher");

        await page.click('button[aria-label="Settings"]');
        assert(
          (await page.locator('select[aria-label="Model"]').inputValue()) === "claude-opus-4-8",
          "Settings should show the model chosen in the welcome modal — shared storage, not a separate field",
        );
      })) && ok;
    },
    { skipWelcomeDismiss: true },
  );

  await withFreshPage(
    browser,
    async (page) => {
      await page.goto(baseUrl);

      ok = (await test("choosing Other… reveals a text input for a model id not in the known list", async () => {
        assert((await page.locator('input[aria-label="Custom model"]').count()) === 0, "the custom input shouldn't exist until Other… is chosen");

        await page.locator('select[aria-label="Model"]').selectOption("custom");
        const customInput = page.locator('input[aria-label="Custom model"]');
        assert(await customInput.isVisible(), "choosing Other… should reveal a text input");

        await customInput.fill("claude-some-future-model");
        assert((await customInput.inputValue()) === "claude-some-future-model", "should accept an arbitrary model id, not just the known ones");
      })) && ok;

      ok = (await test("a custom model persists across modals the same way a known one does", async () => {
        await page.locator(".welcome-dismiss", { hasText: "Got it" }).click();
        await page.waitForSelector(".sheet-switcher");

        await page.click('button[aria-label="Settings"]');
        assert((await page.locator('select[aria-label="Model"]').inputValue()) === "custom", "Settings should also show Other… selected");
        assert(
          (await page.locator('input[aria-label="Custom model"]').inputValue()) === "claude-some-future-model",
          "Settings should show the same custom model id entered in the welcome modal",
        );
      })) && ok;
    },
    { skipWelcomeDismiss: true },
  );

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");

    ok = (await test("Settings' Model select sits beside the API key field and lists the same known models", async () => {
      await page.click('button[aria-label="Settings"]');
      const apiKeyBox = await page.locator('input[aria-label="Anthropic API key"]').boundingBox();
      const modelBox = await page.locator('select[aria-label="Model"]').boundingBox();
      assert(Math.abs(modelBox.y - apiKeyBox.y) < 2, "Model should sit on the same row as the API key field in Settings too");
      assert(modelBox.x > apiKeyBox.x, "Model should sit to the right of the API key field");
      assert(modelBox.height === apiKeyBox.height, `expected equal heights in Settings too, got API key ${apiKeyBox.height} vs Model ${modelBox.height}`);

      const options = await page.locator('select[aria-label="Model"] option').evaluateAll((els) => els.map((e) => e.value));
      assert(
        JSON.stringify(options) === JSON.stringify([...EXPECTED_MODELS, "custom"]),
        "Settings should offer the same known-models list as the welcome modal",
      );
    })) && ok;
  });

  return ok;
}
