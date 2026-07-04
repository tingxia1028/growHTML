// SEARCH-1 client IO — one plain-fetch call for GET /api/search. Its OWN module (the
// dataTrust/chat-session carve-out idiom: the contended entityClient is untouched);
// the palette takes this as an injectable `fetchHits` seam, so tests mock it and a
// direct-transport host (mobile X2) can swap in a transport-backed fetcher — the
// server route already has direct parity (services/directTransport.ts).

import type { SearchHitDto } from "./searchEngine";

/** Query the vault. Failures degrade to [] — search must never break the palette. */
export async function fetchSearchHits(q: string): Promise<SearchHitDto[]> {
  if (!q.trim()) return [];
  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    if (!response.ok) return [];
    const body = (await response.json().catch(() => null)) as { hits?: unknown } | null;
    return Array.isArray(body?.hits) ? (body.hits as SearchHitDto[]) : [];
  } catch {
    return [];
  }
}
