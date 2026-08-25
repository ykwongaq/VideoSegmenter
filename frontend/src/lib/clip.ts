import type { RawDataset, RawRle, Tracklet } from "../types";
import type { ZipArchive } from "./zip";
import { colorForIndex } from "./palette";

/**
 * Parsed representation of one clip: its frames plus the tracklets to review.
 */
export class Clip {
	readonly name: string;
	readonly width: number;
	readonly height: number;
	readonly fps: number;
	readonly frameNames: string[];
	readonly tracklets: Tracklet[];

	private constructor(init: {
		name: string;
		width: number;
		height: number;
		fps: number;
		frameNames: string[];
		tracklets: Tracklet[];
	}) {
		this.name = init.name;
		this.width = init.width;
		this.height = init.height;
		this.fps = init.fps;
		this.frameNames = init.frameNames;
		this.tracklets = init.tracklets;
	}

	static async fromZip(zip: ZipArchive): Promise<Clip> {
		const jsonEntries = zip
			.getEntries()
			.filter((name) => /^annotations\/[^/]+\.json$/i.test(name));
		if (jsonEntries.length === 0) {
			throw new Error(
				"No annotation JSON found under annotations/ in the archive.",
			);
		}

		const raw = JSON.parse(await zip.readAsText(jsonEntries[0])) as RawDataset;
		const video = raw.videos?.[0];
		if (!video) throw new Error("Annotation JSON contains no video record.");
		if (!Array.isArray(video.file_names) || video.file_names.length === 0) {
			throw new Error("Annotation JSON contains no frame list (file_names).");
		}

		const tracklets: Tracklet[] = (raw.annotations ?? [])
			.filter((a) => a.video_id === video.id)
			.sort((a, b) => a.id - b.id)
			.map((a, i) => {
				let first = -1;
				let last = -1;
				let count = 0;
				const segmentations = a.segmentations ?? [];
				segmentations.forEach((seg, j) => {
					if (seg && seg.counts) {
						count += 1;
						if (first < 0) first = j;
						last = j;
					}
				});
				return {
					id: a.id,
					objectId: a.object_id,
					categoryId: a.category_id,
					label: a.noun_phrase ?? `object ${a.object_id}`,
					color: colorForIndex(i),
					segmentations,
					maskFrames: { first, last, count },
				};
			});

		const name =
			video.video_name ??
			jsonEntries[0].replace(/^annotations\//, "").replace(/\.json$/i, "");

		return new Clip({
			name,
			width: video.width,
			height: video.height,
			fps: typeof video.fps === "number" && video.fps > 0 ? video.fps : 25,
			frameNames: [...video.file_names],
			tracklets,
		});
	}

	get frameCount(): number {
		return this.frameNames.length;
	}

	frameEntry(index: number): string {
		return `frames/${this.frameNames[index]}`;
	}

	missingFrames(zip: ZipArchive): string[] {
		return this.frameNames.filter((name) => !zip.hasEntry(`frames/${name}`));
	}

	rawMaskAt(tracklet: Tracklet, frameIndex: number): RawRle | null {
		const seg = tracklet.segmentations[frameIndex];
		if (!seg || !seg.counts) return null;
		return seg;
	}
}
