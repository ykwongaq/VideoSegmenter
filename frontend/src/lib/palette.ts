/** Muted, colour-blind-friendly palette used to colour tracklets. */
const PALETTE = [
	"#1f77b4",
	"#d62728",
	"#2ca02c",
	"#9467bd",
	"#ff7f0e",
	"#8c564b",
	"#e377c2",
	"#7f7f7f",
	"#bcbd22",
	"#17becf",
	"#aec7e8",
	"#ffbb78",
	"#98df8a",
	"#ff9896",
	"#c5b0d5",
	"#c49c94",
	"#f7b6d2",
	"#dbdb8d",
	"#9edae5",
	"#393b79",
	"#637939",
	"#8c6d31",
	"#843c39",
	"#7b4173",
];

export function colorForIndex(index: number): string {
	return PALETTE[((index % PALETTE.length) + PALETTE.length) % PALETTE.length];
}
