import { useEffect, useRef, useState } from "react";
import type { Clip } from "../lib/clip";
import type { ZipArchive } from "../lib/zip";
import { FrameCache } from "../lib/frameCache";
import { MaskRenderer } from "../lib/mask";
import { decodeMasks, MaskCache } from "../lib/maskApi";
import { formatTimecode } from "../lib/format";
import type { DecodedMask, RawRle, Tracklet } from "../types";
import styles from "./VideoPanel.module.css";

interface VideoPanelProps {
	clip: Clip;
	zip: ZipArchive;
	frameIndex: number;
	playing: boolean;
	selectedTrackletId: number | null;
	showAllMasks: boolean;
	maskOpacity: number;
	onFrameChange: (frame: number) => void;
	onPlayToggle: () => void;
	onStep: (delta: number) => void;
	onShowAllMasksChange: (value: boolean) => void;
	onMaskOpacityChange: (value: number) => void;
}

/**
 * `ImageBitmap.closed` is a standard readonly flag in browsers, but it is not
 * present in this TypeScript version's DOM typings (only `close()` is), so
 * access it through this typed helper. A closed bitmap is detached and must
 * not be passed to `drawImage`.
 */
function isClosedBitmap(bitmap: ImageBitmap): boolean {
	return (
		(bitmap as ImageBitmap & { readonly closed?: boolean }).closed ?? false
	);
}

export function VideoPanel(props: VideoPanelProps) {
	const wrapRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);

	const cacheRef = useRef<FrameCache | null>(null);
	if (!cacheRef.current) {
		cacheRef.current = new FrameCache(props.zip, props.clip.frameNames);
	}
	const maskRef = useRef<MaskRenderer | null>(null);
	if (!maskRef.current) {
		maskRef.current = new MaskRenderer(props.clip.width, props.clip.height);
	}
	const maskCacheRef = useRef<MaskCache | null>(null);
	if (!maskCacheRef.current) {
		maskCacheRef.current = new MaskCache();
	}

	const [viewport, setViewport] = useState({ w: 0, h: 0 });

	useEffect(() => {
		const element = wrapRef.current;
		if (!element) return;
		const observer = new ResizeObserver((entries) => {
			const rect = entries[0].contentRect;
			setViewport({ w: rect.width, h: rect.height });
		});
		observer.observe(element);
		setViewport({ w: element.clientWidth, h: element.clientHeight });
		return () => observer.disconnect();
	}, []);

	// Preload a window of frames around the playhead.
	useEffect(() => {
		const cache = cacheRef.current;
		if (!cache) return;
		const total = props.clip.frameCount;
		const wanted: number[] = [];
		for (let d = 1; d <= 15; d++) {
			if (props.frameIndex + d < total) wanted.push(props.frameIndex + d);
			if (props.frameIndex - d >= 0) wanted.push(props.frameIndex - d);
		}
		cache.preload(wanted);
	}, [props.frameIndex, props.clip]);

	// Render the current frame and its mask overlay.
	useEffect(() => {
		let cancelled = false;

		const draw = async () => {
			const canvas = canvasRef.current;
			const maskRenderer = maskRef.current;
			if (!canvas || !maskRenderer) return;
			if (viewport.w === 0 || viewport.h === 0) return;

			// Collect the mask payloads that still need decoding for this
			// frame. Decoding goes through an async fetch to the backend, and
			// frame bitmaps come from an async LRU cache. Both are started
			// below *before* the canvas is touched: the canvas is only cleared
			// at the very end, right before the complete frame is painted, so
			// playback never flashes a black or half-drawn frame while async
			// work is pending. (Fetching the frame and painting it with no
			// await in between also prevents drawImage from ever receiving a
			// cache-evicted, detached bitmap.)
			const cache = maskCacheRef.current!;
			const visible = props.showAllMasks
				? props.clip.tracklets
				: props.clip.tracklets.filter((t) => t.id === props.selectedTrackletId);

			const resolved: { tracklet: Tracklet; decoded: DecodedMask }[] = [];
			const missing: { tracklet: Tracklet; payload: RawRle }[] = [];
			for (const tracklet of visible) {
				const payload = props.clip.rawMaskAt(tracklet, props.frameIndex);
				if (!payload) continue;
				const key = MaskCache.key(tracklet.id, props.frameIndex);
				const cached = cache.get(key);
				if (cached) resolved.push({ tracklet, decoded: cached });
				else missing.push({ tracklet, payload });
			}

			// Run the async work concurrently: fetch the frame bitmap while the
			// missing masks are being decoded.
			const maskTask = (async () => {
				if (missing.length === 0) return;
				try {
					const decodedList = await decodeMasks(
						missing.map((entry) => entry.payload),
					);
					decodedList.forEach((decoded, index) => {
						const entry = missing[index];
						cache.set(
							MaskCache.key(entry.tracklet.id, props.frameIndex),
							decoded,
						);
						resolved.push({ tracklet: entry.tracklet, decoded });
					});
				} catch {
					// Mask decoding failed — draw the frame without its overlay.
				}
			})();

			const frameTask = (async (): Promise<ImageBitmap | null> => {
				try {
					const bitmap = await cacheRef.current!.get(props.frameIndex);
					// A bitmap closed by a concurrent cache eviction is
					// detached; treat it as unavailable rather than painting it.
					return isClosedBitmap(bitmap) ? null : bitmap;
				} catch {
					return null;
				}
			})();

			await Promise.all([maskTask, frameTask]);
			const frame = await frameTask;
			if (cancelled) return;

			// --- Everything below is synchronous. Clear and paint the complete
			// frame + overlay in one shot, so the canvas never sits in a
			// cleared (black) state between frames.
			const dpr = window.devicePixelRatio || 1;
			const backingWidth = Math.max(1, Math.round(viewport.w * dpr));
			const backingHeight = Math.max(1, Math.round(viewport.h * dpr));
			if (canvas.width !== backingWidth) canvas.width = backingWidth;
			if (canvas.height !== backingHeight) canvas.height = backingHeight;

			const ctx = canvas.getContext("2d");
			if (!ctx) return;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx.fillStyle = "#000";
			ctx.fillRect(0, 0, viewport.w, viewport.h);

			const frameWidth = frame ? frame.width : props.clip.width;
			const frameHeight = frame ? frame.height : props.clip.height;
			const scale = Math.min(viewport.w / frameWidth, viewport.h / frameHeight);
			const drawWidth = frameWidth * scale;
			const drawHeight = frameHeight * scale;
			const drawX = (viewport.w - drawWidth) / 2;
			const drawY = (viewport.h - drawHeight) / 2;

			if (frame) {
				ctx.drawImage(frame, drawX, drawY, drawWidth, drawHeight);
			} else {
				ctx.fillStyle = "#1b1f24";
				ctx.fillRect(drawX, drawY, drawWidth, drawHeight);
				ctx.fillStyle = "#9aa4af";
				ctx.font = "14px system-ui";
				ctx.fillText("Frame unavailable", drawX + 12, drawY + 24);
			}

			maskRenderer.clear();
			for (const { tracklet, decoded } of resolved) {
				maskRenderer.drawRuns(decoded.runs, tracklet.color);
			}

			ctx.save();
			ctx.globalAlpha = props.maskOpacity;
			ctx.drawImage(
				maskRenderer.canvasElement,
				drawX,
				drawY,
				drawWidth,
				drawHeight,
			);
			ctx.restore();
		};

		void draw();
		return () => {
			cancelled = true;
		};
	}, [
		viewport,
		props.clip,
		props.frameIndex,
		props.selectedTrackletId,
		props.showAllMasks,
		props.maskOpacity,
	]);

	return (
		<div className={styles.panel}>
			<div ref={wrapRef} className={styles.canvasWrap}>
				<canvas ref={canvasRef} className={styles.canvas} />
			</div>

			<div className={styles.controls}>
				<button
					type="button"
					className="btn"
					onClick={props.onPlayToggle}
					title="Space"
				>
					{props.playing ? "Pause" : "Play"}
				</button>
				<button
					type="button"
					className="btn"
					onClick={() => props.onStep(-1)}
					title="←"
				>
					◀
				</button>
				<button
					type="button"
					className="btn"
					onClick={() => props.onStep(1)}
					title="→"
				>
					▶
				</button>

				<input
					type="range"
					className={styles.slider}
					min={0}
					max={Math.max(0, props.clip.frameCount - 1)}
					step={1}
					value={props.frameIndex}
					onChange={(event) => props.onFrameChange(Number(event.target.value))}
				/>

				<span className={styles.timecode}>
					{props.frameIndex + 1} / {props.clip.frameCount} ·{" "}
					{formatTimecode(props.frameIndex, props.clip.fps)}
				</span>

				<label className={styles.opacityGroup}>
					Overlay
					<input
						type="range"
						min={0}
						max={1}
						step={0.05}
						value={props.maskOpacity}
						onChange={(event) =>
							props.onMaskOpacityChange(Number(event.target.value))
						}
					/>
					{Math.round(props.maskOpacity * 100)}%
				</label>

				<label className={styles.check}>
					<input
						type="checkbox"
						checked={props.showAllMasks}
						onChange={(event) =>
							props.onShowAllMasksChange(event.target.checked)
						}
					/>
					Show all masks
				</label>
			</div>
		</div>
	);
}
