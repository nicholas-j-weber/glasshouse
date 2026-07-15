import { assert, mockApi, setApiKey, setAutoApply, showSheetPanelTab, test, withFreshPage } from "./support.mjs";

// chat mode's auto-apply is a setting,
// default on, toggleable in Settings — off, chat suggestions behave exactly
// like Manage with AI's ChangeCard review always has (pending, Accept/
// Reject/Revise with AI), rendered inline in the transcript instead of a
// separate panel. Other coverage (globalMemories.e2e.mjs,
// multiSheet.e2e.mjs) already exercises the default-on path in full; this
// file is specifically the off path and the toggle itself.
export async function run(browser, baseUrl) {
  let ok = true;

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");

    ok = (await test("the auto-apply setting defaults to on", async () => {
      await page.click('button[aria-label="Settings"]');
      assert(await page.locator('input[aria-label="Auto-apply context updates while chatting"]').isChecked(), "auto-apply should default to checked/on");
      await page.click('button[aria-label="Close settings"]');
    })) && ok;

    await setAutoApply(page, false);

    await mockApi(page, () => ({
      text: `Got it.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"new_memory","label":"Pet","body":"A cat named Milo"},{"type":"conversation_summary_update","body":"turn one"}]\n-->`,
    }));

    ok = (await test("with auto-apply off, a chat suggestion stays pending as an interactive card, not a toast", async () => {
      await page.fill(".chat-input-row textarea", "remember my pet");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(400);

      assert((await page.locator(".toast").count()) === 0, "nothing should auto-apply, so no toast either");

      const memSection = () => page.locator(".sheet-section", { hasText: "Memories" }).first();
      await showSheetPanelTab(page, "memories");
      assert(!(await memSection().locator(".memory-list").textContent()).includes("A cat named Milo"), "the memory should not be added until manually accepted");
      await showSheetPanelTab(page, "chat");

      const card = page.locator(".chat-pane:not(.chat-pane--embedded) .change-card", { hasText: "Pet" });
      assert(await card.isVisible(), "a pending new_memory suggestion should render as a ChangeCard in the chat pane");
      assert(await card.locator('button[aria-label="Accept"]').isVisible(), "the card should offer Accept");
      assert(await card.locator('button[aria-label="Reject"]').isVisible(), "the card should offer Reject");
      assert(await card.locator(".revise-with-ai-button").isVisible(), "the card should offer Revise with AI");
    })) && ok;

    ok = (await test("accepting a pending chat card applies it and records it in the transcript", async () => {
      const card = page.locator(".chat-pane:not(.chat-pane--embedded) .change-card", { hasText: "Pet" });
      await card.locator('button[aria-label="Accept"]').click();
      await page.waitForTimeout(300);

      assert((await page.locator(".change-card", { hasText: "Pet" }).count()) === 0, "the card should stop being interactive once accepted");
      assert(
        await page.locator(".chat-applied-list", { hasText: "Pet" }).isVisible(),
        "the transcript should keep a plain record of the now-accepted suggestion",
      );

      const memSection = () => page.locator(".sheet-section", { hasText: "Memories" }).first();
      await showSheetPanelTab(page, "memories");
      assert((await memSection().locator(".memory-list").textContent()).includes("A cat named Milo"), "accepting should actually add the memory");
      await showSheetPanelTab(page, "chat");
    })) && ok;
  });

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");
    await setAutoApply(page, false);
    await mockApi(page, () => ({
      text: `Noted.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"new_memory","label":"Rejected Fact","body":"should not stick"},{"type":"conversation_summary_update","body":"turn one"}]\n-->`,
    }));

    ok = (await test("rejecting a pending chat card leaves the sheet unchanged and records the rejection", async () => {
      await page.fill(".chat-input-row textarea", "remember this");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(400);

      const card = page.locator(".chat-pane:not(.chat-pane--embedded) .change-card", { hasText: "Rejected Fact" });
      await card.locator('button[aria-label="Reject"]').click();
      await page.waitForTimeout(300);

      assert((await page.locator(".change-card", { hasText: "Rejected Fact" }).count()) === 0, "the card should stop being interactive once rejected");
      assert(
        await page.locator(".chat-applied-list", { hasText: "Rejected: New memory" }).isVisible(),
        "the transcript should record the rejection, not just silently drop it",
      );

      const memSection = () => page.locator(".sheet-section", { hasText: "Memories" }).first();
      await showSheetPanelTab(page, "memories");
      assert(!(await memSection().locator(".memory-list").textContent()).includes("should not stick"), "rejecting must not create a version");
    })) && ok;
  });

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");
    await setAutoApply(page, false);
    let callCount = 0;
    await mockApi(page, () => {
      callCount++;
      if (callCount === 1) {
        return {
          text: `Sure.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"tone_update","body":"too formal"},{"type":"conversation_summary_update","body":"turn one"}]\n-->`,
        };
      }
      return { text: `Warmer it is.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"tone_update","body":"warm and casual"}]\n-->` };
    });

    ok = (await test("Revise with AI re-aims the chat's own input row, same pattern as Manage with AI", async () => {
      await page.fill(".chat-input-row textarea", "adjust the tone");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(400);

      const card = page.locator(".chat-pane:not(.chat-pane--embedded) .change-card", { hasText: "too formal" });
      await card.locator(".revise-with-ai-button").click();

      const placeholder = await page.locator(".chat-input-row textarea").getAttribute("placeholder");
      assert(placeholder && placeholder.startsWith("How should this change?"), "the input row should re-aim to a revision prompt, not stay the normal composer");
      assert(await card.locator(".change-card-revising-hint").isVisible(), "the targeted card should show a revising hint");

      await page.fill(".chat-input-row textarea", "make it warmer instead");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(400);

      assert((await page.locator(".change-card", { hasText: "too formal" }).count()) === 0, "the original card should no longer be interactive once revised");
      assert(
        await page.locator(".chat-applied-list", { hasText: "Revised: Tone update" }).isVisible(),
        "the original suggestion should be recorded as revised in the transcript",
      );
      assert(
        await page.locator(".change-card", { hasText: "warm and casual" }).isVisible(),
        "the revision's own follow-up suggestion should show up as a new pending card",
      );
    })) && ok;

    ok = (await test("Cancel backs out of a chat revision without submitting anything", async () => {
      const card = page.locator(".chat-pane:not(.chat-pane--embedded) .change-card", { hasText: "warm and casual" });
      await card.locator(".revise-with-ai-button").click();
      await page.click(".chat-revise-cancel");

      const placeholder = await page.locator(".chat-input-row textarea").getAttribute("placeholder");
      assert(placeholder === "Send a message...", "Cancel should restore the normal composer placeholder");
      assert(await card.isVisible(), "the card being revised should still be there, untouched, after Cancel");
    })) && ok;
  });

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");
    await setAutoApply(page, false);
    await setAutoApply(page, true);
    await mockApi(page, () => ({
      text: `Ok.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"new_memory","label":"Back On","body":"auto-apply resumed"}]\n-->`,
    }));

    ok = (await test("turning auto-apply back on resumes the toast/auto-apply behavior", async () => {
      await page.fill(".chat-input-row textarea", "remember one more thing");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(400);

      assert((await page.locator(".change-card").count()) === 0, "nothing should be left pending once auto-apply is back on");
      assert(await page.locator(".toast--applied", { hasText: "Back On" }).isVisible(), "the suggestion should auto-apply again, with a toast");

      const memSection = () => page.locator(".sheet-section", { hasText: "Memories" }).first();
      await showSheetPanelTab(page, "memories");
      assert((await memSection().locator(".memory-list").textContent()).includes("auto-apply resumed"), "the memory should already be added");
    })) && ok;
  });

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");
    await setAutoApply(page, false);
    await mockApi(page, () => ({
      text: `Got it.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"new_memory","label":"Pet","body":"A cat named Milo"},{"type":"conversation_summary_update","body":"original wording"}]\n-->`,
    }));

    ok = (await test("only the conversation turn card offers a manual Edit button", async () => {
      await page.fill(".chat-input-row textarea", "I have a cat named Milo");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(400);

      const memoryCard = page.locator(".chat-pane:not(.chat-pane--embedded) .change-card", { hasText: "New memory" });
      const turnCard = page.locator(".chat-pane:not(.chat-pane--embedded) .change-card", { hasText: "New conversation turn" });
      assert((await memoryCard.locator('button[aria-label="Edit"]').count()) === 0, "new_memory has no manual Edit button — only Revise with AI");
      assert(await turnCard.locator('button[aria-label="Edit"]').isVisible(), "conversation_summary_update should offer a manual Edit button");
    })) && ok;

    ok = (await test("Cancel on the edit form discards the draft, leaving the original suggestion untouched", async () => {
      const turnCard = page.locator(".chat-pane:not(.chat-pane--embedded) .change-card", { hasText: "New conversation turn" });
      await turnCard.locator('button[aria-label="Edit"]').click();

      const textarea = turnCard.locator("textarea");
      assert((await textarea.inputValue()) === "original wording", "the edit form should be pre-filled with the suggestion's current text");
      await textarea.fill("a draft that should never be saved");
      await turnCard.locator("button", { hasText: "Cancel" }).click();

      assert(await turnCard.locator(".change-card-after", { hasText: "original wording" }).isVisible(), "Cancel should discard the draft and restore the original text");
      assert((await turnCard.locator("textarea").count()) === 0, "Cancel should close the edit form back to the normal card");
    })) && ok;

    ok = (await test("Edit lets you rewrite a conversation turn's text directly, without calling the model", async () => {
      const turnCard = page.locator(".chat-pane:not(.chat-pane--embedded) .change-card", { hasText: "New conversation turn" });
      await turnCard.locator('button[aria-label="Edit"]').click();
      await turnCard.locator("textarea").fill("hand-edited wording");
      await turnCard.locator("button", { hasText: "Save" }).click();
      await page.waitForTimeout(200);

      assert(await turnCard.locator(".change-card-after", { hasText: "hand-edited wording" }).isVisible(), "the card should reflect the edited text before it's even accepted");

      await turnCard.locator('button[aria-label="Accept"]').click();
      await page.waitForTimeout(300);

      const convoSection = page.locator(".sheet-section", { hasText: "Conversation Summary" }).first();
      assert((await convoSection.textContent()).includes("hand-edited wording"), "accepting should commit the hand-edited text");
      assert(!(await convoSection.textContent()).includes("original wording"), "the original, pre-edit text should not be what actually landed");
    })) && ok;
  });

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");
    await setAutoApply(page, false);
    await mockApi(page, () => ({
      text: `<!-- SHEET_SUGGESTIONS\n[{"type":"conversation_summary_update","body":"filler turn"}]\n-->`,
    }));

    // the auto-scroll effect only fires when a message is
    // newly appended, deliberately excluding in-place updates (a
    // suggestion's status flipping) — resolving a pending card the user
    // is already looking at shouldn't yank them down to the bottom.
    ok = (await test("resolving a pending card already in view doesn't force-scroll the transcript", async () => {
      for (let i = 0; i < 10; i++) {
        await page.fill(".chat-input-row textarea", `filler ${i}`);
        await page.click('.chat-pane .chat-input-row button[type="submit"]');
        await page.waitForTimeout(100);
      }
      await page.waitForTimeout(300);

      const isNearBottom = () =>
        page.evaluate(() => {
          const el = document.querySelector(".chat-messages");
          return el.scrollHeight - el.scrollTop - el.clientHeight < 4;
        });
      assert(await isNearBottom(), "sanity check: should already be at the bottom after sending the filler batch");

      await page.evaluate(() => {
        document.querySelector(".chat-messages").scrollTop = 0;
      });
      assert(!(await isNearBottom()), "sanity check: scrolling to the top should move away from the bottom");

      await page.locator(".change-card").first().locator('button[aria-label="Accept"]').click();
      await page.waitForTimeout(300);

      assert(!(await isNearBottom()), "accepting a card already in view shouldn't yank the transcript down to the bottom");
    })) && ok;
  });

  return ok;
}
