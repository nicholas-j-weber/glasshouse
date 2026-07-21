import { assert, mockApi, setApiKey, showSheetPanelTab, test, withFreshPage } from "./support.mjs";

// the compression recommender — a Settings toggle,
// a Token Estimator banner once Context size crosses a threshold, a
// pre-filled (not auto-sent) Manage with AI instruction, and the
// compress_conversation suggestion type (one atomic accept: adds a
// kind: "summary" memory and deactivates the turns it replaces). The
// This Chat tab's manual "Add summary" counterpart was removed —
// a summary is inherently AI-generated (a condensation of existing turns),
// and manually typing one had no real use a manual turn or memory didn't
// already cover. The toggle now defaults to *on*, a
// deliberate break from every other recommend/collapse-by-default setting
// in this app, which all default off.
async function setRecommendCompression(page, enabled) {
  await page.click('button[aria-label="Settings"]');
  const checkbox = page.locator('input[aria-label="Recommend compression when context grows large"]');
  if ((await checkbox.isChecked()) !== enabled) await checkbox.click();
  await page.click('button[aria-label="Close settings"]');
  // Settings is a native <dialog> (useDialog.ts) — its close() dispatches
  // the real 'close' event, and the React unmount that follows, a tick
  // after this click resolves, not synchronously within it.
  await page.waitForTimeout(150);
}

export async function run(browser, baseUrl) {
  let ok = true;

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");

    ok = (await test("the recommend-compression setting defaults to on", async () => {
      await page.click('button[aria-label="Settings"]');
      assert(
        await page.locator('input[aria-label="Recommend compression when context grows large"]').isChecked(),
        "should default to checked/on — a deliberate precedent-break from every other recommend/collapse-by-default toggle",
      );
      await page.click('button[aria-label="Close settings"]');
    })) && ok;

    ok = (await test("an AI-created summary renders distinctly above the numbered turn list, without touching an untouched turn", async () => {
      await mockApi(page, () => `ok.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"conversation_summary_update","body":"An ordinary turn."}]\n-->`);
      await page.fill(".chat-input-row textarea", "hello");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(400);

      await mockApi(page, () => `ok.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"conversation_summary_update","body":"Turn to compress."}]\n-->`);
      await page.fill(".chat-input-row textarea", "hello2");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(400);

      // Only the second turn is named — the first should come through
      // completely untouched, proving compression targets exactly what
      // it's told to and nothing else.
      let turnToCompressId;
      await page.click(".manage-ai-trigger");
      await mockApi(page, (body) => {
        turnToCompressId = body.system.match(/Turn to compress\. \(id: ([a-f0-9-]+)\)/)[1];
        return { text: `<!-- SHEET_SUGGESTIONS\n[{"type":"compress_conversation","body":"Digest of earlier turns.","turnIds":["${turnToCompressId}"]}]\n-->` };
      });
      await page.fill(".manage-ai-input-row textarea", "compress the second turn only");
      await page.click(".manage-ai-go");
      await page.waitForTimeout(400);
      await page.locator(".change-card").locator('button[aria-label="Accept"]').click();
      await page.waitForTimeout(400);
      await page.click(".manage-ai-back");
      await showSheetPanelTab(page, "chat");
      await page.waitForTimeout(200);

      const digest = page.locator(".conversation-summary-digest", { hasText: "Digest of earlier turns." });
      assert(await digest.isVisible(), "the AI-created summary should render as its own distinct row");
      assert(await digest.locator(".conversation-summary-digest-label", { hasText: "Summary" }).isVisible(), "it should carry a 'Summary' label distinguishing it from numbered turns");

      const turnRow = page.locator(".memory-row", { hasText: "An ordinary turn." });
      assert(!(await turnRow.evaluate((el) => el.classList.contains("conversation-summary-digest"))), "an untouched turn should not get the digest treatment");
      assert(await turnRow.locator('input[type=checkbox]').isChecked(), "the untouched turn should remain active — only the named turn was compressed");
    })) && ok;

    ok = (await test("Edit and Delete work on an AI-created summary the same as any other row", async () => {
      // The editing-state row (.memory-row--editing) doesn't carry the
      // .conversation-summary-digest class — that's only on the resting-
      // state row — so scope by the editing class while mid-edit instead.
      await page.locator(".conversation-summary-digest").locator('button[aria-label="Edit"]').click();
      await page.locator(".memory-row--editing textarea").fill("Edited digest text.");
      await page.locator(".memory-row--editing button", { hasText: "Save" }).click();
      await page.waitForTimeout(200);
      assert(await page.locator(".conversation-summary-digest", { hasText: "Edited digest text." }).isVisible(), "editing a summary row should work like any other memory row");

      await page.locator(".conversation-summary-digest").locator('button[aria-label="Delete"]').click();
      await page.waitForTimeout(200);
      assert((await page.locator(".conversation-summary-digest").count()) === 0, "deleting a summary row should remove it");
    })) && ok;
  });

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");

    ok = (await test("accepting a compress_conversation suggestion atomically adds a summary and deactivates the named turns", async () => {
      await mockApi(page, () => `ok.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"conversation_summary_update","body":"Turn one about setup."}]\n-->`);
      await page.fill(".chat-input-row textarea", "msg1");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(400);

      await mockApi(page, () => `ok.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"conversation_summary_update","body":"Turn two about goals."}]\n-->`);
      await page.fill(".chat-input-row textarea", "msg2");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(400);

      const contextSizeBefore = await page.locator(".token-stat", { hasText: "Context size" }).textContent();

      // Real turn ids are only ever exposed via the system prompt (never
      // rendered in the UI) — captured the same way the model itself would
      // see them, from the next request's own system prompt, rather than
      // hand-waving fake ids that wouldn't exercise the real match logic.
      let turnIds = [];
      await page.click(".manage-ai-trigger");
      await mockApi(page, (body) => {
        turnIds = [...body.system.matchAll(/\(id: ([a-f0-9-]+)\)/g)].map((m) => m[1]);
        return {
          text: `<!-- SHEET_SUGGESTIONS\n[{"type":"compress_conversation","body":"Condensed summary of both turns.","turnIds":${JSON.stringify(turnIds)}}]\n-->`,
        };
      });
      await page.fill(".manage-ai-input-row textarea", "compress the old turns");
      await page.click(".manage-ai-go");
      await page.waitForTimeout(400);

      assert(turnIds.length === 2, `expected to capture 2 real turn ids from the system prompt, got ${turnIds.length}`);

      const card = page.locator(".change-card", { hasText: "Compress conversation turns" });
      assert(await card.isVisible(), "the compress_conversation suggestion should render as a change card");
      assert((await card.locator(".change-card-before").textContent()) === "Turn one about setup. / Turn two about goals.", "before should show both covered turns' text");
      assert((await card.locator(".change-card-after").textContent()) === "Condensed summary of both turns.", "after should show the condensed digest");

      await card.locator('button[aria-label="Accept"]').click();
      await page.waitForTimeout(400);

      await page.click(".manage-ai-back");
      await showSheetPanelTab(page, "chat");
      await page.waitForTimeout(200);

      assert(await page.locator(".conversation-summary-digest", { hasText: "Condensed summary of both turns." }).isVisible(), "the summary should now exist");
      const inactiveOriginals = page.locator(".memory-row--inactive:not(.conversation-summary-digest)");
      assert((await inactiveOriginals.count()) === 2, "both covered turns should now show as inactive — deactivated, not deleted");
      assert(await page.locator(".memory-row", { hasText: "Turn one about setup." }).isVisible(), "a deactivated turn stays visible (dimmed) for audit, never silently removed");

      const contextSizeAfter = await page.locator(".token-stat", { hasText: "Context size" }).textContent();
      assert(contextSizeAfter !== contextSizeBefore, "Context size should actually change once the turns are excluded from serialization");
    })) && ok;
  });

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");

    ok = (await test("rejecting a compress_conversation suggestion leaves every turn untouched", async () => {
      await mockApi(page, () => `ok.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"conversation_summary_update","body":"A turn."}]\n-->`);
      await page.fill(".chat-input-row textarea", "msg1");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(400);

      await page.click(".manage-ai-trigger");
      await mockApi(page, (body) => {
        const ids = [...body.system.matchAll(/\(id: ([a-f0-9-]+)\)/g)].map((m) => m[1]);
        return { text: `<!-- SHEET_SUGGESTIONS\n[{"type":"compress_conversation","body":"Condensed.","turnIds":${JSON.stringify(ids)}}]\n-->` };
      });
      await page.fill(".manage-ai-input-row textarea", "compress");
      await page.click(".manage-ai-go");
      await page.waitForTimeout(400);

      await page.locator(".change-card", { hasText: "Compress conversation turns" }).locator('button[aria-label="Reject"]').click();
      await page.waitForTimeout(300);

      await page.click(".manage-ai-back");
      await showSheetPanelTab(page, "chat");
      assert((await page.locator(".conversation-summary-digest").count()) === 0, "rejecting should never create a version — no summary should exist");
      assert(await page.locator(".memory-row", { hasText: "A turn." }).locator('input[type=checkbox]').isChecked(), "the original turn should still be active — rejecting is a no-op on the sheet");
    })) && ok;

    ok = (await test("a compress_conversation suggestion naming only unmatched turnIds fails visibly, not silently", async () => {
      // The previous test closed the panel via .manage-ai-back — reopen it.
      await page.click(".manage-ai-trigger");
      await mockApi(page, () => ({
        text: `<!-- SHEET_SUGGESTIONS\n[{"type":"compress_conversation","body":"Condensed.","turnIds":["does-not-exist"]}]\n-->`,
      }));
      await page.fill(".manage-ai-input-row textarea", "compress nonexistent turns");
      await page.click(".manage-ai-go");
      await page.waitForTimeout(400);

      const card = page.locator(".change-card", { hasText: "Compress conversation turns" });
      await card.locator('button[aria-label="Accept"]').click();
      await page.waitForTimeout(300);
      assert(await page.locator(".change-card", { hasText: "memory not found" }).isVisible(), "accepting with no matching turnIds should fail visibly, same as edit_memory/deactivate_memory targeting a stale id");
    })) && ok;
  });

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");

    ok = (await test("a second compression later on folds an existing summary into the new one, instead of leaving it stranded", async () => {
      await mockApi(page, () => `ok.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"conversation_summary_update","body":"Turn one."}]\n-->`);
      await page.fill(".chat-input-row textarea", "msg1");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(400);
      await mockApi(page, () => `ok.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"conversation_summary_update","body":"Turn two."}]\n-->`);
      await page.fill(".chat-input-row textarea", "msg2");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(400);

      // First compression: fold turns one and two into an initial summary.
      await page.click(".manage-ai-trigger");
      await mockApi(page, (body) => {
        const ids = [...body.system.matchAll(/\(id: ([a-f0-9-]+)\)/g)].map((m) => m[1]);
        return { text: `<!-- SHEET_SUGGESTIONS\n[{"type":"compress_conversation","body":"First digest.","turnIds":${JSON.stringify(ids)}}]\n-->` };
      });
      await page.fill(".manage-ai-input-row textarea", "compress everything");
      await page.click(".manage-ai-go");
      await page.waitForTimeout(400);
      await page.locator(".change-card", { hasText: "Compress conversation turns" }).locator('button[aria-label="Accept"]').click();
      await page.waitForTimeout(400);

      // A couple more turns accumulate after the first compression.
      await page.click(".manage-ai-back");
      await mockApi(page, () => `ok.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"conversation_summary_update","body":"Turn three."}]\n-->`);
      await page.fill(".chat-input-row textarea", "msg3");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(400);

      // Second compression: the mocked "model" sees both the numbered turn
      // and the existing "[Summary]: First digest." entry in the system
      // prompt (both render with their own "(id: ...)"), and names both —
      // exactly what a real model is now instructed to do.
      await page.click(".manage-ai-trigger");
      await mockApi(page, (body) => {
        const ids = [...body.system.matchAll(/\(id: ([a-f0-9-]+)\)/g)].map((m) => m[1]);
        assert(body.system.includes("[Summary]: First digest."), "sanity check: the existing summary should be visible to the model, with its own id");
        return { text: `<!-- SHEET_SUGGESTIONS\n[{"type":"compress_conversation","body":"Merged digest covering everything.","turnIds":${JSON.stringify(ids)}}]\n-->` };
      });
      await page.fill(".manage-ai-input-row textarea", "compress everything again");
      await page.click(".manage-ai-go");
      await page.waitForTimeout(400);
      await page.locator(".change-card", { hasText: "Compress conversation turns" }).locator('button[aria-label="Accept"]').click();
      await page.waitForTimeout(400);

      await page.click(".manage-ai-back");
      await showSheetPanelTab(page, "chat");
      await page.waitForTimeout(200);

      const digests = page.locator(".conversation-summary-digest");
      assert((await digests.count()) === 2, "the old summary stays visible (dimmed), never deleted — same audit posture as a deactivated turn");
      assert(await page.locator(".conversation-summary-digest", { hasText: "Merged digest covering everything." }).locator('input[type=checkbox]').isChecked(), "the new merged summary should be active");
      assert(
        !(await page.locator(".conversation-summary-digest", { hasText: "First digest." }).locator('input[type=checkbox]').isChecked()),
        "the prior summary should now be inactive — folded into the new one, not left stranded",
      );
    })) && ok;
  });

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");

    ok = (await test("the banner shows by default once Context size crosses the threshold", async () => {
      await mockApi(page, () => `ok.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"conversation_summary_update","body":"${"x".repeat(15000)}"}]\n-->`);
      await page.fill(".chat-input-row textarea", "hello");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(400);

      const contextSize = await page.locator(".token-stat", { hasText: "Context size" }).textContent();
      const tokens = Number(contextSize.match(/~(\d+)/)[1]);
      assert(tokens >= 3000, `sanity check: this test needs a large context, got ~${tokens} tokens`);
      assert(await page.locator(".compression-banner").isVisible(), "the banner should show without any setting change — on is the default now");
    })) && ok;

    ok = (await test("turning the setting off hides the banner even with a large context, and back on shows it again pre-filling Manage with AI", async () => {
      await setRecommendCompression(page, false);
      assert((await page.locator(".compression-banner").count()) === 0, "the banner should hide once explicitly turned off, even though context is still large");

      await setRecommendCompression(page, true);
      assert(await page.locator(".compression-banner").isVisible(), "the banner should reappear once turned back on — context is still large from the previous test");

      await page.click(".compression-banner-button");
      assert(await page.locator(".manage-ai-panel").isVisible(), "clicking the banner should open Manage with AI");
      // The pre-fill applies via a useEffect after mount, not synchronously
      // with the panel's own first paint — give it a beat before reading.
      await page.waitForTimeout(150);
      const draftValue = await page.locator(".manage-ai-input-row textarea").inputValue();
      assert(draftValue.length > 0, "the instruction field should be pre-filled");
      assert((await page.locator(".manage-ai-changes .change-card").count()) === 0, "pre-filling must not auto-submit — nothing should have been sent yet");
    })) && ok;

    ok = (await test("turning the setting back off hides the banner immediately", async () => {
      await page.click(".manage-ai-back");
      await setRecommendCompression(page, false);
      assert((await page.locator(".compression-banner").count()) === 0, "the banner should disappear once the setting is off again, even with the same large context");
    })) && ok;
  });

  return ok;
}
