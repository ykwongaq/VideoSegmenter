import type { ZipArchive } from "./zip";

const MAX_ENTRIES = 40;

/**
 * LRU cache of decoded frame bitmaps. JPEG frames decode to full-resolution
 * bitmaps, so the cache is intentionally small and evicts the oldest frames.
 */
export class FrameCache {
	private readonly cache = new Map<number, ImageBitmap>();
	private readonly order: number[] = [];
	private readonly zip: ZipArchive;
	private readonly frameNames: string[];

	constructor(zip: ZipArchive, frameNames: string[]) {
		this.zip = zip;
		this.frameNames = frameNames;
	}

	async get(index: number): Promise<ImageBitmap> {
		const cached = this.cache.get(index);
		if (cached) {
			this.touch(index);
			return cached;
		}

		const name = this.frameNames[index];
		if (name === undefined)
			throw new Error(`Frame index out of range: ${index}`);
		const blob = await this.zip.readAsBlob(`frames/${name}`);
		const bitmap = await createImageBitmap(blob);
		this.cache.set(index, bitmap);
		this.order.push(index);
		this.evict();
		return bitmap;
	}

	preload(indices: number[]): void {
		for (const index of indices) {
			void this.get(index).catch(() => {
				/* a missing frame is tolerated and reported by the caller */
			});
		}
	}

	private touch(index: number): void {
		const position = this.order.indexOf(index);
		if (position !== -1) this.order.splice(position, 1);
		this.order.push(index);
	}

	private evict(): void {
		while (this.order.length > MAX_ENTRIES) {
			const victim = this.order.shift();
			if (victim === undefined) break;
			const bitmap = this.cache.get(victim);
			if (bitmap) bitmap.close();
			this.cache.delete(victim);
		}
	}
}
