import { useEffect, useRef, useState } from "react";
import type { Clip } from "../lib/clip";
import type { ZipArchive } from "../lib/zip";
import { FrameCache } from "../lib/frameCache";
import { MaskRenderer } from "../lib/mask";
import { MaskCache, type MaskRequest } from "../lib/maskApi";
import { formatTimecode } from "../lib/format";
import type { Tracklet } from "../types";
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

	// Frame index currently painted on the canvas; used to guard the mask
	// overlay against compositing stale masks over a newer frame.
	const paintedFrameRef = useRef(-1);

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

	// Prefetch masks for the frames just ahead of the playhead so that, by the
	// time a frame is displayed during playback, its mask is already decoded
	// and cached (and therefore drawn synchronously on the first pass).
	useEffect(() => {
		const cache = maskCacheRef.current;
		if (!cache) return;
		const total = props.clip.frameCount;
		const visible = props.showAllMasks
			? props.clip.tracklets
			: props.clip.tracklets.filter((t) => t.id === props.selectedTrackletId);

		const requests: MaskRequest[] = [];
		const MAX_PREFETCH_MASKS = 64;
		for (let d = 1; d <= 8 && requests.length < MAX_PREFETCH_MASKS; d++) {
			const index = props.frameIndex + d;
			if (index >= total) break;
			for (const tracklet of visible) {
				if (requests.length >= MAX_PREFETCH_MASKS) break;
				const payload = props.clip.rawMaskAt(tracklet, index);
				if (!payload) continue;
				requests.push({
					trackletId: tracklet.id,
					frameIndex: index,
					payload,
				});
			}
		}
		if (requests.length === 0) return;
		void cache.resolveBatch(requests).catch(() => {});
	}, [
		props.frameIndex,
		props.clip,
		props.selectedTrackletId,
		props.showAllMasks,
	]);

	// Render the current frame and its mask overlay.
	useEffect(() => {
		let cancelled = false;

		const draw = async () => {
			const canvas = canvasRef.current;
			const maskRenderer = maskRef.current;
			if (!canvas || !maskRenderer) return;

			const dpr = window.devicePixelRatio || 1;
			const backingWidth = Math.max(1, Math.round(viewport.w * dpr));
			const backingHeight = Math.max(1, Math.round(viewport.h * dpr));
			if (canvas.width !== backingWidth) canvas.width = backingWidth;
			if (canvas.height !== backingHeight) canvas.height = backingHeight;

			const ctx = canvas.getContext("2d");
			if (!ctx) return;

			let frame: ImageBitmap | null = null;
			try {
				frame = await cacheRef.current!.get(props.frameIndex);
			} catch {
				frame = null;
			}
			if (cancelled) return;
			if (viewport.w === 0 || viewport.h === 0) return;

			const frameWidth = frame ? frame.width : props.clip.width;
			const frameHeight = frame ? frame.height : props.clip.height;
			const scale = Math.min(viewport.w / frameWidth, viewport.h / frameHeight);
			const drawWidth = frameWidth * scale;
			const drawHeight = frameHeight * scale;
			const drawX = (viewport.w - drawWidth) / 2;
			const drawY = (viewport.h - drawHeight) / 2;

			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
			paintedFrameRef.current = props.frameIndex;

			const cache = maskCacheRef.current!;
			const visible = props.showAllMasks
				? props.clip.tracklets
				: props.clip.tracklets.filter((t) => t.id === props.selectedTrackletId);

			const requests: MaskRequest[] = [];
			const requestTracklets: Tracklet[] = [];
			for (const tracklet of visible) {
				const payload = props.clip.rawMaskAt(tracklet, props.frameIndex);
				if (!payload) continue;
				requests.push({
					trackletId: tracklet.id,
					frameIndex: props.frameIndex,
					payload,
				});
				requestTracklets.push(tracklet);
			}

			const decodedList =
				requests.length > 0 ? await cache.resolveBatch(requests) : [];

			// Only composite if the canvas still shows the frame these masks
			// belong to; a slow decode must not paint stale masks over a newer
			// frame (that frame's own render handles its overlay).
			if (paintedFrameRef.current !== props.frameIndex) return;

			maskRenderer.clear();
			for (let i = 0; i < requestTracklets.length; i++) {
				const decoded = decodedList[i];
				if (!decoded) continue;
				maskRenderer.drawRuns(decoded.runs, requestTracklets[i].color);
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
