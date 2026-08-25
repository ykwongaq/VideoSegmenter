import type { ForegroundRun } from "../types";

/**
 * Renders decoded RLE masks onto an offscreen canvas at full frame resolution.
 * Foreground runs are drawn as 1px-wide vertical strips, which mirrors the
 * column-major encoding and avoids materialising the full bitmap.
 */
export class MaskRenderer {
	private readonly canvas: HTMLCanvasElement;
	private readonly ctx: CanvasRenderingContext2D;

	constructor(width: number, height: number) {
		this.canvas = document.createElement("canvas");
		this.canvas.width = width;
		this.canvas.height = height;
		const ctx = this.canvas.getContext("2d");
		if (!ctx) throw new Error("2D canvas context is unavailable.");
		this.ctx = ctx;
	}

	get canvasElement(): HTMLCanvasElement {
		return this.canvas;
	}

	clear(): void {
		this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
	}

	drawRuns(runs: ForegroundRun[], color: string): void {
		this.ctx.fillStyle = color;
		for (const run of runs) {
			this.ctx.fillRect(run.x, run.y, 1, run.length);
		}
	}
}
