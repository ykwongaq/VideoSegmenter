/** Format a frame index as an `m:ss.cc` timecode at the clip's frame rate. */
export function formatTimecode(frame: number, fps: number): string {
	const seconds = frame / fps;
	const minutes = Math.floor(seconds / 60);
	const wholeSeconds = Math.floor(seconds % 60);
	const centiseconds = Math.round((seconds - Math.floor(seconds)) * 100);
	return `${minutes}:${String(wholeSeconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

/** Trigger a client-side download of a text payload. */
export function downloadText(
	filename: string,
	text: string,
	mime: string,
): void {
	const blob = new Blob([text], { type: mime });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}
