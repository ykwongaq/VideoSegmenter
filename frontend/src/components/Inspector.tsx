import type { ReactNode } from "react";
import type {
	MaskVerdict,
	TaxonomyKey,
	Tracklet,
	TrackletReview,
} from "../types";
import styles from "./Inspector.module.css";

const TAXONOMY_FIELDS: {
	key: TaxonomyKey;
	label: string;
	placeholder: string;
}[] = [
	{ key: "kingdom", label: "Kingdom", placeholder: "Animalia" },
	{ key: "phylum", label: "Phylum", placeholder: "Chordata" },
	{ key: "class", label: "Class", placeholder: "Mammalia" },
	{ key: "order", label: "Order", placeholder: "Primates" },
	{ key: "family", label: "Family", placeholder: "Atelidae" },
	{ key: "genus", label: "Genus", placeholder: "Ateles" },
	{ key: "species", label: "Species", placeholder: "Ateles geoffroyi" },
	{
		key: "commonName",
		label: "Common name",
		placeholder: "Geoffroy's Spider Monkey",
	},
];

interface InspectorProps {
	tracklet: Tracklet | null;
	review: TrackletReview | null;
	onTaxonomyField: (key: TaxonomyKey, value: string) => void;
	onConfirmLabel: () => void;
	onMaskVerdict: (verdict: MaskVerdict) => void;
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

	const taxonomy = review?.taxonomy ?? tracklet.taxonomy;
	const labelConfirmed = review?.labelConfirmed ?? false;
	const maskVerdict = review?.maskVerdict ?? null;
	const comment = review?.comment ?? "";

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
				<div className={styles.taxoList}>
					{TAXONOMY_FIELDS.map(({ key, label, placeholder }) => (
						<label key={key} className={styles.taxoRow}>
							<span className={styles.taxoLabel}>{label}</span>
							<input
								className={styles.field}
								value={taxonomy[key]}
								placeholder={placeholder}
								onChange={(event) =>
									props.onTaxonomyField(key, event.target.value)
								}
							/>
						</label>
					))}
				</div>
				<div className={styles.confirmRow}>
					<button
						type="button"
						className={`btn btnPrimary ${styles.confirmBtn}`}
						onClick={props.onConfirmLabel}
					>
						{labelConfirmed ? "Label confirmed" : "Confirm label"}
					</button>
					{labelConfirmed && (
						<span className={styles.confirmedBadge}>✓ confirmed</span>
					)}
				</div>
			</section>

			<section>
				<h3 className={styles.sectionTitle}>Mask quality</h3>
				<div className={styles.verdictGroup}>
					<VerdictButton
						active={maskVerdict === "good"}
						kind="good"
						onClick={() => props.onMaskVerdict("good")}
					>
						Accurate
					</VerdictButton>
					<VerdictButton
						active={maskVerdict === "bad"}
						kind="bad"
						onClick={() => props.onMaskVerdict("bad")}
					>
						Inaccurate
					</VerdictButton>
					<VerdictButton
						active={maskVerdict === "unsure"}
						kind="warn"
						onClick={() => props.onMaskVerdict("unsure")}
					>
						Unsure
					</VerdictButton>
				</div>
				<textarea
					className={`${styles.field} ${styles.comment}`}
					placeholder="Optional note (e.g. mask drifts after frame 40)…"
					value={comment}
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
