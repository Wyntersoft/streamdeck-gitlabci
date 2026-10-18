/**
 * Renders 144x144 key images as SVG data URLs.
 */
import type { Pipeline, PipelineStatus } from "./gitlab.ts";

export type KeyView =
	| { kind: "setup" }
	| { kind: "loading"; label: string }
	| { kind: "error"; label: string; message: string }
	| { kind: "pipeline"; label: string; pipeline: Pipeline; frame?: number };

type Glyph = "check" | "cross" | "spinner" | "clock" | "cancel" | "skip" | "play" | "question" | "alert" | "gear";

type Style = { background: string; glyph: Glyph };

const STYLES: Record<PipelineStatus, Style> = {
	success: { background: "#108548", glyph: "check" },
	failed: { background: "#C91C00", glyph: "cross" },
	running: { background: "#1F75CB", glyph: "spinner" },
	canceling: { background: "#535158", glyph: "spinner" },
	pending: { background: "#AB6100", glyph: "clock" },
	created: { background: "#AB6100", glyph: "clock" },
	preparing: { background: "#AB6100", glyph: "clock" },
	waiting_for_resource: { background: "#AB6100", glyph: "clock" },
	scheduled: { background: "#535158", glyph: "clock" },
	canceled: { background: "#535158", glyph: "cancel" },
	skipped: { background: "#535158", glyph: "skip" },
	manual: { background: "#535158", glyph: "play" },
};

const FONT = "Segoe UI, Helvetica Neue, Helvetica, Arial, sans-serif";

export function renderKey(view: KeyView, now: Date = new Date()): string {
	let background: string;
	let glyph: string;
	let top: string;
	let bottom: string;

	switch (view.kind) {
		case "setup":
			background = "#2B2B2B";
			glyph = drawGlyph("gear");
			top = "GitLab CI";
			bottom = "Configure";
			break;
		case "loading":
			background = "#2B2B2B";
			glyph = drawGlyph("spinner");
			top = view.label;
			bottom = "Loading…";
			break;
		case "error":
			background = "#5C1A1A";
			glyph = drawGlyph("alert");
			top = view.label;
			bottom = view.message;
			break;
		case "pipeline": {
			const style = STYLES[view.pipeline.status] ?? { background: "#2B2B2B", glyph: "question" };
			background = style.background;
			glyph = drawGlyph(style.glyph, view.frame);
			top = view.label;
			bottom = `${view.pipeline.ref} · ${timeLabel(view.pipeline, now)}`;
			break;
		}
	}

	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">` +
		`<rect width="144" height="144" fill="${background}"/>` +
		text(fit(top, 12), 30, 20, "bold") +
		glyph +
		text(fit(bottom, 16), 130, 16, "normal") +
		`</svg>`;
	return `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
}

/** Elapsed time for running pipelines, time since completion otherwise. */
export function timeLabel(p: Pipeline, now: Date): string {
	if (p.status === "running" && p.startedAt) return formatDuration(now.getTime() - Date.parse(p.startedAt));
	const at = p.finishedAt ?? p.updatedAt ?? p.createdAt;
	return at ? `${formatDuration(now.getTime() - Date.parse(at))} ago` : p.status;
}

export function formatDuration(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	if (h < 48) return `${h}h`;
	return `${Math.floor(h / 24)}d`;
}

/** Truncates text with an ellipsis so it fits on the key. */
export function fit(value: string, max: number): string {
	return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function text(value: string, y: number, size: number, weight: string): string {
	return `<text x="72" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="#FFFFFF" text-anchor="middle">${escapeXml(value)}</text>`;
}

function escapeXml(value: string): string {
	return value.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Draws a status glyph centred at (72, 74), roughly 60px across. */
function drawGlyph(glyph: Glyph, frame = 0): string {
	const stroke = `fill="none" stroke="#FFFFFF" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"`;
	const ring = `<circle cx="72" cy="74" r="30" fill="none" stroke="#FFFFFF" stroke-width="7"/>`;
	switch (glyph) {
		case "check":
			return `<path d="M50 75 L65 90 L95 58" ${stroke}/>`;
		case "cross":
			return `<path d="M52 54 L92 94 M92 54 L52 94" ${stroke}/>`;
		case "spinner":
			return (
				`<circle cx="72" cy="74" r="28" fill="none" stroke="#FFFFFF" stroke-opacity="0.3" stroke-width="8"/>` +
				`<path d="M72 46 A28 28 0 0 1 100 74" fill="none" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round" transform="rotate(${(frame % 8) * 45} 72 74)"/>`
			);
		case "clock":
			return `${ring}<path d="M72 56 L72 75 L84 84" fill="none" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
		case "cancel":
			return `${ring}<path d="M51 95 L93 53" fill="none" stroke="#FFFFFF" stroke-width="7"/>`;
		case "skip":
			return `<path d="M46 52 L70 74 L46 96 Z M72 52 L96 74 L72 96 Z" fill="#FFFFFF"/>`;
		case "play":
			return `${ring}<path d="M64 60 L88 74 L64 88 Z" fill="#FFFFFF"/>`;
		case "alert":
			return `<path d="M72 44 L104 100 L40 100 Z" fill="none" stroke="#FFFFFF" stroke-width="7" stroke-linejoin="round"/><path d="M72 62 L72 80" fill="none" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round"/><circle cx="72" cy="91" r="4" fill="#FFFFFF"/>`;
		case "gear":
			return (
				`<circle cx="72" cy="74" r="16" fill="none" stroke="#FFFFFF" stroke-width="8"/>` +
				Array.from({ length: 8 }, (_, i) => `<rect x="67" y="44" width="10" height="12" rx="2" fill="#FFFFFF" transform="rotate(${i * 45} 72 74)"/>`).join("")
			);
		case "question":
			return `<text x="72" y="96" font-family="${FONT}" font-size="64" font-weight="bold" fill="#FFFFFF" text-anchor="middle">?</text>`;
	}
}
