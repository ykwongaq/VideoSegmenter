import { useCallback, useState } from "react";
import { Clip } from "./lib/clip";
import { ZipArchive } from "./lib/zip";
import { UploadScreen } from "./components/UploadScreen";
import { Workspace } from "./components/Workspace";
import styles from "./App.module.css";

type Phase = "upload" | "loading" | "ready" | "error";

function App() {
	const [phase, setPhase] = useState<Phase>("upload");
	const [clip, setClip] = useState<Clip | null>(null);
	const [zip, setZip] = useState<ZipArchive | null>(null);
	const [error, setError] = useState<string | null>(null);

	const handleFile = useCallback(async (file: File) => {
		setPhase("loading");
		setError(null);
		try {
			const archive = await ZipArchive.fromFile(file);
			const parsed = await Clip.fromZip(archive);
			setZip(archive);
			setClip(parsed);
			setPhase("ready");
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
			setPhase("error");
		}
	}, []);

	const handleReset = useCallback(() => {
		setClip(null);
		setZip(null);
		setError(null);
		setPhase("upload");
	}, []);

	return (
		<div className={styles.app}>
			{phase === "upload" && <UploadScreen onFile={handleFile} />}

			{phase === "loading" && (
				<div className={styles.center}>
					<h1 className={styles.title}>Loading</h1>
					<p className={styles.subtitle}>Reading frames and annotations…</p>
				</div>
			)}

			{phase === "error" && (
				<div className={styles.center}>
					<h1 className={styles.title}>Could not open archive</h1>
					<p className={styles.error}>{error}</p>
					<button
						type="button"
						className="btn btnPrimary"
						onClick={handleReset}
					>
						Choose another file
					</button>
				</div>
			)}

			{phase === "ready" && clip !== null && zip !== null && (
				<Workspace
					key={clip.name}
					clip={clip}
					zip={zip}
					onReset={handleReset}
				/>
			)}
		</div>
	);
}

export default App;
