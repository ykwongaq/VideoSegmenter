import {
	TAXONOMIC_RANKS,
	type TaxonomicRank,
	type Taxonomy,
} from "../types/annotations";
import { emptyTaxonomy } from "../utils/taxonomy";

/**
 * Taxonomy lookups against public, CORS-enabled APIs (GBIF, WoRMS, iNaturalist,
 * Wikipedia). These are external services unrelated to the app backend, so we
 * use the browser `fetch` directly rather than the backend `apiClient`.
 *
 * Endpoints:
 *  - GBIF suggest:  https://api.gbif.org/v1/species/suggest?q=<query>
 *  - GBIF detail:   https://api.gbif.org/v1/species/<key>
 *  - GBIF media:    https://api.gbif.org/v1/occurrence/search?taxonKey=<key>&mediaType=StillImage
 *  - WoRMS suggest: https://www.marinespecies.org/rest/AphiaRecordsByName/<name>?like=true&marine_only=true
 *  - WoRMS detail:  https://www.marinespecies.org/rest/AphiaRecordByAphiaID/<id>
 *  - iNaturalist:   https://api.inaturalist.org/v1/taxa?q=<name>
 *  - Wikipedia:     https://en.wikipedia.org/api/rest_v1/page/summary/<name>
 */

const GBIF_BASE = "https://api.gbif.org/v1";
const WORMS_BASE = "https://www.marinespecies.org/rest";
const INATURALIST_BASE = "https://api.inaturalist.org/v1";
const WIKIPEDIA_SUMMARY = "https://en.wikipedia.org/api/rest_v1/page/summary";

export type TaxonSource = "gbif" | "worms";

export interface TaxonSuggestion {
	key: number;
	scientificName: string;
	canonicalName?: string;
	rank: string; // source rank, e.g. GBIF "GENUS" or WoRMS "Genus"
	source: TaxonSource;
}

/** GBIF returns ranks upper-cased; map to our lower-case rank union. */
function normalizeRank(rank: string | undefined): TaxonomicRank | null {
	if (!rank) return null;
	const lower = rank.toLowerCase();
	return (TAXONOMIC_RANKS as readonly string[]).includes(lower)
		? (lower as TaxonomicRank)
		: null;
}

/** GBIF-only name suggestions. Optionally restrict to a single GBIF rank (e.g.
 * "GENUS") so each field suggests the right level. */
export async function suggestGbifTaxa(
	query: string,
	signal?: AbortSignal,
	rank?: string,
): Promise<TaxonSuggestion[]> {
	const q = query.trim();
	if (!q) return [];

	const rankParam = rank ? `&rank=${encodeURIComponent(rank)}` : "";
	const res = await fetch(
		`${GBIF_BASE}/species/suggest?q=${encodeURIComponent(q)}&limit=12${rankParam}`,
		{ signal },
	);
	if (!res.ok) throw new Error(`GBIF suggest failed: ${res.status}`);

	const data = (await res.json()) as Array<{
		key: number;
		scientificName?: string;
		canonicalName?: string;
		rank?: string;
	}>;

	return data.map((d) => ({
		key: d.key,
		scientificName: d.scientificName ?? d.canonicalName ?? "",
		canonicalName: d.canonicalName,
		rank: d.rank ?? "",
		source: "gbif" as const,
	}));
}

/** WoRMS (Aphia) name suggestions. WoRMS has no rank query param, so the rank
 * filter is applied client-side. */
export async function suggestWormsTaxa(
	query: string,
	signal?: AbortSignal,
	rank?: string,
): Promise<TaxonSuggestion[]> {
	const q = query.trim();
	if (!q) return [];

	const res = await fetch(
		`${WORMS_BASE}/AphiaRecordsByName/${encodeURIComponent(q)}?like=true&marine_only=true`,
		{ signal },
	);
	if (!res.ok) throw new Error(`WoRMS suggest failed: ${res.status}`);

	const raw = (await res.json()) as unknown;
	const records: unknown[] = Array.isArray(raw) ? raw : [raw];
	const rankFilter = rank?.toLowerCase();

	return records
		.filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
		.map((d) => ({
			key: Number(d.AphiaID),
			scientificName:
				typeof d.scientificname === "string" ? d.scientificname : "",
			rank: typeof d.rank === "string" ? d.rank : "",
			source: "worms" as const,
		}))
		.filter((s) => Number.isFinite(s.key) && s.scientificName !== "")
		.filter((s) => !rankFilter || s.rank.toLowerCase() === rankFilter);
}

/**
 * Real-time taxon name suggestions with source fallback: GBIF first, then
 * WoRMS (marine taxa) when GBIF returns no matches or fails.
 */
export async function suggestTaxa(
	query: string,
	signal?: AbortSignal,
	rank?: string,
): Promise<TaxonSuggestion[]> {
	try {
		const gbif = await suggestGbifTaxa(query, signal, rank);
		if (gbif.length > 0) return gbif;
	} catch (err) {
		if (isAbort(err)) throw err;
	}

	try {
		return await suggestWormsTaxa(query, signal, rank);
	} catch (err) {
		if (isAbort(err)) throw err;
		return [];
	}
}

/**
 * Fetch a taxon's full hierarchy by GBIF key and build a Taxonomy with every
 * rank from kingdom down to (and including) the taxon's own rank filled in.
 */
export async function getGbifTaxonDetail(
	key: number,
	signal?: AbortSignal,
): Promise<Taxonomy> {
	const res = await fetch(`${GBIF_BASE}/species/${key}`, { signal });
	if (!res.ok) throw new Error(`GBIF detail failed: ${res.status}`);

	const data = (await res.json()) as Record<string, unknown>;
	const taxonomy = emptyTaxonomy();
	taxonomy.sourceKey = key;

	// GBIF detail exposes each rank as a top-level field (kingdom, phylum, ...).
	for (const rank of TAXONOMIC_RANKS) {
		const value = data[rank];
		if (typeof value === "string" && value.trim()) {
			taxonomy.ranks[rank] = value.trim();
		}
	}

	// Ensure the taxon's own rank is populated from its canonical name even if
	// GBIF omitted the matching rank field (can happen for the queried rank).
	const ownRank = normalizeRank(data.rank as string | undefined);
	if (ownRank && !taxonomy.ranks[ownRank]) {
		const name =
			(data.canonicalName as string) ?? (data.scientificName as string) ?? "";
		if (name.trim()) taxonomy.ranks[ownRank] = name.trim();
	}

	return taxonomy;
}

/**
 * Fetch a taxon's full hierarchy by WoRMS AphiaID. WoRMS records carry
 * kingdom..genus plus `scientificname`; the species slot is derived from
 * `scientificname` when the record's own rank is species.
 */
export async function getWormsTaxonDetail(
	id: number,
	signal?: AbortSignal,
): Promise<Taxonomy> {
	const res = await fetch(`${WORMS_BASE}/AphiaRecordByAphiaID/${id}`, {
		signal,
	});
	if (!res.ok) throw new Error(`WoRMS detail failed: ${res.status}`);

	const data = (await res.json()) as Record<string, unknown>;
	const taxonomy = emptyTaxonomy();
	taxonomy.sourceKey = id;

	for (const rank of TAXONOMIC_RANKS) {
		const value = data[rank];
		if (typeof value === "string" && value.trim()) {
			taxonomy.ranks[rank] = value.trim();
		}
	}

	const ownRank = normalizeRank(data.rank as string | undefined);
	if (ownRank && !taxonomy.ranks[ownRank]) {
		const name = data.scientificname as string | undefined;
		if (name && name.trim()) taxonomy.ranks[ownRank] = name.trim();
	}

	return taxonomy;
}

/** Fetch the full hierarchy for a suggestion from whichever source produced it. */
export async function getTaxonDetailBySuggestion(
	suggestion: TaxonSuggestion,
	signal?: AbortSignal,
): Promise<Taxonomy> {
	return suggestion.source === "worms"
		? getWormsTaxonDetail(suggestion.key, signal)
		: getGbifTaxonDetail(suggestion.key, signal);
}

/**
 * Find a representative image URL for a taxon. Tries GBIF occurrence media
 * first (keyed by usageKey), then iNaturalist's default photo, then a Wikipedia
 * page thumbnail. Returns null when nothing is found.
 */
export async function getTaxonImage(
	opts: { gbifKey?: number; name?: string },
	signal?: AbortSignal,
): Promise<string | null> {
	const { gbifKey, name } = opts;

	// 1. GBIF occurrence media (actual photographed records of the taxon).
	if (gbifKey !== undefined) {
		try {
			const res = await fetch(
				`${GBIF_BASE}/occurrence/search?taxonKey=${gbifKey}&mediaType=StillImage&limit=1`,
				{ signal },
			);
			if (res.ok) {
				const data = (await res.json()) as {
					results?: Array<{ media?: Array<{ identifier?: string }> }>;
				};
				const url = data.results?.[0]?.media?.[0]?.identifier;
				if (url) return url;
			}
		} catch (err) {
			if (isAbort(err)) throw err;
		}
	}

	if (!name || !name.trim()) return null;

	// 2. iNaturalist default photo.
	try {
		const res = await fetch(
			`${INATURALIST_BASE}/taxa?q=${encodeURIComponent(name)}&per_page=1`,
			{ signal },
		);
		if (res.ok) {
			const data = (await res.json()) as {
				results?: Array<{
					default_photo?: { medium_url?: string; url?: string };
				}>;
			};
			const photo = data.results?.[0]?.default_photo;
			const url = photo?.medium_url ?? photo?.url;
			if (url) return url;
		}
	} catch (err) {
		if (isAbort(err)) throw err;
	}

	// 3. Wikipedia page thumbnail.
	try {
		const res = await fetch(
			`${WIKIPEDIA_SUMMARY}/${encodeURIComponent(name)}`,
			{ signal },
		);
		if (res.ok) {
			const data = (await res.json()) as {
				thumbnail?: { source?: string };
			};
			if (data.thumbnail?.source) return data.thumbnail.source;
		}
	} catch (err) {
		if (isAbort(err)) throw err;
	}

	return null;
}

/** True when an error is an AbortController cancellation. */
export function isAbort(err: unknown): boolean {
	return err instanceof DOMException && err.name === "AbortError";
}
