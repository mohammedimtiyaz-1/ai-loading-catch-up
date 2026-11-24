import { test, expect, chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const extensionPath = join(here, "..", "..", "extension");
let context;
let extensionId;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
});

test.afterAll(async () => context?.close());

test("uses inline explanations without rendering a separate panel", async () => {
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4311/");
  const host = page.locator("#ai-loading-catch-up-root");
  await expect(host).toBeAttached();
  await expect(host.locator(".term-tooltip")).toHaveCount(1);
  await expect(host.locator(".panel, .chip, .wrap")).toHaveCount(0);
  await page.locator("#question").fill("How does RAG reduce hallucinations?");
  await page.waitForTimeout(250);
  await expect(page.locator('[data-ai-loading-catch-up-term="true"]')).toHaveCount(0);
  await expect(page.locator("#ai-loading-catch-up-textarea-overlay .ai-keyword-draft-mark")).toHaveCount(2, { timeout: 1500 });
  await expect(page.locator("#question")).toHaveValue("How does RAG reduce hallucinations?");
  await page.close();
});

test("highlights technical terms in a ChatGPT draft after a short quiet period", async () => {
  await context.route("https://chatgpt.com/**", (route) => route.fulfill({
    contentType: "text/html",
    body: '<!doctype html><div data-type="unified-composer"><div id="mobile-composer-prompt" role="textbox" contenteditable="true"><p><br></p></div></div>'
  }));
  const page = await context.newPage();
  await page.goto("https://chatgpt.com/draft-highlight");
  const composer = page.locator("#mobile-composer-prompt");
  await composer.fill("Explain RAG tokens and semantic tuning.");
  await expect(page.locator("#ai-loading-catch-up-draft-overlay > span")).toHaveCount(3, { timeout: 1500 });
  await expect(composer).toHaveText("Explain RAG tokens and semantic tuning.");
  await expect(composer.locator('[data-ai-loading-catch-up-term="true"]')).toHaveCount(0);
  await page.close();
  await context.unroute("https://chatgpt.com/**");
});

test("matches the live ChatGPT textarea geometry and shows its tooltip", async () => {
  await context.route("https://chatgpt.com/**", (route) => route.fulfill({
    contentType: "text/html",
    body: '<!doctype html><style>body{margin:0;font-family:Arial,sans-serif}.shell{position:fixed;left:64.53125px;top:420px;width:540px;padding:36px 18px 18px;border-radius:28px;background:#f4f4f4}.shell textarea{display:block;transform:translateY(-.5px);z-index:1;width:501.588562px;height:24.001738px;padding:0;border:0;background:transparent;font:16px/24px Arial,sans-serif;resize:none}</style><div class="shell" data-type="unified-composer"><textarea id="mobile-composer-prompt" aria-label="Chat with ChatGPT"></textarea></div>'
  }));
  const page = await context.newPage();
  await page.goto("https://chatgpt.com/live-textarea-fixture");
  const composer = page.locator("#mobile-composer-prompt");
  await composer.fill("Explain RAG tokens and semantic tuning");
  const marks = page.locator("#ai-loading-catch-up-textarea-overlay .ai-keyword-draft-mark");
  await expect(marks).toHaveCount(3, { timeout: 1500 });
  await expect(page.locator("#ai-loading-catch-up-root")).toHaveAttribute("data-extension-version", "0.5.4");
  await expect(page.locator("#ai-loading-catch-up-root")).toHaveAttribute("data-integration-mode", "textarea-overlay");
  await expect(page.locator("#ai-loading-catch-up-root")).toHaveAttribute("data-highlight-count", "3");
  const geometry = await page.evaluate(() => {
    const composerRect = document.querySelector("#mobile-composer-prompt").getBoundingClientRect();
    const overlayRect = document.querySelector("#ai-loading-catch-up-textarea-overlay").getBoundingClientRect();
    return { composer: composerRect.toJSON(), overlay: overlayRect.toJSON() };
  });
  expect(Math.abs(geometry.composer.x - geometry.overlay.x)).toBeLessThan(1);
  expect(Math.abs(geometry.composer.y - geometry.overlay.y)).toBeLessThan(1);
  expect(Math.abs(geometry.composer.width - geometry.overlay.width)).toBeLessThan(1);
  expect(Math.abs(geometry.composer.height - geometry.overlay.height)).toBeLessThan(1);
  const ragBox = await marks.filter({ hasText: "RAG" }).boundingBox();
  await page.mouse.move(ragBox.x + ragBox.width / 2, ragBox.y + ragBox.height / 2);
  await expect(page.locator("#ai-loading-catch-up-root").locator(".term-tooltip")).toBeVisible();
  await page.close();
  await context.unroute("https://chatgpt.com/**");
});

test("underlines submitted question terms and shows a compact tooltip", async () => {
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4311/");
  await page.locator("#question").fill("How does RAG reduce hallucinations?");
  await page.locator("#send").click();
  const question = page.locator('[data-role="user-message"]');
  const marks = question.locator('[data-ai-loading-catch-up-term="true"]');
  await expect(marks).toHaveCount(2, { timeout: 2500 });
  await expect(marks.first()).toHaveCSS("background-color", "rgba(124, 92, 255, 0.24)");
  await marks.first().hover();
  const tooltip = page.locator("#ai-loading-catch-up-root").locator(".term-tooltip");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).not.toBeEmpty();
  const box = await tooltip.boundingBox();
  expect(box.width).toBeLessThanOrEqual(270);
  await marks.first().focus();
  await page.keyboard.press("Escape");
  await expect(tooltip).toBeHidden();
  await page.close();
});

test("underlines a built-in lower-complexity technical phrase", async () => {
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4311/");
  await page.locator("#question").fill("Explain semantic tuning.");
  await page.locator("#send").click();
  const mark = page.locator('[data-role="user-message"] [data-ai-loading-catch-up-term="true"]');
  await expect(mark).toHaveText("semantic tuning", { timeout: 2500 });
  await mark.hover();
  await expect(page.locator("#ai-loading-catch-up-root").locator(".term-tooltip")).toContainText("meaning-based relevance");
  await page.close();
});

test("waits for a streamed answer to stabilize before underlining it", async () => {
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4311/");
  await page.locator("#send").click();
  const answer = page.locator('[data-role="assistant-message"]');
  await page.waitForTimeout(700);
  await expect(answer.locator('[data-ai-loading-catch-up-term="true"]')).toHaveCount(0);
  await expect(page.locator("#regenerate")).toBeEnabled({ timeout: 6000 });
  await expect(answer.locator('[data-ai-loading-catch-up-term="true"]')).toHaveCount(7, { timeout: 2500 });
  await page.close();
});

test("keeps question and answer annotations independent across regeneration", async () => {
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4311/");
  await page.locator("#send").click();
  const question = page.locator('[data-role="user-message"]');
  await expect(question.locator('[data-ai-loading-catch-up-term="true"]')).toHaveCount(2, { timeout: 2500 });
  await expect(page.locator("#regenerate")).toBeEnabled({ timeout: 6000 });
  await page.locator("#regenerate").click();
  await expect(question.locator('[data-ai-loading-catch-up-term="true"]')).toHaveCount(2);
  const answer = page.locator('[data-role="assistant-message"]');
  await expect(page.locator("#regenerate")).toBeEnabled({ timeout: 6000 });
  await expect(answer.locator('[data-ai-loading-catch-up-term="true"]')).toHaveCount(4, { timeout: 2500 });
  await page.close();
});

test("ordinary conversational text receives no annotations", async () => {
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4311/");
  await page.locator("#question").fill("Please write a warm thank-you message.");
  await page.locator("#send").click();
  await page.waitForTimeout(1200);
  await expect(page.locator('[data-role="user-message"] [data-ai-loading-catch-up-term="true"]')).toHaveCount(0);
  await page.close();
});

test("route changes clear annotations and keep only the tooltip host", async () => {
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4311/");
  await page.locator("#send").click();
  await expect(page.locator('[data-role="user-message"] [data-ai-loading-catch-up-term="true"]')).toHaveCount(2, { timeout: 2500 });
  await page.locator("#newConversation").click();
  await expect(page.locator('[data-ai-loading-catch-up-term="true"]')).toHaveCount(0);
  await expect(page.locator("#ai-loading-catch-up-root")).toHaveCount(1);
  await expect(page.locator("#ai-loading-catch-up-root").locator(".panel")).toHaveCount(0);
  await page.close();
});

test("settings disable and re-enable inline behavior without duplicate hosts", async () => {
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4311/");
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  extensionId = new URL(worker.url()).host;
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${extensionId}/settings.html`);
  await settings.locator("#enabled").uncheck();
  await settings.locator("#save").click();
  await expect(page.locator("#ai-loading-catch-up-root")).toHaveCount(0);
  await settings.locator("#enabled").check();
  await settings.locator("#save").click();
  await expect(page.locator("#ai-loading-catch-up-root")).toHaveCount(1);
  await settings.close();
  await page.close();
});
