import { spawn } from "node:child_process";

// Shared harness for the e2e/*.e2e.mjs specs. Deliberately lightweight —
// no @playwright/test runner/config, just enough to (a) boot a real dev
// server against a fixed port, (b) run named checks that report pass/fail
// with a real non-zero exit code instead of console.log a human has to
// eyeball, and (c) keep going after a failed check so one broken scenario
// doesn't hide failures later in the same file.

const PORT = 5199;

export function assert(condition, message) {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

export async function startDevServer() {
  // Spawns vite directly rather than "npm run dev -- ..." — killing the npm
  // wrapper process doesn't reliably kill vite itself (an extra process
  // layer, not always in the same process group), which left an orphaned
  // dev server holding the port across runs during development of this file.
  const proc = spawn("node_modules/.bin/vite", ["--port", String(PORT), "--strictPort"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });

  const baseUrl = `http://localhost:${PORT}`;

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Dev server did not start within 20s")), 20000);
    let output = "";
    proc.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.includes("ready in")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    proc.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code !== null && code !== 0) reject(new Error(`Dev server exited early (${code}):\n${output}`));
    });
  });

  return {
    baseUrl,
    async stop() {
      // Wait for the process to actually exit (and release the port)
      // before resolving — otherwise a script that runs test:e2e twice in
      // quick succession can hit "port already in use" on the second run.
      const exited = new Promise((resolve) => proc.once("exit", resolve));
      proc.kill();
      await exited;
    },
  };
}

// Runs one named check; returns true/false rather than throwing, so a
// spec's run() can keep executing later checks after an earlier failure.
export async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok - ${name}`);
    return true;
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

// A fresh, isolated browser context (its own IndexedDB/localStorage) per
// scenario — same isolation drive*.mjs got from launching a whole new
// browser each time, without paying to relaunch Chromium for every check.
// every test in this suite except the welcome modal's own is
// about something else entirely — pre-dismiss it via an init script (runs
// before the app's own JS, so getStoredWelcomeDismissed() already sees it
// set on first render) rather than editing every one of this suite's test
// files to click it away as their first action. skipWelcomeDismiss opts a
// test out, for the one file that actually needs to see real first-load
// behavior.
export async function withFreshPage(browser, fn, { skipWelcomeDismiss = false } = {}) {
  const context = await browser.newContext();
  if (!skipWelcomeDismiss) {
    await context.addInitScript(() => {
      localStorage.setItem("context-sheets:welcome-dismissed", "true");
    });
  }
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("dialog", (dialog) => dialog.accept());
  try {
    await fn(page);
    assert(pageErrors.length === 0, `Unexpected page errors: ${JSON.stringify(pageErrors)}`);
  } finally {
    await context.close();
  }
}

// Settings is a native <dialog> (useDialog.ts) — its close() dispatches
// the real 'close' event (and the React unmount that follows) a tick after
// the click that triggered it, not synchronously within it, unlike the
// plain div/keydown-listener version this replaced. Every setter below
// closes Settings as its last step and callers immediately check DOM state
// that depends on the close having actually finished, so this centralizes
// the wait once instead of in every setter.
async function closeSettings(page) {
  await page.click('button[aria-label="Close settings"]');
  await page.waitForTimeout(150);
}

// The API key lives behind the Settings modal (gear icon), not inline in
// the header — opens it, fills the key, and closes it again. Goes through
// openHeaderMenuItem (defined below, hoisted) since Settings sits behind
// the hamburger at narrow widths — most specs run at this suite's desktop
// default and never hit that branch, but mobileLayout.e2e.mjs deliberately
// narrows the viewport before some of its own setup needs the API key.
export async function setApiKey(page, key) {
  await openHeaderMenuItem(page, 'button[aria-label="Settings"]');
  await page.fill('input[aria-label="Anthropic API key"]', key);
  await closeSettings(page);
}

// This Chat's turn/summary collapse-by-default toggle, off by
// default — same only-click-if-needed shape as setCollapseHistoryByDefault below.
export async function setCollapseTurnsByDefault(page, enabled) {
  await openHeaderMenuItem(page, 'button[aria-label="Settings"]');
  const checkbox = page.locator('input[aria-label="Collapse conversation turns and summaries by default"]');
  if ((await checkbox.isChecked()) !== enabled) await checkbox.click();
  await closeSettings(page);
}

// History's per-version diff-list collapse-by-default toggle.
export async function setCollapseHistoryByDefault(page, enabled) {
  await openHeaderMenuItem(page, 'button[aria-label="Settings"]');
  const checkbox = page.locator('input[aria-label="Collapse History entries by default"]');
  if ((await checkbox.isChecked()) !== enabled) await checkbox.click();
  await closeSettings(page);
}

// Context/History/Library/Settings collapse into a single ☰ dropdown below
// App.css's 1024px breakpoint — visible directly in the header at desktop
// widths (this suite's default), but hidden behind the hamburger at
// narrower ones. Checked live via .header-menu-trigger's own visibility
// rather than a hardcoded width comparison, so the same helper works
// whichever viewport a given spec happens to be running at.
async function openHeaderMenuItem(page, selector) {
  const hamburger = page.locator(".header-menu-trigger");
  if (await hamburger.isVisible()) {
    await hamburger.click();
  }
  await page.click(selector);
}

// Context is a header button/overlay now (previously an always-visible
// sidebar) — opens it if it isn't already, so call sites don't need to
// track whether some earlier step already opened it.
export async function openContext(page) {
  if ((await page.locator(".context-overlay").count()) === 0) {
    await openHeaderMenuItem(page, ".context-trigger");
    await page.waitForSelector(".context-overlay");
  }
}

// Context is a full-viewport overlay within .app-body at every width now
// (App.css's .context-overlay: position: absolute; inset: 0), not a
// sidebar the chat pane stays interactive alongside — so any test that
// edits something in Context and then needs to send a chat message or use
// the chats sidebar again must close it first, or those elements sit
// underneath an overlay intercepting their clicks.
export async function closeContext(page) {
  if ((await page.locator(".context-overlay").count()) === 0) return;
  await openHeaderMenuItem(page, ".context-trigger");
  await page.waitForSelector(".context-overlay", { state: "detached" });
}

export async function openHistory(page) {
  await openHeaderMenuItem(page, 'button[aria-label="History"]');
  await page.waitForSelector(".modal--history");
  // The modal shell mounts synchronously, but VersionHistory's own lineage
  // fetch (useActiveLineage) is async and starts empty — waiting only for
  // the shell leaves a real race where .version-row doesn't exist yet.
  // There's always at least the skeleton version, so this reliably settles.
  await page.waitForSelector(".version-row");
}

// Manage with AI's trigger lives inside the Context overlay's own header
// (ContextOverlay.tsx) — opens Context first if needed. Clicking the
// trigger closes Context as a side effect (App.tsx's
// openManageWithAIFromContext), which is real app behavior, not a bug.
export async function openManageWithAI(page) {
  await openContext(page);
  await page.click(".manage-ai-trigger");
  await page.waitForSelector(".manage-ai-panel");
}

// SheetPanel's This-Chat/Memories tab content stays mounted (CSS-hidden)
// even when inactive, so reads (.textContent()/.inputValue()) work
// regardless of which tab is showing — but fill()/click() require
// actionability (visibility), so any test that fills or clicks inside a
// tab's content must switch to it first. SheetPanel itself only mounts
// inside the Context overlay, so this opens Context first if needed.
export async function showSheetPanelTab(page, tab) {
  await openContext(page);
  const label = tab === "memories" ? "Memories" : "This Chat";
  await page.click(`.sheet-panel-tab:has-text("${label}")`);
}

// "Add memory" is collapsed to a trigger button until clicked, which then
// reveals a form styled like an existing memory's own editing state (same
// .memory-row--editing class) — this drives that full sequence. .last() on
// the editing row specifically because an existing memory could also be
// mid-edit (its own .memory-row--editing <li>, inside .memory-list) at the
// same time; the new-memory form's row always renders after it in the DOM.
export async function addMemory(memSection, label, body) {
  await memSection.locator(".new-memory-form button").click();
  const editingRow = memSection.locator(".memory-row--editing").last();
  await editingRow.locator("input[type=text]").fill(label);
  await editingRow.locator("textarea").fill(body);
  await editingRow.locator(".memory-row-actions button", { hasText: "Save" }).click();
}

// "+ New chat" no longer takes a name up front — it creates a chat named
// "New chat" and switches to it, which auto-focuses the chat header's own
// rename field (ChatHeaderTitle) with the default name pre-selected. This
// drives the full create-then-rename sequence; fill()'s built-in
// actionability wait covers the brief async gap between the click
// resolving and the header's rename form actually appearing.
export async function createChat(page, name) {
  await page.click(".sheet-switcher-new");
  await page.fill(".chat-header-title-form input", name);
  await page.keyboard.press("Enter");
}

// The responder normally just returns reply text (a string), but may
// return { text } instead when a spec wants to inspect the request body
// (responder receives it) while still just producing plain text back.
export async function mockApi(page, responder) {
  await page.route("https://api.anthropic.com/v1/messages", async (route) => {
    const body = JSON.parse(route.request().postData());
    const result = await responder(body, route.request());
    const text = typeof result === "string" ? result : result.text;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ content: [{ type: "text", text }] }),
    });
  });
}
