(function initCore(global) {
  const DOMAIN_CUES = {
    ai: ["ai", "model", "llm", "prompt", "generation", "embedding", "context", "rag", "learning", "training", "neural"],
    security: ["auth", "authentication", "authorization", "oauth", "login", "credential", "bearer", "security", "privacy", "private"],
    finance: ["stock", "market", "fund", "invest", "portfolio", "share"],
    science: ["research", "particle", "biology", "physics", "experiment"]
  };
  const TECHNICAL_SINGLE_WORDS = new Set([
    "authentication", "authorization", "backpropagation", "cryptography", "decryption", "encryption",
    "grounding", "inference", "latency", "middleware", "orchestration", "quantization", "retrieval",
    "serialization", "tokenization", "transformer", "virtualization"
  ]);

  function normalize(text) {
    return String(text || "").toLowerCase().replace(/[\u2010-\u2015]/g, "-").replace(/\s+/g, " ").trim();
  }

  function inferDomains(text) {
    const value = normalize(text);
    return Object.entries(DOMAIN_CUES)
      .map(([domain, cues]) => ({ domain, score: cues.reduce((n, cue) => n + (value.includes(cue) ? 1 : 0), 0) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.domain);
  }

  function hasAlias(text, alias) {
    const escaped = normalize(alias).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i").test(text);
  }

  function selectTerms(text, limit = 3, excludedIds = [], glossary = global.ThreeKeywordsGlossary || []) {
    const value = normalize(text);
    if (!value || limit <= 0) return [];
    const domains = inferDomains(value);
    const excluded = new Set(excludedIds);
    const matches = [];

    for (const entry of glossary) {
      if (excluded.has(entry.canonicalTermId)) continue;
      const aliases = [...entry.aliases].sort((a, b) => b.length - a.length);
      const alias = aliases.find((candidate) => hasAlias(value, candidate));
      if (!alias) continue;
      let score = Math.min(alias.length, 40);
      const domainIndex = domains.indexOf(entry.domain);
      if (domainIndex >= 0) score += 30 - domainIndex * 4;
      if ((entry.canonicalTermId === "llm-token" || entry.canonicalTermId === "auth-token") && !domains.includes(entry.domain)) {
        score -= 50;
      }
      matches.push({ entry, score, aliasLength: alias.length });
    }

    const selected = [];
    const seenAliases = [];
    matches.sort((a, b) => b.score - a.score || b.aliasLength - a.aliasLength || a.entry.canonicalTermId.localeCompare(b.entry.canonicalTermId));
    for (const match of matches) {
      if (match.score < 0) continue;
      if (seenAliases.some((alias) => match.entry.aliases.some((a) => normalize(a) === alias))) continue;
      selected.push(match.entry);
      seenAliases.push(...match.entry.aliases.map(normalize));
      if (selected.length === limit) break;
    }
    return selected;
  }

  function createSlots(questionText, glossary) {
    return selectTerms(questionText, 2, [], glossary).map((definition) => ({ source: "question", status: "ready", definition }));
  }

  function fillAnswerSlots(slots, answerText, glossary) {
    const available = Math.max(0, 3 - slots.length);
    if (!available) return slots;
    const excluded = slots.map((slot) => slot.definition.canonicalTermId);
    const additions = selectTerms(answerText, available, excluded, glossary)
      .map((definition) => ({ source: "answer", status: "ready", definition }));
    return [...slots, ...additions].slice(0, 3);
  }

  function unknownCandidates(text, limit = 1, knownAliases = []) {
    const original = String(text || "");
    const excluded = new Set(knownAliases.map(normalize));
    const candidates = [];
    const acronymPattern = /\b([A-Z][A-Z0-9]{2,8})\b/g;
    const phrasePattern = /\b((?:[a-z][a-z-]{3,}\s+){1,3}(?:model|database|protocol|algorithm|architecture|framework|mechanism))\b/gi;
    for (const pattern of [acronymPattern, phrasePattern]) {
      for (const match of original.matchAll(pattern)) {
        const term = match[1].trim();
        if (excluded.has(normalize(term)) || candidates.some((item) => normalize(item.term) === normalize(term))) continue;
        candidates.push({ term, domain: inferDomains(original)[0] || "general", senseHint: `Meaning of ${term} in this subject` });
        if (candidates.length === limit) return candidates;
      }
    }
    return candidates;
  }

  function answerCandidates(text, limit = 5, glossary = global.ThreeKeywordsGlossary || []) {
    const candidates = selectTerms(text, limit, [], glossary).map((definition) => ({
      term: definition.displayTerm,
      domain: definition.domain,
      senseHint: `Meaning of ${definition.displayTerm} in this answer`,
      aliases: definition.aliases
    }));
    const aliases = candidates.flatMap((candidate) => candidate.aliases);
    for (const candidate of unknownCandidates(text, limit - candidates.length, aliases)) {
      candidates.push({ ...candidate, aliases: [candidate.term] });
    }
    if (candidates.length < limit) {
      const domains = inferDomains(text);
      for (const match of String(text || "").matchAll(/\b[a-z][a-z-]{7,}\b/gi)) {
        const term = match[0];
        if (!TECHNICAL_SINGLE_WORDS.has(normalize(term))) continue;
        if (candidates.some((candidate) => candidate.aliases.some((alias) => normalize(alias) === normalize(term)))) continue;
        candidates.push({ term, domain: domains[0] || "general", senseHint: `Meaning of ${term} in this answer`, aliases: [term] });
        if (candidates.length === limit) break;
      }
    }
    return candidates.slice(0, limit);
  }

  global.ThreeKeywordsCore = { normalize, inferDomains, selectTerms, createSlots, fillAnswerSlots, unknownCandidates, answerCandidates };
})(globalThis);
