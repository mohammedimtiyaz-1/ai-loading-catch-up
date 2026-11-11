import { searchDefinition } from "./provider.js";

const inFlight = new Map();

export function validateRequest(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.terms) || value.terms.length < 1 || value.terms.length > 3) return false;
  if (JSON.stringify(value).length > 8192) return false;
  return value.terms.every((term) => term && typeof term.term === "string" && term.term.trim().length > 0 && term.term.length <= 120 && typeof term.domain === "string" && term.domain.length <= 40 && typeof term.senseHint === "string" && term.senseHint.length <= 160);
}

export function keyFor(term) {
  return `v1:en:${term.domain.toLowerCase()}:${term.term.toLowerCase().replace(/\s+/g, "-")}:${term.senseHint.toLowerCase().replace(/\s+/g, "-")}`;
}

export async function resolveRequest(body, { cache, apiKey, monthlyLimit = 900, provider = searchDefinition }) {
  const results = await Promise.all(body.terms.map(async (term) => {
    const key = keyFor(term);
    const cached = cache.get(key);
    if (cached?.negativeStatus) return { status: cached.negativeStatus, cache: "backend" };
    if (cached) return { status: "resolved", definition: cached, cache: "backend" };
    if (!apiKey) return { status: "unconfigured" };
    if (inFlight.has(key)) return inFlight.get(key);
    if (!cache.reserveAttempt(monthlyLimit)) return { status: "budget_exhausted" };
    const operation = (async () => {
      try {
        const result = await provider(term, { apiKey, signal: AbortSignal.timeout(5000) });
        if (result.status === "resolved") cache.set(key, result.definition, result.definition.refreshAfter);
        if (["missing", "ambiguous"].includes(result.status)) {
          cache.set(key, { negativeStatus: result.status }, new Date(Date.now() + 5 * 60 * 1000).toISOString());
        }
        return result;
      } catch (error) {
        return { status: "unavailable" };
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, operation);
    return operation;
  }));
  return { requestId: typeof body.requestId === "string" ? body.requestId.slice(0, 100) : null, results };
}
