import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Clip } from "../lib/clip";
import type { ZipArchive } from "../lib/zip";
import type { LabelVerdict, MaskVerdict } from "../types";
import { ReviewStore } from "../lib/review";
import { downloadText } from "../lib/format";
import { VideoPanel } from "./VideoPanel";
import { TrackletList } from "./TrackletList";
import { Inspector } from "./Inspector";
import styles from "./Workspace.module.css";

interface WorkspaceProps {
	clip: Clip;
	zip: ZipArchive;
	onReset: () => void;
}

export function Workspace({ clip, zip, onReset }: WorkspaceProps) {
	const [frameIndex, setFrameIndex] = useState(0);
	const [playing, setPlaying] = useState(false);
	const [selectedId, setSelectedId] = useState<number | null>(
		clip.tracklets[0]?.id ?? null,
	);
	const [showAllMasks, setShowAllMasks] = useState(false);
	const [maskOpacity, setMaskOpacity] = useState(0.55);
	const [tick, setTick] = useState(0);

	const storeRef = useRef<ReviewStore | null>(null);
	let store = storeRef.current;
	if (!store) {
		store = ReviewStore.load(clip.name);
		storeRef.current = store;
	}

	const refresh = useCallback(() => setTick((value) => value + 1), []);

	const selected = useMemo(
		() => clip.tracklets.find((tracklet) => tracklet.id === selectedId) ?? null,
		[clip.tracklets, selectedId],
	);

	const counts = useMemo(
		() => store.counts(clip.tracklets),
		[clip.tracklets, store, tick],
	);
	const missingFrames = useMemo(() => clip.missingFrames(zip), [clip, zip]);

	const stepFrame = useCallback(
		(delta: number) =>
			setFrameIndex((index) =>
				Math.min(clip.frameCount - 1, Math.max(0, index + delta)),
			),
		[clip.frameCount],
	);

	const togglePlay = useCallback(() => setPlaying((value) => !value), []);

	const selectTracklet = useCallback(
		(id: number) => {
			setSelectedId(id);
			const tracklet = clip.tracklets.find((candidate) => candidate.id === id);
			if (tracklet && tracklet.maskFrames.first >= 0) {
				setFrameIndex(tracklet.maskFrames.first);
			}
		},
		[clip.tracklets],
	);

	const setLabelVerdict = useCallback(
		(verdict: LabelVerdict) => {
			if (selectedId === null) return;
			store.update(selectedId, { labelVerdict: verdict });
			refresh();
		},
		[selectedId, store, refresh],
	);

	const setMaskVerdict = useCallback(
		(verdict: MaskVerdict) => {
			if (selectedId === null) return;
			store.update(selectedId, { maskVerdict: verdict });
			refresh();
		},
		[selectedId, store, refresh],
	);

	const setCorrectedLabel = useCallback(
		(text: string) => {
			if (selectedId === null) return;
			store.update(selectedId, { correctedLabel: text });
			refresh();
		},
		[selectedId, store, refresh],
	);

	const setComment = useCallback(
		(text: string) => {
			if (selectedId === null) return;
			store.update(selectedId, { comment: text });
			refresh();
		},
		[selectedId, store, refresh],
	);

	const nextUnverified = useCallback(() => {
		const tracklets = clip.tracklets;
		const total = tracklets.length;
		if (total === 0) return;
		const start = tracklets.findIndex((tracklet) => tracklet.id === selectedId);
		for (let k = 1; k <= total; k++) {
			const tracklet = tracklets[(start + k) % total];
			const review = store.get(tracklet.id);
			if (!review.labelVerdict || !review.maskVerdict) {
				setSelectedId(tracklet.id);
				if (tracklet.maskFrames.first >= 0)
					setFrameIndex(tracklet.maskFrames.first);
				return;
			}
		}
	}, [clip.tracklets, selectedId, store]);

	// Frame-accurate playback loop driven by the clip's fps.
	useEffect(() => {
		if (!playing) return;
		let raf = 0;
		let last = performance.now();
		let accumulator = 0;
		const fps = clip.fps;
		const count = clip.frameCount;

		const step = (now: number) => {
			const elapsed = (now - last) / 1000;
			last = now;
			accumulator += elapsed * fps;
			if (accumulator >= 1) {
				const advance = Math.min(Math.floor(accumulator), count);
				accumulator -= Math.floor(accumulator);
				setFrameIndex((index) => (index + advance) % count);
			}
			raf = requestAnimationFrame(step);
		};

		raf = requestAnimationFrame(step);
		return () => cancelAnimationFrame(raf);
	}, [playing, clip.fps, clip.frameCount]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
				return;

			switch (event.key) {
				case " ":
					event.preventDefault();
					setPlaying((value) => !value);
					break;
				case "ArrowLeft":
					event.preventDefault();
					stepFrame(-1);
					break;
				case "ArrowRight":
					event.preventDefault();
					stepFrame(1);
					break;
				case "1":
					setLabelVerdict("correct");
					break;
				case "2":
					setLabelVerdict("incorrect");
					break;
				case "3":
					setMaskVerdict("good");
					break;
				case "4":
					setMaskVerdict("bad");
					break;
				case "n":
					nextUnverified();
					break;
				case "x":
					setShowAllMasks((value) => !value);
					break;
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [stepFrame, setLabelVerdict, setMaskVerdict, nextUnverified]);

	const handleExport = useCallback(() => {
		const payload = ReviewStore.buildExport(clip, store.getRecord());
		downloadText(
			`${clip.name}.review.json`,
			JSON.stringify(payload, null, 2),
			"application/json",
		);
		downloadText(`${clip.name}.review.csv`, payload.csv, "text/csv");
	}, [clip, store]);

	return (
		<div className={styles.workspace}>
			<header className={styles.header}>
				<div>
					<h1 className={styles.title}>{clip.name}</h1>
					<div className={styles.meta}>
						<span>{clip.frameCount} frames</span>
						<span>{clip.fps} fps</span>
						<span>
							{clip.width}×{clip.height}
						</span>
						<span>{clip.tracklets.length} tracklets</span>
						{missingFrames.length > 0 && (
							<span className={styles.warning}>
								{missingFrames.length} frame(s) missing from archive
							</span>
						)}
					</div>
				</div>

				<div className={styles.spacer} />

				<div className={styles.progress}>
					<span className={styles.progressText}>
						{counts.verified} / {counts.total} verified
					</span>
					<div className={styles.progressTrack}>
						<div
							className={styles.progressFill}
							style={{
								width: counts.total
									? `${Math.round((counts.verified / counts.total) * 100)}%`
									: "0%",
							}}
						/>
					</div>
				</div>

				<button type="button" className="btn btnPrimary" onClick={handleExport}>
					Export
				</button>
				<button type="button" className="btn" onClick={onReset}>
					Open another
				</button>
			</header>

			<div className={styles.body}>
				<section className={styles.videoCol}>
					<VideoPanel
						clip={clip}
						zip={zip}
						frameIndex={frameIndex}
						playing={playing}
						selectedTrackletId={selectedId}
						showAllMasks={showAllMasks}
						maskOpacity={maskOpacity}
						onFrameChange={setFrameIndex}
						onPlayToggle={togglePlay}
						onStep={stepFrame}
						onShowAllMasksChange={setShowAllMasks}
						onMaskOpacityChange={setMaskOpacity}
					/>
				</section>

				<aside className={styles.sidebar}>
					<TrackletList
						clip={clip}
						selectedId={selectedId}
						reviews={store.getRecord()}
						onSelect={selectTracklet}
					/>
					<Inspector
						tracklet={selected}
						review={selectedId !== null ? store.get(selectedId) : null}
						onLabelVerdict={setLabelVerdict}
						onMaskVerdict={setMaskVerdict}
						onCorrectedLabel={setCorrectedLabel}
						onComment={setComment}
					/>
				</aside>
			</div>
		</div>
	);
}
