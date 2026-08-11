import { assert, closeContext, mockApi, openManageWithAI, setApiKey, showSheetPanelTab, test, withFreshPage } from "./support.mjs";

// a confirmed real bug, not a hypothetical — normal
// word-wrapping only breaks at spaces, so one long unbroken token (a URL,
// a long id, a run-on word) blew straight through max-width/flex
// constraints in every surface that renders arbitrary user/model text.
// Each check here confirms scrollWidth no longer exceeds clientWidth for a
// deliberately pathological 120-character unbroken string, which is what
// actually caught the bug in the first place — a screenshot alone didn't
// make it obvious, and neither would a text-content assertion.
const LONG_TOKEN = "z".repeat(120);

async function overflows(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el.scrollWidth > el.clientWidth + 1;
  }, selector);
}

export async function run(browser, baseUrl) {
  let ok = true;

  await withFreshPage(browser, async (page) => {
    await page.goto(baseUrl);
    await page.waitForSelector(".sheet-switcher");
    await setApiKey(page, "sk-ant-fake-key");

    ok = (await test("a long unbroken token in an auto-applied memory's body wraps instead of overflowing", async () => {
      // The old inline "applied" list this used to check was removed —
      // Context/History are the durable record now. A new_memory's body
      // permanently lives in the Memories tab's MemoryRow instead.
      await mockApi(page, () => ({
        text: `Got it.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"new_memory","label":"Long","body":"${LONG_TOKEN}"}]\n-->`,
      }));
      await page.fill(".chat-input-row textarea", "remember this");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(400);

      await showSheetPanelTab(page, "memories");
      assert(!(await overflows(page, ".memory-row-main > span")), "the memory row's body should wrap, not overflow its container");
      await closeContext(page); // next test needs the chat input reachable again
    })) && ok;

    ok = (await test("a long unbroken token in the model's own reply wraps instead of overflowing", async () => {
      await mockApi(page, () => `word: ${LONG_TOKEN} end.`);
      await page.fill(".chat-input-row textarea", "hi again");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(400);

      const overflowing = await page.evaluate((token) => {
        const paragraphs = [...document.querySelectorAll(".chat-message--assistant .markdown-text p")];
        const el = paragraphs.find((p) => p.textContent.includes(token.slice(0, 20)));
        return el.scrollWidth > el.clientWidth + 1;
      }, LONG_TOKEN);
      assert(!overflowing, "the assistant's own chat bubble text should wrap, not overflow its container");
    })) && ok;

    ok = (await test("a long unbroken token in a pending ChangeCard's diff text wraps instead of overflowing", async () => {
      // Chat mode always auto-applies now — the only remaining pending-
      // ChangeCard surface is Manage with AI's own mandatory review.
      await openManageWithAI(page);
      await mockApi(page, () => ({
        text: `<!-- SHEET_SUGGESTIONS\n[{"type":"new_memory","label":"Pending","body":"${LONG_TOKEN}"}]\n-->`,
      }));
      await page.fill(".manage-ai-input-row textarea", "pending one");
      await page.click(".manage-ai-go");
      await page.waitForTimeout(400);

      assert(!(await overflows(page, ".change-card-after")), "the pending card's after-text should wrap, not overflow its container");
    })) && ok;

    ok = (await test("a long unbroken token in a Manage with AI 'no changes' response wraps instead of overflowing", async () => {
      // Manage with AI is already open from the previous test.
      await mockApi(page, () => `No changes, but a word: ${LONG_TOKEN} anyway.`);
      await page.fill(".manage-ai-input-row textarea", "anything?");
      await page.click(".manage-ai-go");
      await page.waitForTimeout(400);

      assert(!(await overflows(page, ".manage-ai-empty")), "the .manage-ai-empty response (its dismiss button sits beside the text in the same flex row) should wrap, not overflow");
    })) && ok;

    // .memory-row-body (This Chat's turn/summary rows) didn't
    // exist yet when overflow-wrap was swept across the app, so it was missed — confirmed
    // live with a real long unbroken token before this fix landed.
    ok = (await test("a long unbroken token in a This Chat conversation turn wraps instead of overflowing", async () => {
      await page.click(".manage-ai-back");
      await mockApi(page, () => `ok.\n\n<!-- SHEET_SUGGESTIONS\n[{"type":"conversation_summary_update","body":"word: ${LONG_TOKEN} end."}]\n-->`);
      await page.fill(".chat-input-row textarea", "one more");
      await page.click('.chat-pane .chat-input-row button[type="submit"]');
      await page.waitForTimeout(400);

      await showSheetPanelTab(page, "chat");
      assert(!(await overflows(page, ".memory-row-body")), "a conversation turn's body should wrap, not overflow its row");
    })) && ok;
  });

  return ok;
}
