import { assert, closeContext, mockApi, openManageWithAI, setApiKey, showSheetPanelTab, test, withFreshPage } from "./support.mjs";

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

// Also native <dialog> — same close-event timing note as setRecommendCompression.
async function setAutoRunCompression(page, enabled) {
  await page.click('button[aria-label="Settings"]');
  const checkbox = page.locator('input[aria-label="Run compression immediately without review"]');
  if ((await checkbox.isChecked()) !== enabled) await checkbox.click();
  await page.click('button[aria-label="Close settings"]');
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
      await openManageWithAI(page);
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

      // Real turn ids are only ever exposed via the system prompt (never
      // rendered in the UI) — captured the same way the model itself would
      // see them, from the next request's own system prompt, rather than
      // hand-waving fake ids that wouldn't exercise the real match logic.
      let turnIds = [];
      await openManageWithAI(page);
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
      // The live "Context size" readout this used to check against was
      // removed from the UI (ChatPane.tsx: "Background-only now") — the
      // structural assertions above (summary exists, both turns inactive)
      // already prove the exclusion took effect; there's no separate
      // visible number left to cross-check it against.
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

      await openManageWithAI(page);
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
      await openManageWithAI(page);
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
      await openManageWithAI(page);
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
      await openManageWithAI(page);
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

    // The always-visible "Context size" readout this recommender used to
    // key off of, and the non-blocking banner it showed, are both gone —
    // CompressionPrompt.tsx is a blocking native <dialog> now, triggered
    // purely as a background effect of ChatPane's own token estimate
    // (never rendered as a number anywhere). Every close path (X, "Not
    // now", backdrop click) routes through the same dialog 'close' event
    // and records the current token count as a dismissal floor — the
    // prompt won't reappear until context grows by another full threshold
    // past that floor. And since it's a modal dialog, its backdrop blocks
    // the rest of the page — Settings isn't reachable while it's open, so
    // reaching it always dismisses the prompt as a side effect first
    // (confirmed live: clicking the Settings button while the prompt is
    // open times out).
    const compressionPrompt = () => page.locator("#compression-prompt-title");

    ok = (await test("the compression prompt shows by default once context crosses the threshold", async () => {
      await mockApi(page, () => `ok.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"conversation_summary_update","body":"${"x".repeat(15000)}"}]\n-->`);
      await page.fill(".chat-input-row textarea", "hello");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(400);

      assert(await compressionPrompt().isVisible(), "the prompt should show without any setting change — on is the default now");
    })) && ok;

    ok = (await test("dismissing it, turning the setting off, then growing context further keeps it hidden", async () => {
      await page.click('button[aria-label="Close"]');
      await page.waitForTimeout(150);
      await setRecommendCompression(page, false);

      await mockApi(page, () => `ok.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"conversation_summary_update","body":"${"x".repeat(15000)}"}]\n-->`);
      await page.fill(".chat-input-row textarea", "more");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(400);

      assert((await compressionPrompt().count()) === 0, "the prompt should not reappear once the setting is off, even past another threshold's worth of growth");
    })) && ok;

    ok = (await test("turning the setting back on shows the prompt again immediately, since context already grew past the dismissal floor while it was off", async () => {
      // Re-evaluated live off the current sheet, not just future sends —
      // the previous test's "more" message already pushed context past the
      // next threshold while the setting was off; flipping it back on and
      // closing Settings re-renders ChatPane, which shows the prompt right
      // away, no new send required.
      await setRecommendCompression(page, true);
      assert(await compressionPrompt().isVisible(), "the prompt should reappear as soon as the setting flips back on");
    })) && ok;

    ok = (await test("accepting it by default runs compression immediately, not opening Manage with AI", async () => {
      // "Run compression immediately without review" (auto-run) defaults
      // to on — the deliberate exception among this app's recommend/
      // collapse-by-default toggles (settingsStorage.ts): version history
      // already makes this a one-click revert, so the low-friction path is
      // the safe default. Accepting sends COMPRESSION_INSTRUCTION as a real
      // call ("chat" mode, unlike Manage with AI's "sheet_editor" mode
      // elsewhere in this file) — a compress_conversation response with no
      // conversation_summary_update of its own doesn't satisfy the
      // mandatory-proposal rule, so it also triggers a second, disambiguated
      // follow-up call (conversationSummaryFollowup.ts). Discriminate by
      // system prompt: only the main call's includes the suggestion-format
      // instructions.
      let turnIds = [];
      await mockApi(page, (body) => {
        if (!body.system.includes("## Suggesting Sheet Changes")) {
          return { text: `<!-- SHEET_SUGGESTIONS\n[{"type":"conversation_summary_update","body":"n/a"}]\n-->` };
        }
        turnIds = [...body.system.matchAll(/\(id: ([a-f0-9-]+)\)/g)].map((m) => m[1]);
        return { text: `<!-- SHEET_SUGGESTIONS\n[{"type":"compress_conversation","body":"Digest.","turnIds":${JSON.stringify(turnIds)}}]\n-->` };
      });
      await page.click('.modal-actions button:has-text("Compress")');
      await page.waitForTimeout(500);

      assert(turnIds.length > 0, "sanity check: the compress instruction should have gone out and matched real turn ids");
      assert((await page.locator(".manage-ai-panel").count()) === 0, "accepting should not open Manage with AI while auto-run is on");
      await showSheetPanelTab(page, "chat");
      const summaries = page.locator(".conversation-summary-digest");
      assert((await summaries.count()) > 0, "accepting should have actually run compression, producing a summary");
      await closeContext(page);
    })) && ok;

    ok = (await test("with auto-run off, accepting the prompt opens Manage with AI pre-filled instead", async () => {
      // Nothing is blocking Settings here — the previous test's own
      // "Compress" click already closed the prompt (dialog.close() fires
      // regardless of how a dialog is closed).
      await setAutoRunCompression(page, false);

      // The previous test's accepted dismissal floor was recorded from the
      // token count right before compression actually shrank anything
      // (ChatPane's onDismiss fires off the pre-compression tokenCount) —
      // comfortably clearing it needs more than one more 15000-char turn.
      await mockApi(page, () => `ok.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"conversation_summary_update","body":"${"x".repeat(15000)}"}]\n-->`);
      for (let i = 0; i < 3; i++) {
        await page.fill(".chat-input-row textarea", `yet more ${i}`);
        await page.click('.chat-pane .chat-input-row button[type="submit"]');
        await page.waitForTimeout(400);
        if (await compressionPrompt().isVisible()) break;
      }
      assert(await compressionPrompt().isVisible(), "sanity check: the prompt should still trigger the same way with auto-run off");

      await page.click('.modal-actions button:has-text("Compress")');
      assert(await page.locator(".manage-ai-panel").isVisible(), "with auto-run off, accepting should open Manage with AI instead of compressing directly");
      // The pre-fill applies via a useEffect after mount, not synchronously
      // with the panel's own first paint — give it a beat before reading.
      await page.waitForTimeout(150);
      const draftValue = await page.locator(".manage-ai-input-row textarea").inputValue();
      assert(draftValue.length > 0, "the instruction field should be pre-filled");
      assert((await page.locator(".manage-ai-changes .change-card").count()) === 0, "pre-filling must not auto-submit — nothing should have been sent yet");
    })) && ok;
  });

  return ok;
}
