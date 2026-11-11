export async function searchDefinition(candidate, { apiKey, signal }) {
  if (!apiKey) return { status: "unconfigured" };
  const query = `Define "${candidate.term}" in ${candidate.domain || "general"} context. Meaning hint: ${candidate.senseHint || "none"}. Use one plain-English sentence under 30 words.`;
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ query, search_depth: "basic", max_results: 3, include_answer: "basic", include_raw_content: false, include_images: false, auto_parameters: false, topic: "general" }),
    signal
  });
  if (response.status === 429) return { status: "unavailable" };
  if (!response.ok) return { status: "unavailable" };
  const data = await response.json();
  return definitionFromProvider(candidate, data);
}

export function definitionFromProvider(candidate, data) {
  const answer = String(data?.answer || "").replace(/\s+/g, " ").trim();
  const oneLiner = answer.match(/^.*?[.!?](?=\s|$)/)?.[0]?.trim() || "";
  const words = oneLiner ? oneLiner.split(/\s+/) : [];
  const significantTerms = String(candidate.term).toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4);
  const source = data?.results?.find((item) => {
    try {
      if (!item.title || !["http:", "https:"].includes(new URL(item.url).protocol)) return false;
      const searchable = `${item.title} ${item.content || ""}`.toLowerCase();
      return significantTerms.length === 0 || significantTerms.some((word) => searchable.includes(word));
    } catch { return false; }
  });
  if (!oneLiner || words.length > 40 || !/[.!?]$/.test(oneLiner) || !source) return { status: "missing" };
  const now = new Date();
  return {
    status: "resolved",
    definition: {
      canonicalTermId: slug(candidate.term),
      displayTerm: candidate.term,
      aliases: [candidate.term],
      domain: candidate.domain || "general",
      senseId: slug(candidate.senseHint || candidate.term),
      language: "en",
      explanationVersion: 1,
      oneLiner,
      sources: [{ title: String(source.title).slice(0, 160), url: source.url }],
      origin: "generated-from-sources",
      verifiedAt: now.toISOString(),
      refreshAfter: new Date(now.getTime() + 90 * 86400000).toISOString()
    }
  };
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "term";
}
