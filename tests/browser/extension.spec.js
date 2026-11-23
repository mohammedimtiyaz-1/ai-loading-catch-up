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

test("panel waits for a delayed ChatGPT composer and then shows only its title", async () => {
  await context.route("https://chatgpt.com/**", (route) => route.fulfill({
    contentType: "text/html",
    body: '<!doctype html><style>.shell{position:fixed;left:220px;top:500px;width:620px;padding:16px;border:1px solid #aaa;border-radius:24px;box-sizing:border-box}</style><main></main>'
  }));
  const page = await context.newPage();
  await page.goto("https://chatgpt.com/delayed-composer");
  const host = page.locator("#ai-loading-catch-up-root");
  await expect(host).toBeAttached();
  await expect(host).toHaveAttribute("data-placement", "waiting-for-composer");
  await page.evaluate(() => {
    document.querySelector("main").innerHTML = '<div class="shell" data-type="unified-composer"><div id="prompt-textarea" role="textbox" contenteditable="true"></div></div>';
  });
  await expect(host.locator(".panel")).toBeVisible();
  await expect(host.locator("h2")).toHaveText("AI Chat Keyword Explainer");
  await expect(host.locator(".cards article")).toHaveCount(0);
  await expect(host).toHaveAttribute("data-placement", "composer-right");
  await page.close();
  await context.unroute("https://chatgpt.com/**");
});

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
  await expect(host.locator(".panel")).toBeVisible();
  await expect(host.locator("h2")).toHaveText("AI Chat Keyword Explainer");
  await expect(host.locator(".chip")).toHaveText("2 terms", { timeout: 2000 });
  await expect(host.locator(".panel")).toBeVisible();
  await expect(page.locator('[data-role="user-message"]')).toHaveCount(0);
  const positions = await page.evaluate(() => {
    const content = document.querySelector("#question").getBoundingClientRect();
    const wrap = document.querySelector("#ai-loading-catch-up-root").shadowRoot.querySelector(".wrap").getBoundingClientRect();
    const host = document.querySelector("#ai-loading-catch-up-root");
    return { contentRight: content.right, contentTop: content.top, panelRight: wrap.right, panelBottom: wrap.bottom, placement: host.dataset.placement };
  });
  expect(positions.placement).toBe("composer-above");
  expect(Math.abs(positions.panelRight - positions.contentRight)).toBeLessThan(1);
  expect(positions.panelBottom).toBeLessThanOrEqual(positions.contentTop - 11);
  await page.locator("#question").fill("");
  await page.waitForTimeout(700);
  await expect(host.locator("h3").filter({ hasText: "RAG" })).toHaveCount(1);
  await expect(host.locator("h3").filter({ hasText: "Hallucination" })).toHaveCount(1);
  await page.locator("#question").fill("What is an API?");
  await expect(host.locator("h3").filter({ hasText: "API" })).toHaveCount(1, { timeout: 2000 });
  await expect(host.locator("h3").filter({ hasText: "RAG" })).toHaveCount(0);
  await page.close();
});

test("ChatGPT DOM mutations update draft terms without a direct input event", async () => {
  await context.route("https://chatgpt.com/**", (route) => route.fulfill({
    contentType: "text/html",
    body: '<!doctype html><style>.shell{position:fixed;left:180px;top:500px;width:620px;padding:16px;border:1px solid #aaa;border-radius:24px}</style><div class="shell" data-type="unified-composer"><div class="ProseMirror" role="textbox" contenteditable="true"><p><br></p></div></div>'
  }));
  const page = await context.newPage();
  await page.goto("https://chatgpt.com/mutation-composer");
  await page.locator(".ProseMirror").evaluate((node) => { node.querySelector("p").textContent = "How does RAG reduce hallucinations?"; });
  const host = page.locator("#ai-loading-catch-up-root");
  await expect(host.locator("h3").filter({ hasText: "RAG" })).toHaveCount(1, { timeout: 2000 });
  await expect(host.locator("h3").filter({ hasText: "Hallucination" })).toHaveCount(1);
  await page.close();
  await context.unroute("https://chatgpt.com/**");
});

test("panel width adapts and narrow layouts move it above the composer", async () => {
  await context.route("https://chatgpt.com/**", (route) => route.fulfill({
    contentType: "text/html",
    body: '<!doctype html><style>body{margin:0}.shell{position:fixed;top:520px;height:100px;padding:12px;border:1px solid #aaa;border-radius:24px;box-sizing:border-box}.shell>[contenteditable]{height:60px}</style><div class="shell" data-type="unified-composer"><div id="prompt-textarea" role="textbox" contenteditable="true"></div></div>'
  }));
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("https://chatgpt.com/geometry");
  const host = page.locator("#ai-loading-catch-up-root");
  for (const expectedWidth of [240, 300, 340]) {
    const available = expectedWidth === 340 ? 400 : expectedWidth;
    await page.locator(".shell").evaluate((node, right) => {
      node.style.left = "200px";
      node.style.width = `${right - 200}px`;
    }, 1280 - 24 - available);
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    await expect.poll(() => host.locator(".wrap").evaluate((node) => Math.round(node.getBoundingClientRect().width))).toBe(expectedWidth);
  }
  await page.locator(".shell").evaluate((node) => { node.style.left = "400px"; node.style.width = "700px"; });
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await expect(host).toHaveAttribute("data-placement", "composer-above");
  const geometry = await page.evaluate(() => {
    const shell = document.querySelector(".shell").getBoundingClientRect();
    const wrap = document.querySelector("#ai-loading-catch-up-root").shadowRoot.querySelector(".wrap").getBoundingClientRect();
    return { shellTop: shell.top, shellRight: shell.right, wrapBottom: wrap.bottom, wrapRight: wrap.right };
  });
  expect(geometry.wrapBottom).toBeLessThanOrEqual(geometry.shellTop - 11);
  expect(Math.abs(geometry.wrapRight - geometry.shellRight)).toBeLessThan(1);
  await page.close();
  await context.unroute("https://chatgpt.com/**");
});

test("composer anchoring matches ChatGPT, Claude and Copilot input shells", async () => {
  const fixtures = [
    { host: "chatgpt.com", input: '<div id="mobile-composer-prompt" role="textbox" contenteditable="true"></div>', shell: 'data-type="unified-composer"', selector: "#mobile-composer-prompt" },
    { host: "claude.ai", input: '<div data-testid="chat-input" role="textbox" contenteditable="true"></div>', shell: 'data-testid="composer"', selector: '[data-testid="chat-input"]' },
    { host: "copilot.microsoft.com", input: '<textarea id="userInput"></textarea>', shell: 'data-testid="composer-shell"', selector: "#userInput" }
  ];
  for (const fixture of fixtures) {
    await context.route(`https://${fixture.host}/**`, (route) => route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><style>body{margin:0}.shell{position:fixed;left:220px;bottom:80px;width:620px;padding:16px;box-sizing:border-box;border:1px solid #aaa;border-radius:24px;background:#fff}.shell>[contenteditable],.shell>textarea{display:block;width:100%;min-height:70px;box-sizing:border-box}</style><div class="shell" ${fixture.shell}>${fixture.input}</div>`
    }));
    const page = await context.newPage();
    await page.goto(`https://${fixture.host}/fixture`);
    await page.locator(fixture.selector).fill("How does RAG reduce hallucinations?");
    const host = page.locator("#ai-loading-catch-up-root");
    await expect(host.locator(".panel")).toBeVisible({ timeout: 2500 });
    const geometry = await page.evaluate(() => {
      const shell = document.querySelector(".shell").getBoundingClientRect();
      const extensionHost = document.querySelector("#ai-loading-catch-up-root");
      const wrap = extensionHost.shadowRoot.querySelector(".wrap").getBoundingClientRect();
      return { shellRight: shell.right, shellTop: shell.top, wrapLeft: wrap.left, wrapTop: wrap.top, placement: extensionHost.dataset.placement };
    });
    expect(geometry.placement, fixture.host).toBe("composer-right");
    expect(Math.abs(geometry.wrapLeft - geometry.shellRight - 12), fixture.host).toBeLessThan(1);
    expect(Math.abs(geometry.wrapTop - geometry.shellTop), fixture.host).toBeLessThan(1);
    await page.close();
    await context.unroute(`https://${fixture.host}/**`);
  }
});

test("ordinary question does not manufacture terms", async () => {
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4311/");
  await page.locator("#question").fill("Please write a warm thank-you message.");
  await page.locator("#send").click();
  const host = page.locator("#ai-loading-catch-up-root");
  await page.waitForTimeout(1200);
  await expect(host.locator(".panel")).toBeVisible();
  await expect(host.locator(".cards article")).toHaveCount(0);
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
  const panelBox = await host.locator(".panel").boundingBox();
  const composerBox = await page.locator("#question").boundingBox();
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(composerBox.y - 11);
  await host.locator(".close").click();
  await expect(host.locator(".panel")).toBeHidden();
  await expect(chip).toBeVisible();
  await expect(chip).toBeFocused();
  await chip.click();
  await expect(host.locator(".close")).toBeFocused();
  await host.locator(".close").press("Escape");
  await expect(chip).toBeFocused();
  await page.evaluate(() => { document.documentElement.style.zoom = "200%"; });
  await chip.evaluate((button) => button.click());
  await expect(host.locator(".panel")).toBeVisible();
  await expect(page.locator("#regenerate")).toBeEnabled({ timeout: 6000 });
  await page.locator("#regenerate").click();
  await expect(chip).toHaveText("3 terms", { timeout: 5000 });
  await page.evaluate(() => { document.documentElement.style.zoom = "100%"; });
  await host.locator(".close").click();
  await page.locator("#newConversation").click();
  await expect(host.locator(".panel")).toBeVisible({ timeout: 2000 });
  await expect(host.locator("h2")).toHaveText("AI Chat Keyword Explainer");
  await expect(chip).toBeHidden();
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
