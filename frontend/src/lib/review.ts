import type { Clip } from "./clip";
import type { Tracklet, TrackletReview } from "../types";

const STORAGE_PREFIX = "vsr.review.";

export interface ReviewCounts {
	total: number;
	verified: number;
	partial: number;
	pending: number;
}

export interface ExportRow {
	clip: string;
	tracklet_id: number;
	object_id: number;
	category_id: number;
	original_label: string;
	label_verdict: string;
	corrected_label: string;
	mask_verdict: string;
	comment: string;
}

export interface ExportPayload {
	clip: string;
	exportedAt: string;
	fps: number;
	width: number;
	height: number;
	reviews: ExportRow[];
	csv: string;
}

const EMPTY_REVIEW: TrackletReview = {
	labelVerdict: null,
	correctedLabel: "",
	maskVerdict: null,
	comment: "",
};

/**
 * Per-clip review state, persisted to `localStorage` so a partially reviewed
 * clip can be resumed later.
 */
export class ReviewStore {
	private readonly clipName: string;
	private reviews: Record<number, TrackletReview>;

	private constructor(
		clipName: string,
		reviews: Record<number, TrackletReview>,
	) {
		this.clipName = clipName;
		this.reviews = reviews;
	}

	static load(clipName: string): ReviewStore {
		let reviews: Record<number, TrackletReview> = {};
		try {
			const raw = localStorage.getItem(STORAGE_PREFIX + clipName);
			if (raw) reviews = JSON.parse(raw) as Record<number, TrackletReview>;
		} catch {
			reviews = {};
		}
		return new ReviewStore(clipName, reviews);
	}

	get(trackletId: number): TrackletReview {
		return this.reviews[trackletId] ?? EMPTY_REVIEW;
	}

	getRecord(): Record<number, TrackletReview> {
		return this.reviews;
	}

	update(trackletId: number, patch: Partial<TrackletReview>): void {
		this.reviews[trackletId] = { ...this.get(trackletId), ...patch };
		this.save();
	}

	counts(tracklets: Tracklet[]): ReviewCounts {
		let verified = 0;
		let partial = 0;
		let pending = 0;
		for (const tracklet of tracklets) {
			const review = this.get(tracklet.id);
			const hasLabel = review.labelVerdict !== null;
			const hasMask = review.maskVerdict !== null;
			if (hasLabel && hasMask) verified += 1;
			else if (hasLabel || hasMask) partial += 1;
			else pending += 1;
		}
		return { total: tracklets.length, verified, partial, pending };
	}

	private save(): void {
		try {
			localStorage.setItem(
				STORAGE_PREFIX + this.clipName,
				JSON.stringify(this.reviews),
			);
		} catch {
			/* storage unavailable — reviews remain in memory only */
		}
	}

	static buildExport(
		clip: Clip,
		record: Record<number, TrackletReview>,
	): ExportPayload {
		const header = [
			"clip",
			"tracklet_id",
			"object_id",
			"category_id",
			"original_label",
			"label_verdict",
			"corrected_label",
			"mask_verdict",
			"comment",
		] as const;

		const rows: ExportRow[] = clip.tracklets.map((tracklet) => {
			const review = record[tracklet.id] ?? EMPTY_REVIEW;
			return {
				clip: clip.name,
				tracklet_id: tracklet.id,
				object_id: tracklet.objectId,
				category_id: tracklet.categoryId,
				original_label: tracklet.label,
				label_verdict: review.labelVerdict ?? "",
				corrected_label: review.correctedLabel,
				mask_verdict: review.maskVerdict ?? "",
				comment: review.comment,
			};
		});

		const csv = [header.join(",")]
			.concat(
				rows.map((row) =>
					header.map((key) => escapeCsv(String(row[key]))).join(","),
				),
			)
			.join("\n");

		return {
			clip: clip.name,
			exportedAt: new Date().toISOString(),
			fps: clip.fps,
			width: clip.width,
			height: clip.height,
			reviews: rows,
			csv,
		};
	}
}

function escapeCsv(value: string): string {
	if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
	return value;
}
