import { chromium } from "playwright";
import { run as runAutoApplyToggle } from "./autoApplyToggle.e2e.mjs";
import { run as runCollapseContent } from "./collapseContent.e2e.mjs";
import { run as runCollapseSuggestions } from "./collapseSuggestions.e2e.mjs";
import { run as runCompressionRecommender } from "./compressionRecommender.e2e.mjs";
import { run as runExportImport } from "./exportImport.e2e.mjs";
import { run as runGlobalMemories } from "./globalMemories.e2e.mjs";
import { run as runManageWithAI } from "./manageWithAI.e2e.mjs";
import { run as runMobileLayout } from "./mobileLayout.e2e.mjs";
import { run as runModelSelector } from "./modelSelector.e2e.mjs";
import { run as runMultiSheet } from "./multiSheet.e2e.mjs";
import { run as runSettingsModalScroll } from "./settingsModalScroll.e2e.mjs";
import { run as runSheetDeletion } from "./sheetDeletion.e2e.mjs";
import { run as runWelcomeModal } from "./welcomeModal.e2e.mjs";
import { run as runWordWrap } from "./wordWrap.e2e.mjs";
import { startDevServer } from "./support.mjs";

const specs = [
  ["multiSheet.e2e.mjs", runMultiSheet],
  ["sheetDeletion.e2e.mjs", runSheetDeletion],
  ["globalMemories.e2e.mjs", runGlobalMemories],
  ["exportImport.e2e.mjs", runExportImport],
  ["manageWithAI.e2e.mjs", runManageWithAI],
  ["autoApplyToggle.e2e.mjs", runAutoApplyToggle],
  ["collapseSuggestions.e2e.mjs", runCollapseSuggestions],
  ["wordWrap.e2e.mjs", runWordWrap],
  ["compressionRecommender.e2e.mjs", runCompressionRecommender],
  ["collapseContent.e2e.mjs", runCollapseContent],
  ["settingsModalScroll.e2e.mjs", runSettingsModalScroll],
  ["welcomeModal.e2e.mjs", runWelcomeModal],
  ["modelSelector.e2e.mjs", runModelSelector],
  ["mobileLayout.e2e.mjs", runMobileLayout],
];

const server = await startDevServer();
const browser = await chromium.launch();

// Setup code inside a spec's withFreshPage callback that runs outside any
// test() block (e.g. shared fixture setup before the first named check)
// isn't caught by test()'s try/catch — a Playwright timeout there throws
// past every spec and crashes this script before the cleanup below ever
// runs, orphaning the dev server on its port for the next invocation (hit
// this for real during development). try/finally guarantees the browser
// and server always get torn down, crash or not.
let allOk = true;
try {
  for (const [name, run] of specs) {
    console.log(name);
    const ok = await run(browser, server.baseUrl);
    allOk = ok && allOk;
  }
} finally {
  await browser.close();
  await server.stop();
}

console.log(allOk ? "\nAll e2e checks passed." : "\nSome e2e checks FAILED.");
process.exit(allOk ? 0 : 1);
