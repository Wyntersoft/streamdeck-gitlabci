/**
 * Renders 144x144 key images as SVG data URLs.
 */
import type { Pipeline, PipelineStatus, Runner, RunnerFleet, RunnerJob } from "./gitlab.ts";

export type KeyView =
	| { kind: "setup"; title: string }
	| { kind: "loading"; label: string }
	| { kind: "error"; label: string; message: string }
	| { kind: "pipeline"; label: string; pipeline: Pipeline; frame?: number }
	| { kind: "runner"; label: string; runner: Runner; jobs: RunnerJob[] }
	| { kind: "health"; label: string; fleet: RunnerFleet };

type Glyph = "check" | "warning" | "cross" | "spinner" | "clock" | "cancel" | "skip" | "play" | "pause" | "question" | "alert" | "gear" | "idle";

type Colors = { background: string; foreground: string };
type Style = Colors & { glyph: Glyph };

const WHITE = "#FFFFFF";
const INK = "#0B1F26";

const GREEN: Colors = { background: "#108548", foreground: WHITE };
const RED: Colors = { background: "#C91C00", foreground: WHITE };
const YELLOW: Colors = { background: "#F2C200", foreground: INK };
const CYAN: Colors = { background: "#00BCD4", foreground: INK };
const GREY: Colors = { background: "#535158", foreground: WHITE };
const DARK: Colors = { background: "#2B2B2B", foreground: WHITE };

const PIPELINE_STYLES: Record<PipelineStatus, Style> = {
	success: { ...GREEN, glyph: "check" },
	failed: { ...RED, glyph: "cross" },
	running: { ...CYAN, glyph: "spinner" },
	pending: { ...CYAN, glyph: "clock" },
	created: { ...CYAN, glyph: "clock" },
	preparing: { ...CYAN, glyph: "clock" },
	waiting_for_resource: { ...CYAN, glyph: "clock" },
	canceling: { ...GREY, glyph: "spinner" },
	scheduled: { ...GREY, glyph: "clock" },
	canceled: { ...GREY, glyph: "cancel" },
	skipped: { ...GREY, glyph: "skip" },
	manual: { ...GREY, glyph: "play" },
};

const FONT = "Segoe UI, Helvetica Neue, Helvetica, Arial, sans-serif";

/** Green when passed, yellow when passed with warnings, red when failed, cyan while building. */
export function pipelineStyle(p: Pipeline): Style {
	if (p.status === "success" && p.warnings) return { ...YELLOW, glyph: "warning" };
	return PIPELINE_STYLES[p.status] ?? { ...DARK, glyph: "question" };
}

export function renderKey(view: KeyView, now: Date = new Date()): string {
	switch (view.kind) {
		case "setup":
			return compose(DARK, view.title, drawGlyph("gear", WHITE), "Configure");
		case "loading":
			return compose(DARK, view.label, drawGlyph("spinner", WHITE), "Loading…");
		case "error":
			return compose({ background: "#5C1A1A", foreground: WHITE }, view.label, drawGlyph("alert", WHITE), view.message);
		case "pipeline": {
			const style = pipelineStyle(view.pipeline);
			return compose(style, view.label, drawGlyph(style.glyph, style.foreground, view.frame), `${view.pipeline.ref} · ${timeLabel(view.pipeline, now)}`);
		}
		case "runner":
			return renderRunner(view, now);
		case "health":
			return renderHealth(view);
	}
}

/** Red with no runners online, yellow when jobs are queued, cyan while building, green when idle. */
export function healthColors(fleet: RunnerFleet): Colors {
	if (fleet.online === 0) return RED;
	if (fleet.queued) return YELLOW;
	if (fleet.busy > 0) return CYAN;
	return GREEN;
}

function renderHealth(view: Extract<KeyView, { kind: "health" }>): string {
	const { fleet } = view;
	const colors = healthColors(fleet);
	const row = (y: number, value: string, caption: string) =>
		`<text x="16" y="${y}" font-family="${FONT}" font-size="24" font-weight="bold" fill="${colors.foreground}">${escapeXml(value)}` +
		`<tspan font-size="17" font-weight="normal" dx="6">${escapeXml(caption)}</tspan></text>`;
	const middle =
		row(64, `${fleet.online}/${fleet.total}`, "online") + row(96, `${fleet.busy}`, "building") + row(128, fleet.queued === undefined ? "?" : `${fleet.queued}`, "queued");
	return compose(colors, view.label, middle, "");
}

function renderRunner(view: Extract<KeyView, { kind: "runner" }>, now: Date): string {
	const { runner, jobs } = view;
	if (runner.paused) return compose(GREY, view.label, drawGlyph("pause", WHITE), "Paused");
	if (runner.status !== "online") return compose(GREY, view.label, drawGlyph("cancel", WHITE), runner.status === "stale" ? "Stale" : "Offline");
	if (jobs.length === 0) return compose(DARK, view.label, drawGlyph("idle", WHITE), "Idle");

	const [job] = jobs;
	const elapsed = job.startedAt ? formatDuration(now.getTime() - Date.parse(job.startedAt)) : "";
	const bottom = jobs.length > 1 ? [`${jobs.length} jobs`, elapsed].filter(Boolean).join(" · ") : [job.name, elapsed].filter(Boolean).join(" · ");
	const middle = text(fit(job.project, 11), 72, 22, "bold", CYAN.foreground) + text(fit(job.ref, 14), 99, 17, "normal", CYAN.foreground);
	return compose(CYAN, view.label, middle, bottom);
}

function compose(colors: Colors, top: string, middle: string, bottom: string): string {
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">` +
		`<rect width="144" height="144" fill="${colors.background}"/>` +
		text(fit(top, 12), 30, 20, "bold", colors.foreground) +
		middle +
		text(fit(bottom, 16), 130, 16, "normal", colors.foreground) +
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

function text(value: string, y: number, size: number, weight: string, color: string): string {
	return `<text x="72" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="middle">${escapeXml(value)}</text>`;
}

function escapeXml(value: string): string {
	return value.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Draws a status glyph centred at (72, 74), roughly 60px across. */
function drawGlyph(glyph: Glyph, color: string, frame = 0): string {
	const line = (width: number, opacity = 1) =>
		`fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`;
	const ring = `<circle cx="72" cy="74" r="30" ${line(7)}/>`;
	const triangle = `<path d="M72 44 L104 100 L40 100 Z" ${line(7)}/><path d="M72 62 L72 80" ${line(7)}/><circle cx="72" cy="91" r="4" fill="${color}"/>`;
	switch (glyph) {
		case "check":
			return `<path d="M50 75 L65 90 L95 58" ${line(9)}/>`;
		case "warning":
		case "alert":
			return triangle;
		case "cross":
			return `<path d="M52 54 L92 94 M92 54 L52 94" ${line(9)}/>`;
		case "spinner":
			return `<circle cx="72" cy="74" r="28" ${line(8, 0.3)}/><path d="M72 46 A28 28 0 0 1 100 74" ${line(8)} transform="rotate(${(frame % 8) * 45} 72 74)"/>`;
		case "clock":
			return `${ring}<path d="M72 56 L72 75 L84 84" ${line(7)}/>`;
		case "cancel":
			return `${ring}<path d="M51 95 L93 53" ${line(7)}/>`;
		case "skip":
			return `<path d="M46 52 L70 74 L46 96 Z M72 52 L96 74 L72 96 Z" fill="${color}"/>`;
		case "play":
			return `${ring}<path d="M64 60 L88 74 L64 88 Z" fill="${color}"/>`;
		case "pause":
			return `${ring}<path d="M63 60 L63 88 M81 60 L81 88" ${line(8)}/>`;
		case "idle":
			return `<circle cx="72" cy="74" r="30" ${line(7, 0.45)}/><path d="M58 74 L86 74" ${line(7, 0.45)}/>`;
		case "gear":
			return (
				`<circle cx="72" cy="74" r="16" ${line(8)}/>` +
				Array.from({ length: 8 }, (_, i) => `<rect x="67" y="44" width="10" height="12" rx="2" fill="${color}" transform="rotate(${i * 45} 72 74)"/>`).join("")
			);
		case "question":
			return `<text x="72" y="96" font-family="${FONT}" font-size="64" font-weight="bold" fill="${color}" text-anchor="middle">?</text>`;
	}
}
