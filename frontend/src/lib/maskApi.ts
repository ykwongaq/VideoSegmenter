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

/** Bounded cache of decoded masks, keyed by `trackletId:frameIndex`. */
export class MaskCache {
	private readonly store = new Map<string, DecodedMask>();
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

	private evict(): void {
		while (this.store.size > this.maxEntries) {
			const oldest = this.store.keys().next().value;
			if (oldest === undefined) break;
			this.store.delete(oldest);
		}
	}
}
