import {
	TAXONOMIC_RANKS,
	type TaxonomicRank,
	type Taxonomy,
} from "../types/annotations/Taxonomy";

/** A taxonomy with every rank empty. */
export function emptyTaxonomy(): Taxonomy {
	return {
		ranks: {
			kingdom: "",
			phylum: "",
			class: "",
			order: "",
			family: "",
			genus: "",
			species: "",
		},
	};
}

/** Deepest rank with a non-empty value, or null when nothing is specified. */
export function deepestSpecifiedRank(t: Taxonomy): TaxonomicRank | null {
	let deepest: TaxonomicRank | null = null;
	for (const rank of TAXONOMIC_RANKS) {
		if (t.ranks[rank]?.trim()) deepest = rank;
	}
	return deepest;
}

/** Display name for a taxonomic label: the deepest specified rank's value. */
export function taxonomyDisplayName(t: Taxonomy): string {
	const rank = deepestSpecifiedRank(t);
	return rank ? t.ranks[rank].trim() : "Unnamed";
}

/** True when `rank` is deeper than the deepest specified rank (uncertain). */
export function isRankUncertain(rank: TaxonomicRank, t: Taxonomy): boolean {
	const deepest = deepestSpecifiedRank(t);
	if (!deepest) return true;
	return TAXONOMIC_RANKS.indexOf(rank) > TAXONOMIC_RANKS.indexOf(deepest);
}
