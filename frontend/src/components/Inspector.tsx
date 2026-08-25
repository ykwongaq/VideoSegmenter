import type { ReactNode } from "react";
import type {
	LabelVerdict,
	MaskVerdict,
	Tracklet,
	TrackletReview,
} from "../types";
import styles from "./Inspector.module.css";

interface InspectorProps {
	tracklet: Tracklet | null;
	review: TrackletReview | null;
	onLabelVerdict: (verdict: LabelVerdict) => void;
	onMaskVerdict: (verdict: MaskVerdict) => void;
	onCorrectedLabel: (text: string) => void;
	onComment: (text: string) => void;
}

export function Inspector(props: InspectorProps) {
	const { tracklet, review } = props;

	if (!tracklet) {
		return (
			<div className={styles.inspector}>
				<p className={styles.empty}>
					Select a tracklet to review its label and mask.
				</p>
			</div>
		);
	}

	const current = review ?? {
		labelVerdict: null,
		correctedLabel: "",
		maskVerdict: null,
		comment: "",
	};

	return (
		<div className={styles.inspector}>
			<div className={styles.heading}>
				<span
					className={styles.swatch}
					style={{ background: tracklet.color }}
				/>
				<div>
					<h2 className={styles.title}>Tracklet #{tracklet.id}</h2>
					<p className={styles.meta}>
						object {tracklet.objectId} · category {tracklet.categoryId} · frames{" "}
						{tracklet.maskFrames.first}–{tracklet.maskFrames.last}
					</p>
				</div>
			</div>

			<section>
				<h3 className={styles.sectionTitle}>Taxonomic label</h3>
				<p className={styles.labelText}>{tracklet.label}</p>
				<div className={styles.verdictGroup}>
					<VerdictButton
						active={current.labelVerdict === "correct"}
						kind="good"
						onClick={() => props.onLabelVerdict("correct")}
					>
						Correct
					</VerdictButton>
					<VerdictButton
						active={current.labelVerdict === "incorrect"}
						kind="bad"
						onClick={() => props.onLabelVerdict("incorrect")}
					>
						Incorrect
					</VerdictButton>
					<VerdictButton
						active={current.labelVerdict === "unsure"}
						kind="warn"
						onClick={() => props.onLabelVerdict("unsure")}
					>
						Unsure
					</VerdictButton>
				</div>
				{current.labelVerdict === "incorrect" && (
					<input
						className={styles.field}
						placeholder="Corrected taxonomic label…"
						value={current.correctedLabel}
						onChange={(event) => props.onCorrectedLabel(event.target.value)}
					/>
				)}
			</section>

			<section>
				<h3 className={styles.sectionTitle}>Mask quality</h3>
				<div className={styles.verdictGroup}>
					<VerdictButton
						active={current.maskVerdict === "good"}
						kind="good"
						onClick={() => props.onMaskVerdict("good")}
					>
						Accurate
					</VerdictButton>
					<VerdictButton
						active={current.maskVerdict === "bad"}
						kind="bad"
						onClick={() => props.onMaskVerdict("bad")}
					>
						Inaccurate
					</VerdictButton>
					<VerdictButton
						active={current.maskVerdict === "unsure"}
						kind="warn"
						onClick={() => props.onMaskVerdict("unsure")}
					>
						Unsure
					</VerdictButton>
				</div>
				<textarea
					className={`${styles.field} ${styles.comment}`}
					placeholder="Optional note (e.g. mask drifts after frame 40)…"
					value={current.comment}
					onChange={(event) => props.onComment(event.target.value)}
				/>
			</section>
		</div>
	);
}

interface VerdictButtonProps {
	active: boolean;
	kind: "good" | "bad" | "warn";
	onClick: () => void;
	children: ReactNode;
}

function VerdictButton({
	active,
	kind,
	onClick,
	children,
}: VerdictButtonProps) {
	const stateClass = active
		? kind === "good"
			? styles.activeGood
			: kind === "bad"
				? styles.activeBad
				: styles.activeWarn
		: "";
	return (
		<button
			type="button"
			className={`${styles.verdictBtn} ${stateClass}`}
			onClick={onClick}
		>
			{children}
		</button>
	);
}
