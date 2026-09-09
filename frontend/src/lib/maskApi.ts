import type { DecodedMask, RawRle } from "../types";

/**
 * Client for the backend mask-decoding endpoint. The frontend sends raw RLE
 * masks (size + counts) and receives the decoded foreground runs, so no RLE
 * decoding happens in the browser.
 */
// Backend base URL from `VITE_API_BASE_URL` (production builds). Falls back to
// a relative `/api` path so the dev server keeps using the Vite proxy.
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");
const ENDPOINT = `${API_BASE}/api/decode/masks`;

export async function decodeMasks(masks: RawRle[]): Promise<DecodedMask[]> {
	if (masks.length === 0) return [];

	const response = await fetch(ENDPOINT, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ masks }),
	});
	if (!response.ok) {
		throw new Error(`Mask decode request failed (${response.status}).`);
	}
	const payload = (await response.json()) as { masks: DecodedMask[] };
	if (!Array.isArray(payload.masks) || payload.masks.length !== masks.length) {
		throw new Error("Mask decode response did not match the request.");
	}
	return payload.masks;
}

const DEFAULT_MAX_ENTRIES = 512;

/** A mask that needs to be decoded, together with its cache identity. */
export interface MaskRequest {
	trackletId: number;
	frameIndex: number;
	payload: RawRle;
}

/**
 * Bounded cache of decoded masks, keyed by `trackletId:frameIndex`.
 *
 * `resolveBatch` is the single entry point the UI uses: it returns cached
 * masks immediately, awaits any decode already in flight for the same key,
 * and batches the remaining masks into one network round-trip. The in-flight
 * bookkeeping is synchronous, so concurrent callers (the current-frame render
 * and the look-ahead prefetcher) can never duplicate a request.
 */
export class MaskCache {
	private readonly store = new Map<string, DecodedMask>();
	private readonly inflight = new Map<string, Promise<DecodedMask>>();
	private readonly maxEntries: number;

	constructor(maxEntries: number = DEFAULT_MAX_ENTRIES) {
		this.maxEntries = maxEntries;
	}

	static key(trackletId: number, frameIndex: number): string {
		return `${trackletId}:${frameIndex}`;
	}

	get(key: string): DecodedMask | undefined {
		return this.store.get(key);
	}

	set(key: string, mask: DecodedMask): void {
		this.store.set(key, mask);
		this.evict();
	}

	/**
	 * Resolve a batch of mask requests. Returns one entry per input, in the
	 * same order; masks that cannot be decoded resolve to `undefined`.
	 */
	async resolveBatch(
		requests: MaskRequest[],
	): Promise<(DecodedMask | undefined)[]> {
		const results = new Array<DecodedMask | undefined>(requests.length);
		const waits: Promise<void>[] = [];
		const toFetch: { index: number; request: MaskRequest; key: string }[] = [];

		for (let i = 0; i < requests.length; i++) {
			const request = requests[i];
			const key = MaskCache.key(request.trackletId, request.frameIndex);
			const cached = this.store.get(key);
			if (cached) {
				results[i] = cached;
				continue;
			}
			const existing = this.inflight.get(key);
			if (existing) {
				const index = i;
				waits.push(
					existing.then(
						(mask) => {
							results[index] = mask;
						},
						() => {
							results[index] = undefined;
						},
					),
				);
				continue;
			}
			toFetch.push({ index: i, request, key });
		}

		if (toFetch.length > 0) {
			const batch = decodeMasks(toFetch.map((entry) => entry.request.payload));
			toFetch.forEach(({ index, key }, i) => {
				const single = batch
					.then((decoded) => decoded[i])
					.then((mask) => {
						this.set(key, mask);
						return mask;
					});
				this.inflight.set(key, single);
				waits.push(
					single.then(
						(mask) => {
							results[index] = mask;
						},
						() => {
							results[index] = undefined;
						},
					),
				);
			});
		}

		await Promise.all(waits);

		for (const { key } of toFetch) {
			this.inflight.delete(key);
		}

		return results;
	}

	private evict(): void {
		while (this.store.size > this.maxEntries) {
			const oldest = this.store.keys().next().value;
			if (oldest === undefined) break;
			this.store.delete(oldest);
		}
	}
}
