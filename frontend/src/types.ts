/**
 * Data model for the video-segmentation review tool.
 *
 * The annotation JSON follows the "VideoSegmentation" layout emitted by
 * pycocotools-based pipelines: one `videos` record (with `fps`) and a flat
 * `annotations` array of tracklets whose `segmentations` are per-frame RLE
 * masks encoded by `pycocotools.mask.encode`.
 */

export interface RawVideo {
	id: number;
	video_name: string;
	file_names: string[];
	length: number;
	height: number;
	width: number;
	fps: number;
	original_video?: string;
	scene_id?: string;
	start_frame?: number;
	end_frame?: number;
	status?: string;
}

export interface RawRle {
	size: [number, number];
	counts: string | number[];
}

/** A single foreground run decoded from an RLE mask. */
export interface ForegroundRun {
	x: number;
	y: number;
	length: number;
}

/** An RLE mask decoded by the backend into drawable foreground runs. */
export interface DecodedMask {
	height: number;
	width: number;
	runs: ForegroundRun[];
}

export interface RawAnnotation {
	id: number;
	video_id: number;
	object_id: number;
	category_id: number;
	noun_phrase: string;
	segmentations: RawRle[];
}

export interface RawCategory {
	id: number;
	taxon_id?: number;
	kingdom?: string;
	phylum?: string;
	class?: string;
	order?: string;
	family?: string;
	genus?: string;
	species?: string;
	common_name?: string;
}

export interface RawDataset {
	videos: RawVideo[];
	annotations: RawAnnotation[];
	categories?: RawCategory[];
}

/** The taxonomic hierarchy attached to a tracklet's label. */
export interface Taxonomy {
	taxonId: number | null;
	kingdom: string;
	phylum: string;
	class: string;
	order: string;
	family: string;
	genus: string;
	species: string;
	commonName: string;
}

export type TaxonomyKey = Exclude<keyof Taxonomy, "taxonId">;

/** An annotation promoted into a first-class tracklet used by the UI. */
export interface Tracklet {
	id: number;
	objectId: number;
	categoryId: number;
	label: string;
	taxonomy: Taxonomy;
	color: string;
	segmentations: RawRle[];
	maskFrames: {
		first: number;
		last: number;
		count: number;
	};
}

export type MaskVerdict = "good" | "bad" | "unsure";

export interface TrackletReview {
	labelConfirmed: boolean;
	taxonomy: Taxonomy | null;
	maskVerdict: MaskVerdict | null;
	comment: string;
}
