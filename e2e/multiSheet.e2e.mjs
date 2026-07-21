import { assert, createChat, mockApi, setApiKey, showSheetPanelTab, test, withFreshPage } from "./support.mjs";

// Bootstrap, create/switch, per-sheet chat log
// isolation, persistence across a real page reload, rename, and — the
// architectural guarantee — that the persisted chat
// log never leaks into a request's system prompt.
export async function run(browser, baseUrl) {
  let ok = true;

  await withFreshPage(browser, async (page) => {
    ok = (await test("bootstraps exactly one default chat on first load", async () => {
      await page.goto(baseUrl);
      await page.waitForSelector(".sheet-switcher");
      assert((await page.locator(".sheet-switcher-item").count()) === 1, "expected exactly one sheet on first load");
    })) && ok;

    await setApiKey(page, "sk-ant-fake-key");
    const requestSystems = [];
    await mockApi(page, (body) => {
      requestSystems.push(body.system);
      return `Reply.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"conversation_summary_update","body":"turn body"}]\n-->`;
    });

    ok = (await test("a chat message on Chat 1 is persisted and visible", async () => {
      await page.fill(".chat-input-row textarea", "SHEET1_MESSAGE_UNIQUE_TOKEN");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(500);
      const count = await page.locator(".chat-pane:not(.chat-pane--embedded) .chat-message").count();
      assert(count === 2, `expected 2 messages (user+assistant), got ${count}`);
    })) && ok;

    ok = (await test("creating a new sheet starts with an empty, isolated chat log", async () => {
      await createChat(page, "Chat Two");
      await page.waitForTimeout(400);
      assert((await page.locator(".sheet-switcher-item").count()) === 2, "expected two sheets after creating one");
      const count = await page.locator(".chat-pane:not(.chat-pane--embedded) .chat-message").count();
      assert(count === 0, `expected Chat Two's chat log to start empty, got ${count} messages`);
    })) && ok;

    ok = (await test("switching back to Chat 1 restores its own persisted messages only", async () => {
      await page.locator(".sheet-switcher-name", { hasText: "Chat 1" }).click();
      await page.waitForTimeout(400);
      const texts = await page.locator(".chat-pane:not(.chat-pane--embedded) .chat-message").allTextContents();
      assert(texts.some((t) => t.includes("SHEET1_MESSAGE_UNIQUE_TOKEN")), "Chat 1's own message should be restored");
    })) && ok;

    ok = (await test("a full page reload preserves the active sheet and its message log", async () => {
      await page.reload();
      await page.waitForSelector(".sheet-switcher");
      await page.waitForTimeout(300);
      const activeName = await page.locator(".sheet-switcher-item--active .sheet-switcher-name").textContent();
      assert(activeName?.includes("Chat 1"), `expected Chat 1 to still be active after reload, got "${activeName}"`);
      const texts = await page.locator(".chat-pane:not(.chat-pane--embedded) .chat-message").allTextContents();
      assert(texts.some((t) => t.includes("SHEET1_MESSAGE_UNIQUE_TOKEN")), "message should survive a real reload");
    })) && ok;

    ok = (await test("renaming a chat updates the switcher", async () => {
      await page.locator(".sheet-switcher-item", { hasText: "Chat 1" }).locator('button[aria-label^="Rename"]').click();
      await page.fill(".sheet-switcher-item input[type=text]", "Renamed Chat");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);
      const activeName = await page.locator(".sheet-switcher-item--active .sheet-switcher-name").textContent();
      assert(activeName === "Renamed Chat", `expected rename to apply, got "${activeName}"`);
    })) && ok;

    ok = (await test("the persisted chat log never leaks into any request's system prompt", () => {
      const leaked = requestSystems.some((s) => s.includes("SHEET1_MESSAGE_UNIQUE_TOKEN"));
      assert(!leaked, "chat log text must never appear in a system prompt (statelessness)");
      assert(requestSystems.length === 1, `expected exactly 1 API call across this scenario, got ${requestSystems.length}`);
    })) && ok;

    ok = (await test("a long transcript scrolls within .chat-messages instead of growing the whole page", async () => {
      for (let i = 0; i < 12; i++) {
        await page.fill(".chat-input-row textarea", `filler message ${i}`);
        await page.click('.chat-pane .chat-input-row button[type="submit"]');
        await page.waitForTimeout(120);
      }
      await page.waitForTimeout(300);

      const heights = await page.evaluate(() => {
        const chatMessages = document.querySelector(".chat-messages");
        return {
          documentScrollHeight: document.documentElement.scrollHeight,
          windowInnerHeight: window.innerHeight,
          chatMessagesScrollHeight: chatMessages.scrollHeight,
          chatMessagesClientHeight: chatMessages.clientHeight,
        };
      });

      assert(
        heights.documentScrollHeight <= heights.windowInnerHeight + 2,
        `the page itself should not grow past the viewport (document ${heights.documentScrollHeight}px vs window ${heights.windowInnerHeight}px)`,
      );
      assert(
        heights.chatMessagesScrollHeight > heights.chatMessagesClientHeight + 100,
        ".chat-messages should have real overflow content scrolling internally, not just fit everything by growing",
      );
    })) && ok;

    ok = (await test("the chat pane auto-scrolls to the newest message as the transcript grows", async () => {
      // Reuses the transcript grown by the previous test (12 filler
      // messages plus their auto-generated replies) — already tall enough
      // to scroll, per that test's own assertion.
      const isNearBottom = () =>
        page.evaluate(() => {
          const el = document.querySelector(".chat-messages");
          return el.scrollHeight - el.scrollTop - el.clientHeight < 4;
        });
      assert(await isNearBottom(), "after sending a batch of messages, the view should already be scrolled to the latest one");

      // Scroll away on purpose, then confirm a genuinely new message pulls
      // the view back down rather than leaving it wherever it was.
      await page.evaluate(() => {
        document.querySelector(".chat-messages").scrollTop = 0;
      });
      assert(!(await isNearBottom()), "sanity check: scrolling to the top should actually move away from the bottom");

      await page.fill(".chat-input-row textarea", "one more after scrolling up");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(300);

      assert(await isNearBottom(), "a new message landing should scroll the view back to the bottom, even after manually scrolling away");
    })) && ok;

    ok = (await test("a long Conversation Summary scrolls within the Context panel instead of growing the whole page", async () => {
      // Regression coverage for a real, confirmed bug: accepting many
      // conversation_summary_update suggestions grows .sheet-panel-tab-
      // content (inside the Context panel's "This Chat" tab) tall enough
      // that its full, unclipped layout size leaked into the *document's*
      // own scrollable-overflow computation — an invisible, ever-taller
      // gap you could scroll into at the bottom of the whole page, even
      // though .controls-sidebar/.sheet-panel themselves reported
      // perfectly normal, bounded heights the whole time. Confirmed via
      // direct DOM measurement (window.scrollTo actually moved the page)
      // before finding the fix: contain: layout on .sheet-panel (App.css).
      //
      // conversation_summary_update auto-applies now — no
      // accept click needed to grow the Conversation Summary, sending the
      // message is enough on its own.
      for (let i = 0; i < 15; i++) {
        await page.fill(".chat-input-row textarea", `summary source ${i}`);
        await page.click('.chat-pane .chat-input-row button[type="submit"]');
        await page.waitForTimeout(150);
      }
      await page.waitForTimeout(300);

      const before = await page.evaluate(() => ({ scrollHeight: document.documentElement.scrollHeight, innerHeight: window.innerHeight }));
      assert(
        before.scrollHeight <= before.innerHeight + 2,
        `the page itself should not grow past the viewport as Conversation Summary accumulates (document ${before.scrollHeight}px vs window ${before.innerHeight}px)`,
      );

      // Belt-and-suspenders: actually try to scroll the window and confirm
      // it doesn't move — scrollHeight alone can be misleading (it's not
      // itself proof anything is visibly scrollable), this is the direct
      // symptom a real user would hit.
      await page.evaluate(() => window.scrollTo(0, 2000));
      const scrollY = await page.evaluate(() => window.scrollY);
      assert(scrollY === 0, `the window should not be scrollable at all — an invisible scrollable gap would let it move (scrollY landed at ${scrollY})`);
    })) && ok;
  });

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");

    ok = (await test("both sidebars are open by default", async () => {
      assert(await page.locator(".chats-sidebar").isVisible(), "chats sidebar should be visible on first load");
      assert(await page.locator(".controls-sidebar").isVisible(), "details sidebar should be visible on first load");
    })) && ok;

    ok = (await test("hiding/showing the chats sidebar via its edge handle toggles visibility without unmounting it", async () => {
      await page.click(".chats-sidebar-handle");
      assert(!(await page.locator(".chats-sidebar").isVisible()), "chats sidebar should be hidden after toggling");
      assert((await page.locator(".sheet-switcher-item").count()) > 0, "switcher content should stay mounted, just hidden");
      assert(await page.locator(".chats-sidebar-handle").isVisible(), "the handle itself must stay visible/reachable even while its sidebar is hidden");

      await page.click(".chats-sidebar-handle");
      assert(await page.locator(".chats-sidebar").isVisible(), "chats sidebar should be visible again after toggling back");
    })) && ok;

    ok = (await test("hiding/showing the details sidebar via its edge handle preserves in-progress state", async () => {
      const toneTextarea = page.locator(".inline-field", { hasText: "Tone" }).first().locator("textarea");
      await toneTextarea.fill("UNSAVED_DRAFT_TEXT");

      await page.click(".controls-sidebar-handle");
      assert(!(await page.locator(".controls-sidebar").isVisible()), "details sidebar should be hidden after toggling");

      await page.click(".controls-sidebar-handle");
      assert(await toneTextarea.inputValue() === "UNSAVED_DRAFT_TEXT", "an unsaved draft must survive a hide/show cycle (component stays mounted)");
    })) && ok;
  });

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");

    ok = (await test("the chat header shows the active chat's name and updates on switch", async () => {
      assert((await page.locator(".chat-header-title").textContent()) === "Chat 1", "header should show the bootstrap chat's name");

      await createChat(page, "Header Test Chat");
      await page.waitForTimeout(400);
      assert((await page.locator(".chat-header-title").textContent()) === "Header Test Chat", "header should update to the newly-created (now active) chat's name");
    })) && ok;

    ok = (await test("the chat header stays reachable even with the chats sidebar collapsed", async () => {
      await page.click(".chats-sidebar-handle");
      assert(await page.locator(".chat-header-title").isVisible(), "chat name should still be visible with the chats sidebar hidden");
      await page.click(".chats-sidebar-handle"); // reopen for hygiene
    })) && ok;

    ok = (await test("Export/Import live at the bottom of the This Chat tab, not the chat header", async () => {
      assert(
        await page.locator(".sheet-panel-footer .export-import-buttons button:has-text('Export')").isVisible(),
        "Export button should be visible at the bottom of the This Chat tab",
      );
      assert(
        await page.locator(".sheet-panel-footer .export-import-buttons button:has-text('Import')").isVisible(),
        "Import button should be visible at the bottom of the This Chat tab",
      );
      assert((await page.locator(".chat-header .export-import-buttons").count()) === 0, "Export/Import should no longer be in the chat header");

      // Unrelated column — collapsing the chats sidebar shouldn't affect it.
      await page.click(".chats-sidebar-handle");
      assert(await page.locator(".sheet-panel-footer .export-import-buttons button:has-text('Export')").isVisible(), "Export/Import should stay reachable with the chats sidebar collapsed");
      await page.click(".chats-sidebar-handle"); // reopen

      // But now that Export/Import live inside the Context panel's own tab
      // content, they're subject to the same visibility rules as the rest
      // of it — hidden when a different tab is active...
      await showSheetPanelTab(page, "memories");
      assert(!(await page.locator(".sheet-panel-footer").isVisible()), "Export/Import should be hidden while a different tab (Memories) is active");
      await showSheetPanelTab(page, "chat");

      // ...and hidden when the Context panel itself is collapsed, unlike
      // before when they lived in the always-visible chat header.
      await page.click(".controls-sidebar-handle");
      assert(!(await page.locator(".sheet-panel-footer").isVisible()), "Export/Import should be hidden when the Context panel itself is collapsed, since they now live inside it");
      await page.click(".controls-sidebar-handle"); // reopen for hygiene
    })) && ok;
  });

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");

    ok = (await test("the gear icon has a hover tooltip", async () => {
      assert((await page.getAttribute('button[aria-label="Settings"]', "title")) === "Settings", "gear icon should have a 'Settings' tooltip");
    })) && ok;

    ok = (await test("the gear icon opens a Settings modal; Escape closes it", async () => {
      assert((await page.locator(".modal").count()) === 0, "modal should not be open yet");
      await page.click('button[aria-label="Settings"]');
      assert(await page.locator(".modal").isVisible(), "Settings modal should open");
      assert(await page.locator('input[aria-label="Anthropic API key"]').isVisible(), "API key input should live inside the modal");

      await page.keyboard.press("Escape");
      // Settings is a native <dialog> now — Escape's cancel/close events land
      // a tick after Playwright's keypress resolves, not synchronously with it.
      await page.waitForTimeout(150);
      assert((await page.locator(".modal").count()) === 0, "Escape should close the modal");
    })) && ok;

    ok = (await test("the header no longer has a Memories shortcut — clicking the panel's own Memories tab is the only way in", async () => {
      assert((await page.locator('button[aria-label="Memories"]').count()) === 0, "header should not have a brain/Memories icon button anymore");

      await page.click('.sheet-panel-tab:has-text("Memories")');
      assert(
        await page.locator('.sheet-panel-tab:has-text("Memories")').evaluate((el) => el.classList.contains("sheet-panel-tab--active")),
        "clicking the Memories tab directly should still switch to it",
      );
      assert(await page.locator(".sheet-section", { hasText: "Memories" }).first().isVisible(), "Memories tab content should be visible");
    })) && ok;
  });

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");

    ok = (await test("+ New chat has no name field — it creates a chat named \"New chat\" and auto-focuses the header's rename field", async () => {
      assert((await page.locator(".sheet-switcher-new").textContent()) === "+ New chat", "the button itself carries no name input alongside it");

      await page.click(".sheet-switcher-new");
      const input = page.locator(".chat-header-title-form input");
      await input.waitFor({ state: "visible" }); // createSheet is async — isVisible()/inputValue() below don't auto-wait like fill()/click() do
      assert((await input.inputValue()) === "New chat", "the new chat's default name should be \"New chat\"");
      assert(await input.evaluate((el) => el === document.activeElement), "the rename field should be auto-focused");

      await page.keyboard.press("Enter");
      // renameSheet is fire-and-forget from ChatHeaderTitle's commit() (same
      // pattern as SheetSwitcher's own commitRename) — the header switches
      // out of editing mode immediately, but .chat-header-title's text comes
      // from the sheets store prop, which only catches up once the async
      // write + notify + refetch cycle completes. Every other rename
      // assertion in this file already waits for that; this one needs to too.
      await page.waitForTimeout(300);
      assert((await page.locator(".chat-header-title").textContent()) === "New chat", "leaving the default untouched keeps the name \"New chat\"");
    })) && ok;

    ok = (await test("typing over the auto-focused default names the chat as typed", async () => {
      await createChat(page, "Second Chat");
      await page.waitForTimeout(300);
      assert((await page.locator(".chat-header-title").textContent()) === "Second Chat", "typed name should replace the pre-selected default");
      assert((await page.locator(".sheet-switcher-item--active .sheet-switcher-name").textContent()) === "Second Chat", "the switcher should reflect the typed name too");
    })) && ok;

    ok = (await test("the header's rename icon still works after the auto-focus moment has passed, independent of the sidebar's own pencil", async () => {
      await page.click('.chat-header-title-row button[aria-label^="Rename"]');
      await page.fill(".chat-header-title-form input", "Renamed From Header");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);
      assert((await page.locator(".chat-header-title").textContent()) === "Renamed From Header", "manual header rename should still work once auto-edit is no longer in play");
    })) && ok;
  });

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");

    ok = (await test("the model's reply renders as actual markdown, not literal syntax", async () => {
      await mockApi(page, () => ({
        text: `Here's what I'd suggest:\n\n- **Keep** it short\n- *Trim* the filler\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"conversation_summary_update","body":"turn"}]\n-->`,
      }));
      await page.fill(".chat-input-row textarea", "any advice?");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(500);

      // Scoped to .markdown-text specifically — the message also contains a
      // sibling .chat-applied-list <ul>/<li> recording the auto-applied
      // conversation_summary_update, which a bare "li" locator would also
      // count.
      const reply = page.locator(".chat-message--assistant").first();
      const markdown = reply.locator(".markdown-text");
      assert((await markdown.locator("li").count()) === 2, "the markdown list should render as real <li> items, not a literal '- ' line");
      assert((await markdown.locator("strong", { hasText: "Keep" }).count()) === 1, "**bold** should render as <strong>, not literal asterisks");
      assert((await markdown.locator("em", { hasText: "Trim" }).count()) === 1, "*italic* should render as <em>, not literal asterisks");
      assert(!(await markdown.textContent()).includes("**"), "no literal markdown syntax should remain in the rendered text");
    })) && ok;

    ok = (await test("the user's own message is never markdown-rendered", async () => {
      await page.fill(".chat-input-row textarea", "**not bold**, just literal");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(500);

      // .last() — this session already has an earlier user message from the
      // previous test ("any advice?"); .first() would grab that one instead.
      const userMessage = page.locator(".chat-message--user").last();
      assert((await userMessage.locator("strong").count()) === 0, "a user's own typed asterisks should never be parsed as markdown");
      assert((await userMessage.textContent()).includes("**not bold**"), "the literal text, asterisks included, should show exactly as typed");
    })) && ok;
  });

  // auto-apply's non-memory suggestion types, and the
  // sequential-apply guarantee for a multi-suggestion batch.
  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");

    ok = (await test("conversation_summary_update auto-applies silently, without a toast", async () => {
      await mockApi(page, () => `<!-- SHEET_SUGGESTIONS\n[{"type":"conversation_summary_update","body":"a quiet turn"}]\n-->`);
      await page.fill(".chat-input-row textarea", "just chatting");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(400);

      assert((await page.locator(".toast").count()) === 0, "conversation_summary_update is mandatory on every turn — a toast for it would fire constantly and say nothing notable, so it applies silently");
      const convoSection = page.locator(".sheet-section", { hasText: "Conversation Summary" }).first();
      assert((await convoSection.textContent()).includes("a quiet turn"), "it should still have actually applied, just without announcing itself");
    })) && ok;

    ok = (await test("a tone_update suggestion auto-applies with a toast", async () => {
      // Paired with a conversation_summary_update so the mandatory-proposal
      // fallback/follow-up mechanism doesn't also kick in and add an extra
      // API round-trip this test doesn't care about.
      await mockApi(
        page,
        () => `<!-- SHEET_SUGGESTIONS\n[{"type":"tone_update","body":"Warm and casual."},{"type":"conversation_summary_update","body":"turn"}]\n-->`,
      );
      await page.fill(".chat-input-row textarea", "be warmer");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(400);

      const toneSection = page.locator(".inline-field", { hasText: "Tone" }).first();
      assert((await toneSection.locator("textarea").inputValue()) === "Warm and casual.", "the tone should already be updated with no manual accept step");
      assert(await page.locator(".toast--applied", { hasText: "Tone updated" }).isVisible(), "a tone_update should announce itself via a toast");
    })) && ok;

    ok = (await test("multiple suggestions in one response apply sequentially and correctly, not just the first", async () => {
      // Includes a conversation_summary_update alongside the two
      // new_memory suggestions specifically so the mandatory-proposal
      // fallback/follow-up mechanism never kicks in —
      // keeps this test focused on sequential-apply correctness, not that
      // separate mechanism.
      await mockApi(
        page,
        () =>
          `<!-- SHEET_SUGGESTIONS\n[{"type":"new_memory","label":"First","body":"one"},{"type":"new_memory","label":"Second","body":"two"},{"type":"conversation_summary_update","body":"remembered two things"}]\n-->`,
      );
      await page.fill(".chat-input-row textarea", "remember two things");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(500);

      await showSheetPanelTab(page, "memories");
      const memText = await page.locator(".sheet-section", { hasText: "Memories" }).first().locator(".memory-list").textContent();
      assert(memText.includes("First") && memText.includes("one"), "the first suggestion in the batch should have applied");
      assert(memText.includes("Second") && memText.includes("two"), "the second suggestion in the batch should also have applied, not been dropped or overwritten by the first");
    })) && ok;
  });

  return ok;
}
