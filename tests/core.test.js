import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadCore() {
  const context = vm.createContext({ globalThis: {} });
  context.globalThis = context;
  for (const file of ["extension/shared/glossary.js", "extension/shared/core.js"]) {
    vm.runInContext(await readFile(new URL(`../${file}`, import.meta.url), "utf8"), context, { filename: file });
  }
  return { glossary: context.ThreeKeywordsGlossary, core: context.ThreeKeywordsCore };
}

test("glossary includes at least 50 sourced concepts", async () => {
  const { glossary } = await loadCore();
  assert.ok(glossary.length >= 50);
  for (const entry of glossary) {
    assert.ok(entry.sources[0]?.url.startsWith("http"), entry.canonicalTermId);
    assert.ok(entry.oneLiner.split(/\s+/).length <= 40, entry.canonicalTermId);
  }
});

test("question selection chooses RAG and hallucination", async () => {
  const { glossary, core } = await loadCore();
  const terms = core.selectTerms("How does RAG reduce hallucinations?", 2, [], glossary);
  assert.deepEqual(Array.from(terms, (item) => item.canonicalTermId).sort(), ["hallucination", "rag"]);
});

test("token sense follows context", async () => {
  const { glossary, core } = await loadCore();
  const ai = core.selectTerms("How many tokens fit in an LLM context window?", 3, [], glossary).map((item) => item.canonicalTermId);
  const security = core.selectTerms("How should a bearer token authenticate an OAuth API?", 3, [], glossary).map((item) => item.canonicalTermId);
  assert.ok(ai.includes("llm-token"));
  assert.ok(!ai.includes("auth-token"));
  assert.ok(security.includes("auth-token"));
  assert.ok(!security.includes("llm-token"));
});

test("ordinary prompt produces no glossary filler", async () => {
  const { glossary, core } = await loadCore();
  assert.equal(core.selectTerms("Please write a warm thank-you message.", 3, [], glossary).length, 0);
});

test("answer fills only remaining slots without replacing question slots", async () => {
  const { glossary, core } = await loadCore();
  const slots = core.createSlots("How does RAG reduce hallucinations?", glossary);
  const filled = core.fillAnswerSlots(slots, "It stores embeddings in a vector database.", glossary);
  assert.equal(filled.length, 3);
  assert.deepEqual(Array.from(filled.slice(0, 2), (slot) => slot.definition.canonicalTermId).sort(), ["hallucination", "rag"]);
  assert.equal(filled[2].definition.canonicalTermId, "vector-database");
});
