import assert from "node:assert/strict";
import test from "node:test";
import { DefinitionCache } from "../backend/cache.js";
import { definitionFromProvider } from "../backend/provider.js";
import { resolveRequest, validateRequest } from "../backend/resolve.js";

const candidate = { term: "semantic cache", domain: "ai", senseHint: "reuse model results" };

test("request validation rejects unbounded or incomplete payloads", () => {
  assert.equal(validateRequest({ terms: [] }), false);
  assert.equal(validateRequest({ terms: [candidate] }), true);
  assert.equal(validateRequest({ terms: Array(4).fill(candidate) }), false);
  assert.equal(validateRequest({ terms: [{ ...candidate, term: "x".repeat(121) }] }), false);
});

test("provider output requires short complete answer and valid source", () => {
  assert.equal(definitionFromProvider(candidate, { answer: "A reusable result.", results: [] }).status, "missing");
  const result = definitionFromProvider(candidate, { answer: "A stored result reused for similar requests.", results: [{ title: "Semantic cache source", url: "https://example.com/cache", content: "A semantic cache stores reusable AI results." }] });
  assert.equal(result.status, "resolved");
  assert.equal(result.definition.sources[0].url, "https://example.com/cache");
});

test("provider uses the first short sourced sentence from a basic Tavily answer", () => {
  const result = definitionFromProvider(candidate, {
    answer: "A semantic cache stores reusable results for similar requests. Additional detail can follow without entering the one-line interface.",
    results: [{ title: "Semantic caching guide", url: "https://example.com/semantic-cache", content: "Semantic cache reuse for AI requests." }]
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.definition.oneLiner, "A semantic cache stores reusable results for similar requests.");
});

test("missing provider key is explicit and costs no budget", async () => {
  const cache = new DefinitionCache();
  const result = await resolveRequest({ requestId: "1", terms: [candidate] }, { cache, apiKey: "" });
  assert.equal(result.results[0].status, "unconfigured");
  assert.equal(cache.attempts(), 0);
  cache.close();
});

test("resolved provider result is cached and repeated without another call", async () => {
  const cache = new DefinitionCache();
  let calls = 0;
  const provider = async () => {
    calls += 1;
    const now = new Date();
    return { status: "resolved", definition: { canonicalTermId: "semantic-cache", displayTerm: "semantic cache", aliases: ["semantic cache"], domain: "ai", senseId: "reuse-results", language: "en", explanationVersion: 1, oneLiner: "A stored result reused for requests with similar meaning.", sources: [{ title: "Source", url: "https://example.com/cache" }], origin: "generated-from-sources", verifiedAt: now.toISOString(), refreshAfter: new Date(now.getTime() + 86400000).toISOString() } };
  };
  const options = { cache, apiKey: "test", provider, monthlyLimit: 2 };
  const first = await resolveRequest({ terms: [candidate] }, options);
  const second = await resolveRequest({ terms: [candidate] }, options);
  assert.equal(first.results[0].status, "resolved");
  assert.equal(second.results[0].cache, "backend");
  assert.equal(calls, 1);
  assert.equal(cache.attempts(), 1);
  cache.close();
});

test("monthly budget stops provider attempts", async () => {
  const cache = new DefinitionCache();
  const provider = async () => ({ status: "missing" });
  const one = await resolveRequest({ terms: [candidate] }, { cache, apiKey: "test", provider, monthlyLimit: 1 });
  const two = await resolveRequest({ terms: [{ ...candidate, term: "different cache" }] }, { cache, apiKey: "test", provider, monthlyLimit: 1 });
  assert.equal(one.results[0].status, "missing");
  assert.equal(two.results[0].status, "budget_exhausted");
  cache.close();
});

test("simultaneous misses share one provider operation", async () => {
  const cache = new DefinitionCache();
  let calls = 0;
  const provider = async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 20)); return { status: "missing" }; };
  await Promise.all([
    resolveRequest({ terms: [candidate] }, { cache, apiKey: "test", provider }),
    resolveRequest({ terms: [candidate] }, { cache, apiKey: "test", provider })
  ]);
  assert.equal(calls, 1);
  assert.equal(cache.attempts(), 1);
  cache.close();
});

test("missing results use the five-minute negative cache", async () => {
  const cache = new DefinitionCache();
  let calls = 0;
  const provider = async () => { calls += 1; return { status: "missing" }; };
  const options = { cache, apiKey: "test", provider };
  await resolveRequest({ terms: [candidate] }, options);
  const repeated = await resolveRequest({ terms: [candidate] }, options);
  assert.equal(repeated.results[0].status, "missing");
  assert.equal(repeated.results[0].cache, "backend");
  assert.equal(calls, 1);
  cache.close();
});
