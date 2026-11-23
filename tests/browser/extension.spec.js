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
  await page.waitForTimeout(1000);
  await expect(page.locator('[data-ai-loading-catch-up-term="true"]')).toHaveCount(0);
  await expect(page.locator("#question")).toHaveValue("How does RAG reduce hallucinations?");
  await page.close();
});

test("underlines submitted question terms and shows a compact tooltip", async () => {
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4311/");
  await page.locator("#question").fill("How does RAG reduce hallucinations?");
  await page.locator("#send").click();
  const question = page.locator('[data-role="user-message"]');
  const marks = question.locator('[data-ai-loading-catch-up-term="true"]');
  await expect(marks).toHaveCount(2, { timeout: 3000 });
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

test("underlines a cached lower-complexity technical phrase", async () => {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const cacheKey = "v1:en:general:semantic-tuning:meaning-of-semantic-tuning-in-this-subject";
  const storageKey = `definition:${cacheKey}`;
  await worker.evaluate(async ({ storageKey, cacheKey }) => {
    await chrome.storage.local.set({
      onlineLookup: true,
      backendUrl: "http://127.0.0.1:9",
      learnedDefinitionKeys: [cacheKey],
      [storageKey]: {
        canonicalTermId: "semantic-tuning",
        displayTerm: "Semantic tuning",
        aliases: ["semantic tuning"],
        domain: "general",
        senseId: "meaning-in-subject",
        language: "en",
        explanationVersion: 1,
        oneLiner: "Semantic tuning adjusts a system so meaning-based matches better fit its intended use.",
        sources: [{ title: "Test source", url: "https://example.com/semantic-tuning" }],
        refreshAfter: new Date(Date.now() + 86400000).toISOString()
      }
    });
  }, { storageKey, cacheKey });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4311/");
  await page.locator("#question").fill("Explain semantic tuning.");
  await page.locator("#send").click();
  const mark = page.locator('[data-role="user-message"] [data-ai-loading-catch-up-term="true"]');
  await expect(mark).toHaveText("semantic tuning", { timeout: 3000 });
  await mark.hover();
  await expect(page.locator("#ai-loading-catch-up-root").locator(".term-tooltip")).toContainText("meaning-based matches");
  await page.close();
  await worker.evaluate(async ({ storageKey }) => {
    await chrome.storage.local.remove(storageKey);
    await chrome.storage.local.set({ onlineLookup: false, backendUrl: "http://127.0.0.1:4311", learnedDefinitionKeys: [] });
  }, { storageKey });
});

test("waits for a streamed answer to stabilize before underlining it", async () => {
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4311/");
  await page.locator("#send").click();
  const answer = page.locator('[data-role="assistant-message"]');
  await page.waitForTimeout(700);
  await expect(answer.locator('[data-ai-loading-catch-up-term="true"]')).toHaveCount(0);
  await expect(page.locator("#regenerate")).toBeEnabled({ timeout: 6000 });
  await expect(answer.locator('[data-ai-loading-catch-up-term="true"]')).toHaveCount(4, { timeout: 4000 });
  await page.close();
});

test("keeps question and answer annotations independent across regeneration", async () => {
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4311/");
  await page.locator("#send").click();
  const question = page.locator('[data-role="user-message"]');
  await expect(question.locator('[data-ai-loading-catch-up-term="true"]')).toHaveCount(2, { timeout: 3000 });
  await expect(page.locator("#regenerate")).toBeEnabled({ timeout: 6000 });
  await page.locator("#regenerate").click();
  await expect(question.locator('[data-ai-loading-catch-up-term="true"]')).toHaveCount(2);
  const answer = page.locator('[data-role="assistant-message"]');
  await expect(page.locator("#regenerate")).toBeEnabled({ timeout: 6000 });
  await expect(answer.locator('[data-ai-loading-catch-up-term="true"]')).toHaveCount(2, { timeout: 4000 });
  await page.close();
});

test("ordinary conversational text receives no annotations", async () => {
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4311/");
  await page.locator("#question").fill("Please write a warm thank-you message.");
  await page.locator("#send").click();
  await page.waitForTimeout(1800);
  await expect(page.locator('[data-role="user-message"] [data-ai-loading-catch-up-term="true"]')).toHaveCount(0);
  await page.close();
});

test("route changes clear annotations and keep only the tooltip host", async () => {
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4311/");
  await page.locator("#send").click();
  await expect(page.locator('[data-role="user-message"] [data-ai-loading-catch-up-term="true"]')).toHaveCount(2, { timeout: 3000 });
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
