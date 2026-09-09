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
		const controller = new AbortController();

		const draw = async () => {
			const canvas = canvasRef.current;
			const maskRenderer = maskRef.current;
			if (!canvas || !maskRenderer) return;
			if (viewport.w === 0 || viewport.h === 0) return;

			const cache = maskCacheRef.current!;
			const visible = props.showAllMasks
				? props.clip.tracklets
				: props.clip.tracklets.filter((t) => t.id === props.selectedTrackletId);

			// Masks already decoded for this frame (painted immediately) vs.
			// masks that still need a backend round-trip (painted when ready).
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

			// Fetch the current frame and paint it as soon as it is ready. Mask
			// decoding is intentionally NOT awaited here: it is a network call
			// that can be slower than one playback frame, and blocking the paint
			// on it lets requests pile up until the video freezes mid-play. The
			// frame is painted first; decoded masks are layered on when they
			// arrive. The canvas is only cleared once, right before the frame is
			// drawn, so playback never flashes a black/half-painted frame.
			let frame: ImageBitmap | null = null;
			try {
				frame = await cacheRef.current!.get(props.frameIndex);
			} catch {
				frame = null;
			}
			if (cancelled) return;
			// A bitmap closed by a concurrent cache eviction is detached; treat
			// it as unavailable rather than painting it.
			if (frame && isClosedBitmap(frame)) frame = null;

			const frameWidth = frame ? frame.width : props.clip.width;
			const frameHeight = frame ? frame.height : props.clip.height;
			const scale = Math.min(viewport.w / frameWidth, viewport.h / frameHeight);
			const drawWidth = frameWidth * scale;
			const drawHeight = frameHeight * scale;
			const drawX = (viewport.w - drawWidth) / 2;
			const drawY = (viewport.h - drawHeight) / 2;

			const dpr = window.devicePixelRatio || 1;
			const backingWidth = Math.max(1, Math.round(viewport.w * dpr));
			const backingHeight = Math.max(1, Math.round(viewport.h * dpr));
			if (canvas.width !== backingWidth) canvas.width = backingWidth;
			if (canvas.height !== backingHeight) canvas.height = backingHeight;

			const ctx = canvas.getContext("2d");
			if (!ctx) return;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

			// Draw only the overlay on top of the already-painted frame, without
			// clearing the canvas (so no flicker when a late decode lands).
			const paintOverlay = (
				masks: { tracklet: Tracklet; decoded: DecodedMask }[],
			) => {
				maskRenderer.clear();
				for (const { tracklet, decoded } of masks) {
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

			// Clear once, then paint frame + any masks that were already cached.
			ctx.fillStyle = "#000";
			ctx.fillRect(0, 0, viewport.w, viewport.h);

			if (frame) {
				ctx.drawImage(frame, drawX, drawY, drawWidth, drawHeight);
			} else {
				ctx.fillStyle = "#1b1f24";
				ctx.fillRect(drawX, drawY, drawWidth, drawHeight);
				ctx.fillStyle = "#9aa4af";
				ctx.font = "14px system-ui";
				ctx.fillText("Frame unavailable", drawX + 12, drawY + 24);
			}

			paintOverlay(resolved);

			// Decode this frame's missing masks in the background, then layer
			// them on top once they arrive (only if this frame is still current).
			// Stale requests are aborted on cleanup so they cannot back up
			// against the backend and stall playback.
			if (missing.length > 0) {
				try {
					const decodedList = await decodeMasks(
						missing.map((entry) => entry.payload),
						controller.signal,
					);
					if (cancelled) return;
					decodedList.forEach((decoded, index) => {
						const entry = missing[index];
						cache.set(
							MaskCache.key(entry.tracklet.id, props.frameIndex),
							decoded,
						);
						resolved.push({ tracklet: entry.tracklet, decoded });
					});
					paintOverlay(resolved);
				} catch {
					// Aborted (frame moved on) or decode failed — the frame is
					// already on screen; show it without this overlay.
				}
			}
		};

		void draw();
		return () => {
			cancelled = true;
			controller.abort();
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
