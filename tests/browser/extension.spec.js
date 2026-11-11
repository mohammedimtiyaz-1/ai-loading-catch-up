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

test("question terms and streaming answer appear in the installed extension", async () => {
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4311/");
  const startedAt = Date.now();
  await page.locator("#send").click();
  const host = page.locator("#ai-loading-catch-up-root");
  await expect(host).toBeAttached();
  const chip = host.locator(".chip");
  await expect(chip).toHaveText("2 terms");
  const cachedLatencyMs = Date.now() - startedAt;
  console.log(`cached question explanation latency: ${cachedLatencyMs} ms`);
  expect(cachedLatencyMs).toBeLessThan(300);
  await expect(host.locator(".panel")).toBeVisible();
  await expect(host.locator("h3").filter({ hasText: "RAG" })).toHaveCount(1);
  await expect(host.locator("h3").filter({ hasText: "Hallucination" })).toHaveCount(1);
  await expect(chip).toHaveText("3 terms", { timeout: 5000 });
  await expect(host.locator("h3").filter({ hasText: "Vector database" })).toHaveCount(1);
  await page.close();
});

test("draft terms appear before the question is submitted", async () => {
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4311/");
  await page.locator("#question").fill("How does RAG reduce hallucinations?");
  const host = page.locator("#ai-loading-catch-up-root");
  await expect(host.locator(".chip")).toHaveText("2 terms", { timeout: 2000 });
  await expect(host.locator(".panel")).toBeVisible();
  await expect(page.locator('[data-role="user-message"]')).toHaveCount(0);
  const positions = await page.evaluate(() => {
    const content = document.querySelector("#question").getBoundingClientRect();
    const wrap = document.querySelector("#ai-loading-catch-up-root").shadowRoot.querySelector(".wrap").getBoundingClientRect();
    return { contentRight: content.right, panelLeft: wrap.left };
  });
  expect(positions.panelLeft).toBeGreaterThanOrEqual(positions.contentRight);
  await page.close();
});

test("ordinary question does not manufacture terms", async () => {
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4311/");
  await page.locator("#question").fill("Please write a warm thank-you message.");
  await page.locator("#send").click();
  const host = page.locator("#ai-loading-catch-up-root");
  await page.waitForTimeout(1200);
  await expect(host.locator(".chip")).not.toHaveClass(/show/);
  await page.close();
});

test("completed answers underline five Tavily-backed terms with hover explanations", async () => {
  await context.route("http://127.0.0.1:4311/v1/definitions/resolve", async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        requestId: body.requestId,
        results: body.terms.map((candidate) => ({
          status: "resolved",
          definition: {
            canonicalTermId: candidate.term.toLowerCase().replace(/\W+/g, "-"),
            displayTerm: candidate.term,
            aliases: [candidate.term],
            domain: candidate.domain,
            senseId: "test",
            language: "en",
            explanationVersion: 1,
            oneLiner: `${candidate.term} has a short sourced explanation from Tavily.`,
            sources: [{ title: "Tavily test source", url: "https://example.com/source" }],
            refreshAfter: new Date(Date.now() + 86400000).toISOString()
          }
        }))
      })
    });
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.local.set({ onlineLookup: true }));
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4311/");
  await page.locator("#question").fill("How does RAG reduce hallucinations?");
  await page.locator("#send").click();
  const marks = page.locator('[data-ai-loading-catch-up-term="true"]');
  await expect(marks).toHaveCount(5, { timeout: 10000 });
  await marks.first().hover();
  const host = page.locator("#ai-loading-catch-up-root");
  await expect(host.locator(".term-tooltip")).toBeVisible();
  await expect(host.locator(".term-tooltip")).not.toBeEmpty();
  await page.close();
  await worker.evaluate(() => chrome.storage.local.set({ onlineLookup: false }));
  await context.unroute("http://127.0.0.1:4311/v1/definitions/resolve");
});

test("popover supports Escape, focus restoration, regeneration, navigation and zoom", async () => {
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4311/");
  await page.locator("#send").click();
  const host = page.locator("#ai-loading-catch-up-root");
  const chip = host.locator(".chip");
  await expect(chip).toHaveText("2 terms");
  await expect(host.locator(".panel")).toBeVisible();
  const conversationBox = await page.locator("#conversation").boundingBox();
  const panelBox = await host.locator(".panel").boundingBox();
  expect(panelBox.x).toBeGreaterThanOrEqual(conversationBox.x + conversationBox.width);
  await host.locator(".close").click();
  await expect(chip).toBeFocused();
  await chip.click();
  await expect(host.locator(".close")).toBeFocused();
  await host.locator(".close").press("Escape");
  await expect(chip).toBeFocused();
  await page.evaluate(() => { document.documentElement.style.zoom = "200%"; });
  await chip.click();
  await expect(host.locator(".panel")).toBeVisible();
  await expect(page.locator("#regenerate")).toBeEnabled({ timeout: 6000 });
  await page.locator("#regenerate").click();
  await expect(chip).toHaveText("3 terms", { timeout: 5000 });
  await page.evaluate(() => { document.documentElement.style.zoom = "100%"; });
  await host.locator(".close").click();
  await page.locator("#newConversation").click();
  await expect(chip).not.toHaveClass(/show/, { timeout: 2000 });
  await page.close();
});

test("settings disable and re-enable the in-page UI without duplicates", async () => {
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
