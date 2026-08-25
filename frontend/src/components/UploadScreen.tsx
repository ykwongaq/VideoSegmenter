import { useRef, useState } from "react";
import styles from "./UploadScreen.module.css";

interface UploadScreenProps {
	onFile: (file: File) => void;
}

export function UploadScreen({ onFile }: UploadScreenProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [dragOver, setDragOver] = useState(false);

	return (
		<div className={styles.wrap}>
			<div
				role="button"
				tabIndex={0}
				className={`${styles.dropzone} ${dragOver ? styles.dragOver : ""}`}
				onClick={() => inputRef.current?.click()}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === " ")
						inputRef.current?.click();
				}}
				onDragOver={(event) => {
					event.preventDefault();
					setDragOver(true);
				}}
				onDragLeave={() => setDragOver(false)}
				onDrop={(event) => {
					event.preventDefault();
					setDragOver(false);
					const file = event.dataTransfer.files?.[0];
					if (file) onFile(file);
				}}
			>
				<h1 className={styles.title}>Video Segmentation Reviewer</h1>
				<p className={styles.subtitle}>
					Verify tracklet masks and taxonomic labels
				</p>
				<p className={styles.hint}>
					Drop a project <code>.zip</code> archive here, or click to browse.
				</p>
				<p className={styles.detail}>
					The archive should contain a <code>frames/</code> folder and an
					annotation JSON under <code>annotations/</code>.
				</p>
				<input
					ref={inputRef}
					type="file"
					accept=".zip,application/zip"
					className={styles.input}
					onChange={(event) => {
						const file = event.target.files?.[0];
						if (file) onFile(file);
					}}
				/>
			</div>
		</div>
	);
}
