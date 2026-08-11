import { assert, closeContext, mockApi, openContext, openManageWithAI, setApiKey, showSheetPanelTab, test, withFreshPage } from "./support.mjs";

// Coverage for ManageWithAIPanel — the AI-collaboration surface,
// reimagined as a one-shot review UI (button in the Context panel header)
// instead of the old embedded back-and-forth chat editor (SheetEditor.tsx,
// removed). One instruction in, suggestions shown as before/after change
// cards out, accept/reject/revise per card — no message transcript.
//
// Was originally a centered modal with a dimmed backdrop; now it
// temporarily occupies the Chats sidebar column (replacing the sheet
// switcher) instead, so the chat pane and Context panel stay visible and
// interactive the whole time it's open — that's the point of this design
// and gets its own coverage below, not just the accept/reject/revise
// mechanics carried over from the modal version.
export async function run(browser, baseUrl) {
  let ok = true;

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");

    ok =
      (await test("the Context panel header shows Manage with AI, and opens the panel in place of the chat list", async () => {
        await openContext(page);
        assert(await page.locator(".manage-ai-trigger").isVisible(), "trigger button should sit in the Context header");
        assert(!(await page.locator(".manage-ai-trigger").evaluate((el) => el.classList.contains("manage-ai-trigger--active"))), "trigger should not look active before the panel is open");

        await page.click(".manage-ai-trigger");
        assert(await page.locator(".manage-ai-panel").isVisible(), "panel should open");
        assert((await page.locator(".manage-ai-panel .sidebar-title").textContent()).includes("Manage with AI"), "panel should be titled correctly");
        assert((await page.locator(".sheet-switcher").count()) === 0, "the chat list should be replaced, not just overlaid");
        assert(await page.locator(".manage-ai-input-row textarea").isVisible(), "instruction textarea should be visible");
        assert(
          (await page.locator(".manage-ai-label").textContent()).includes("restructured"),
          "the instruction label above the field should explain what it's for",
        );
        assert((await page.locator(".manage-ai-empty").textContent()) === "Nothing proposed yet.", "should show a plain empty-state hint before any instruction is submitted");

        // Clicking the trigger always closes Context as a side effect
        // (App.tsx's openManageWithAIFromContext) — the trigger only ever
        // exists inside Context's own header, so it's gone the instant
        // Context closes. Verifying it now shows as active means
        // reopening Context (an independent toggle from Manage with AI
        // itself) and checking the freshly-rendered trigger there.
        assert((await page.locator(".manage-ai-trigger").count()) === 0, "the trigger is gone along with Context, which just closed");
        await openContext(page);
        assert(await page.locator(".manage-ai-trigger").evaluate((el) => el.classList.contains("manage-ai-trigger--active")), "trigger should look active once reopened, since the panel it opens is still open");
        await closeContext(page);
      })) && ok;

    ok =
      (await test("the chat pane stays visible and interactive while the Manage with AI panel is open", async () => {
        // Context, unlike before, is a full app-body takeover at every
        // width (not a sidebar) — it can't be genuinely simultaneous with
        // the chat pane or Manage with AI's panel, only independently
        // reachable. What actually stays visible/interactive alongside
        // Manage with AI is the chat pane itself, since the panel only
        // occupies the chats-sidebar column, not the whole app-body.
        assert(await page.locator(".chat-pane").isVisible(), "the main chat pane should still be visible");
        assert(await page.locator(".chats-sidebar .manage-ai-panel").isVisible(), "Manage with AI should occupy the chats sidebar column, not a separate overlay");

        // Actually interact with the chat pane, not just check visibility.
        await page.fill(".chat-input-row textarea", "still usable");
        assert((await page.locator(".chat-input-row textarea").inputValue()) === "still usable", "the main chat textarea should still accept input");

        // Context is still independently reachable via its header button.
        await showSheetPanelTab(page, "memories");
        assert(await page.locator(".sheet-section", { hasText: "Memories" }).first().isVisible(), "Context should still be reachable while Manage with AI is open");
        await closeContext(page);
      })) && ok;

    ok =
      (await test("submitting an instruction shows change cards, not a chat reply", async () => {
        await closeContext(page);
        await mockApi(page, () => ({
          text: `Sure, here's what I'd change.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"tone_update","body":"Warm and casual."},{"type":"new_memory","label":"Pet","body":"A cat named Milo"}]\n-->`,
        }));

        await page.fill(".manage-ai-input-row textarea", "make the tone warmer and remember my cat");
        await page.click(".manage-ai-input-row button");
        await page.waitForTimeout(400);

        const cards = page.locator(".change-card");
        assert((await cards.count()) === 2, `expected 2 change cards, got ${await cards.count()}`);

        const toneCard = cards.filter({ hasText: "Tone update" });
        assert((await toneCard.locator(".change-card-before").textContent()) === "Clear and direct; match the user's register.", "tone card should show the current tone as before");
        assert((await toneCard.locator(".change-card-after").textContent()) === "Warm and casual.", "tone card should show the proposed tone as after");

        const memoryCard = cards.filter({ hasText: "New memory" });
        assert((await memoryCard.locator(".change-card-before").count()) === 0, "a brand-new memory has no before state");
        assert((await memoryCard.locator(".change-card-after").textContent()) === "Pet: A cat named Milo", "memory card should show the proposed memory as after");

        assert((await page.locator(".manage-ai-note").textContent()) === "Sure, here's what I'd change.", "any conversational text should show as a small note, not a chat bubble");
        assert((await page.locator(".chat-message").count()) === 0, "nothing here should render as a .chat-message — that's the whole point of not being a chat");
      })) && ok;

    ok =
      (await test("accepting a change card actually applies it, then the card disappears rather than sticking around with a badge", async () => {
        await page.locator(".change-card", { hasText: "Tone update" }).locator('.suggestion-actions button[aria-label="Accept"]').click();
        await page.waitForTimeout(300);
        assert(
          (await page.locator(".change-card", { hasText: "Tone update" }).count()) === 0,
          "an accepted card should vanish immediately, not linger with an 'accepted' badge — Context/History are the record of it now",
        );

        await showSheetPanelTab(page, "chat");
        const toneTextarea = page.locator(".inline-field", { hasText: "Tone" }).first().locator("textarea");
        assert((await toneTextarea.inputValue()) === "Warm and casual.", "accepting the tone_update card should have actually updated the sheet's Tone");
      })) && ok;

    ok =
      (await test("rejecting a change card leaves the sheet unchanged, and the card disappears too", async () => {
        await closeContext(page);
        await page.locator(".change-card", { hasText: "New memory" }).locator('.suggestion-actions button[aria-label="Reject"]').click();
        await page.waitForTimeout(200);
        assert((await page.locator(".change-card").count()) === 0, "a rejected card should vanish immediately, same as an accepted one");
        assert((await page.locator(".manage-ai-note").count()) === 0, "once every card from a response is resolved, its explanatory note should clear too, not linger orphaned");

        await showSheetPanelTab(page, "memories");
        const memSection = page.locator(".sheet-section", { hasText: "Memories" }).first();
        assert(!(await memSection.locator(".memory-list").textContent()).includes("Milo"), "rejected memory should never have been added");
        await showSheetPanelTab(page, "chat");
      })) && ok;

    ok =
      (await test("the model saying no changes are warranted shows a plain message, not empty cards", async () => {
        // Both cards from the previous response are now resolved (one
        // accepted, one rejected), so the panel should already be back to
        // zero change-cards before this response even lands.
        await closeContext(page);
        assert((await page.locator(".change-card").count()) === 0, "sanity check: no undecided cards should remain from the previous response");

        await mockApi(page, () => "No changes are warranted here.");
        await page.fill(".manage-ai-input-row textarea", "anything else to clean up?");
        await page.click(".manage-ai-input-row button");
        await page.waitForTimeout(300);

        assert((await page.locator(".change-card").count()) === 0, "a response with no suggestions should add zero change cards");
        assert(await page.locator(".manage-ai-empty", { hasText: "No changes are warranted here." }).isVisible(), "the model's own explanation should be shown as a plain message");
      })) && ok;

    ok =
      // unlike a change card (gone once accepted/rejected) or
      // a note alongside one (gone once its cards resolve), a "no changes"
      // response had no suggestion of its own to ever make it go away —
      // it just sat there permanently until this dismiss button existed.
      (await test("a 'no changes needed' response can be dismissed", async () => {
        const block = page.locator(".manage-ai-empty", { hasText: "No changes are warranted here." });
        await block.locator("button[aria-label=\"Dismiss\"]").click();
        assert((await page.locator(".manage-ai-empty", { hasText: "No changes are warranted here." }).count()) === 0, "dismissing should actually remove the response, not just visually hide it");
      })) && ok;

    ok =
      (await test("clicking Revise re-aims the top field, showing Cancel until something's typed", async () => {
        await mockApi(page, () => ({
          text: `<!-- SHEET_SUGGESTIONS\n[{"type":"new_memory","label":"Coffee","body":"Drinks it black"}]\n-->`,
        }));
        await page.fill(".manage-ai-input-row textarea", "remember my coffee order");
        await page.click(".manage-ai-go");
        await page.waitForTimeout(300);

        const coffeeCard = page.locator(".change-card", { hasText: "Drinks it black" });
        assert(await coffeeCard.isVisible(), "the proposed coffee-memory card should be visible while pending");
        assert((await coffeeCard.locator(".revise-with-ai-button").textContent()) === "Revise with AI", "the trigger should read as real text, not a bare, ambiguous icon");
        await coffeeCard.locator(".revise-with-ai-button").click();

        assert((await page.locator(".manage-ai-label").textContent()).startsWith("How should this change?"), "the top label should swap to the revision question, not open a separate form on the card");
        assert((await page.locator(".manage-ai-go").count()) === 0, "the normal Go button should be replaced");

        // Send and Cancel now share one slot rather than
        // showing together — with nothing typed yet, that slot is Cancel.
        assert(await page.locator(".manage-ai-cancel").isVisible(), "with nothing typed yet, the button should read Cancel");
        assert((await page.locator(".manage-ai-send").count()) === 0, "Send shouldn't show until there's something to send");

        await page.fill(".manage-ai-input-row textarea", "actually oat milk");
        assert(await page.locator(".manage-ai-send").isVisible(), "typing something should flip the button to Send");
        assert((await page.locator(".manage-ai-cancel").count()) === 0, "Cancel should stop showing once there's a draft ready to send");
        await page.fill(".manage-ai-input-row textarea", ""); // back to empty, so the next test's Cancel click has something to find

        assert(await coffeeCard.evaluate((el) => el.classList.contains("change-card--revising")), "the targeted card should visibly highlight itself as the target");
        assert(await coffeeCard.locator('.suggestion-actions button[aria-label="Accept"]').isDisabled(), "the targeted card's own Accept/Reject/Revise should be inert while it's being revised");
      })) && ok;

    ok =
      (await test("Cancel backs out of revising without submitting anything", async () => {
        const coffeeCard = page.locator(".change-card", { hasText: "Drinks it black" });
        await page.click(".manage-ai-cancel");

        assert((await page.locator(".manage-ai-label").textContent()).startsWith("Describe how you want"), "the label should revert to the normal instruction prompt");
        assert(await page.locator(".manage-ai-go").isVisible(), "the normal Go button should return");
        assert(!(await coffeeCard.evaluate((el) => el.classList.contains("change-card--revising"))), "the card should stop looking targeted");
        assert(!(await coffeeCard.locator('.suggestion-actions button[aria-label="Accept"]').isDisabled()), "the card's own actions should be usable again");
        assert(await coffeeCard.isVisible(), "the original card should still be pending, untouched by the cancelled revision");
      })) && ok;

    ok =
      (await test("submitting from the re-aimed field sends a follow-up call; the original disappears and the result shows as a new pending card", async () => {
        const coffeeCard = page.locator(".change-card", { hasText: "Drinks it black" });
        await coffeeCard.locator(".revise-with-ai-button").click();

        await mockApi(page, () => ({
          text: `<!-- SHEET_SUGGESTIONS\n[{"type":"new_memory","label":"Coffee","body":"Oat milk latte, no sugar"}]\n-->`,
        }));
        await page.fill(".manage-ai-input-row textarea", "actually it's an oat milk latte, no sugar");
        await page.click(".manage-ai-send");
        await page.waitForTimeout(300);

        assert((await page.locator(".change-card", { hasText: "Drinks it black" }).count()) === 0, "the original card should disappear once revised, not linger with a 'revised' badge");
        const revisedCard = page.locator(".change-card", { hasText: "Oat milk latte" });
        assert(await revisedCard.isVisible(), "the revision's result should show up as its own new, pending change card");
        assert((await page.locator(".change-card").count()) === 1, "only the new card should remain, not both");
        assert((await page.locator(".manage-ai-label").textContent()).startsWith("Describe how you want"), "the field should return to normal once the revision resolves");
      })) && ok;

    ok =
      (await test("a failed card (target no longer exists) can be dismissed via Reject even though it has no Accept", async () => {
        // deactivate_memory targeting an id that doesn't exist in the
        // current sheet fails visibly rather than silently no-opping
        // — same mechanic as edit_memory's failure
        // path, covered for the chat pane in globalMemories.e2e.mjs. The
        // suggestion itself starts out pending like any other — "failed" is
        // only discovered once Accept is actually clicked and the target
        // turns out not to exist.
        await mockApi(page, () => ({
          text: `<!-- SHEET_SUGGESTIONS\n[{"type":"deactivate_memory","memoryId":"does-not-exist","reason":"no longer relevant"}]\n-->`,
        }));
        await page.fill(".manage-ai-input-row textarea", "turn off that old memory");
        await page.click(".manage-ai-input-row button");
        await page.waitForTimeout(300);

        const deactivateCard = page.locator(".change-card", { hasText: "Deactivate memory" });
        assert(await deactivateCard.isVisible(), "the proposed deactivation should show as a normal pending card first");
        await deactivateCard.locator('.suggestion-actions button[aria-label="Accept"]').click();
        await page.waitForTimeout(300);

        assert(await page.locator(".change-card", { hasText: "memory not found" }).isVisible(), "accepting a suggestion whose target no longer exists should fail visibly");
        assert((await deactivateCard.locator('.suggestion-actions button[aria-label="Accept"]').count()) === 0, "a failed card has nothing left to accept");

        await deactivateCard.locator('.suggestion-actions button[aria-label="Reject"]').click();
        await page.waitForTimeout(200);
        // Scoped to this specific card, not the total count — the previous
        // test's revised "Coffee" card was deliberately left pending (never
        // resolved), so it's still legitimately in the list here too.
        assert((await page.locator(".change-card", { hasText: "Deactivate memory" }).count()) === 0, "rejecting (dismissing) a failed card should remove it, same as any other resolved card");
      })) && ok;

    ok =
      (await test("the Back button and Escape both restore the normal chat list", async () => {
        await closeContext(page);
        assert(await page.locator(".manage-ai-panel").isVisible(), "sanity check: panel should still be open");
        await page.click(".manage-ai-back");
        assert((await page.locator(".manage-ai-panel").count()) === 0, "Back button should close the panel");
        assert(await page.locator(".sheet-switcher").isVisible(), "the chats sidebar should be usable again");

        // The trigger only exists inside Context's own header now, so
        // checking it no longer looks active means reopening Context first.
        await openContext(page);
        assert(!(await page.locator(".manage-ai-trigger").evaluate((el) => el.classList.contains("manage-ai-trigger--active"))), "trigger should stop looking active once Back closes the panel");

        await page.click(".manage-ai-trigger");
        assert(await page.locator(".manage-ai-panel").isVisible(), "reopen for the Escape check");
        await page.keyboard.press("Escape");
        assert((await page.locator(".manage-ai-panel").count()) === 0, "Escape should close the panel too");
        assert(await page.locator(".sheet-switcher").isVisible(), "Escape should restore the chat list too");
      })) && ok;

    // Clicking the trigger always force-opens Manage with AI and closes
    // Context (App.tsx's openManageWithAIFromContext) — it was never a
    // real open/close toggle, even before Context became a full app-body
    // overlay. Re-clicking it while the panel is already open just closes
    // Context (already a no-op from Manage with AI's own perspective) and
    // re-opens the panel, which was already open — it does not close it,
    // unlike Back/Escape above.
    ok =
      (await test("clicking the trigger again while the panel is already open keeps it open, not closes it", async () => {
        await openContext(page);
        await page.click(".manage-ai-trigger");
        assert(await page.locator(".manage-ai-panel").isVisible(), "reopen for this check");

        await openContext(page);
        assert(await page.locator(".manage-ai-trigger").evaluate((el) => el.classList.contains("manage-ai-trigger--active")), "sanity check: trigger should look active while open");
        await page.click(".manage-ai-trigger");

        assert(await page.locator(".manage-ai-panel").isVisible(), "the panel should still be open — the trigger only ever opens it, it never closes it");
        assert((await page.locator(".context-overlay").count()) === 0, "Context itself should be closed, since the trigger's click always closes it as a side effect");
        assert(await page.locator(".sheet-switcher").count() === 0, "the chats sidebar should still show Manage with AI, not have reverted to the chat list");
      })) && ok;
  });

  // A separate, isolated scenario (own withFreshPage, own dev-server session)
  // rather than folded into the sequential flow above — this specifically
  // covers the two surfaces' persisted logs *not* leaking into each other.
  // They used to share one undifferentiated per-sheet message store
  // (messagesStore.ts filtered only by sheetId, with no mode field at all),
  // so a pending suggestion from the regular chat would show up as a change
  // card here, and a Manage-with-AI instruction/reply would show up inline
  // in the chat transcript. Both directions get their own check.
  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");

    ok =
      (await test("a chat-originated suggestion does not leak into Manage with AI's card list", async () => {
        // chat-mode suggestions auto-apply now, so there's no
        // "pending" state to observe here — the tone_update has already
        // applied by the time this checks. What's still being tested is
        // the same mode-scoping guarantee as before: a chat-
        // mode message never shows up rendered as a Manage with AI card,
        // applied or not.
        await mockApi(page, () => ({
          text: `<!-- SHEET_SUGGESTIONS\n[{"type":"tone_update","body":"CHAT_ORIGINATED_TONE"}]\n-->`,
        }));
        await page.fill(".chat-input-row textarea", "make it warmer");
        await page.click('.chat-pane .chat-input-row button[type="submit"]');
        await page.waitForTimeout(400);
        assert(
          await page.locator(".toast--applied", { hasText: "Tone updated" }).isVisible(),
          "sanity check: the chat pane itself should record the applied tone suggestion via a toast",
        );

        await openContext(page);
        await page.click(".manage-ai-trigger");
        // ManageWithAIPanel is mounting for the first time here, which
        // kicks off its own async IndexedDB load (see useSuggestionSession's
        // effect) — without waiting for that to settle, an empty result is
        // ambiguous between "correctly filtered out" and "just hasn't
        // loaded yet," which would let a broken filter pass this check for
        // the wrong reason.
        await page.waitForTimeout(400);
        assert(
          (await page.locator(".change-card", { hasText: "CHAT_ORIGINATED_TONE" }).count()) === 0,
          "a suggestion proposed via the regular chat should not show up as a change card in Manage with AI",
        );
        assert((await page.locator(".manage-ai-empty").isVisible()), "Manage with AI should show its own empty state, unaware of the chat's pending suggestion");
      })) && ok;

    ok =
      (await test("a Manage with AI instruction and its reply do not leak into the main chat transcript", async () => {
        await mockApi(page, () => ({
          text: `<!-- SHEET_SUGGESTIONS\n[{"type":"new_memory","label":"Leak Test","body":"SHEET_EDITOR_ORIGINATED"}]\n-->`,
        }));
        await page.fill(".manage-ai-input-row textarea", "remember something via manage with AI");
        await page.click(".manage-ai-input-row button");
        await page.waitForTimeout(400);
        assert(
          await page.locator(".change-card", { hasText: "SHEET_EDITOR_ORIGINATED" }).isVisible(),
          "sanity check: Manage with AI itself should show the pending memory suggestion",
        );

        // ChatPane mounted (and loaded) long before this instruction was
        // ever saved, so its already-in-memory state wouldn't show a leak
        // even if one existed — a reload forces it to actually re-fetch
        // from IndexedDB, the same persistence path a real return visit
        // would hit.
        await page.reload();
        await page.waitForSelector(".sheet-switcher");
        await page.waitForTimeout(400);
        assert(
          (await page.locator(".chat-message", { hasText: "remember something via manage with AI" }).count()) === 0,
          "a Manage with AI instruction should not show up as a chat message in the main transcript",
        );
      })) && ok;
  });

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");

    ok =
      (await test("Manage with AI's own note text also renders as markdown, not literal syntax", async () => {
        await mockApi(page, () => ({
          text: `I'd suggest **pruning** the duplicates.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"new_memory","label":"Item","body":"body"}]\n-->`,
        }));
        await openManageWithAI(page);
        await page.fill(".manage-ai-input-row textarea", "clean this up");
        await page.click(".manage-ai-go");
        await page.waitForTimeout(400);

        const note = page.locator(".manage-ai-note");
        assert((await note.locator("strong", { hasText: "pruning" }).count()) === 1, "**bold** in the note should render as <strong>, not literal asterisks");
        assert(!(await note.textContent()).includes("**"), "no literal markdown syntax should remain in the rendered note");
      })) && ok;
  });

  // a fresh page with no API key ever set, specifically to
  // reach runCall's "No API key set" error path — every other
  // scenario in this file calls setApiKey first, which would make an
  // error response harder to trigger deliberately.
  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");

    ok =
      (await test("an error response can be dismissed, same as a 'no changes' response", async () => {
        await openManageWithAI(page);
        await page.fill(".manage-ai-input-row textarea", "do something");
        await page.click(".manage-ai-go");
        await page.waitForTimeout(300);

        const errorBlock = page.locator(".manage-ai-error", { hasText: "No API key set" });
        assert(await errorBlock.isVisible(), "sanity check: sending with no API key configured should surface an error response");

        await errorBlock.locator('button[aria-label="Dismiss"]').click();
        assert((await page.locator(".manage-ai-error").count()) === 0, "dismissing the error should actually remove it");
      })) && ok;
  });

  return ok;
}
