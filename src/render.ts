/**
 * Renders 144x144 key images as SVG data URLs.
 */
import type { Pipeline, PipelineStatus, Runner, RunnerFleet, RunnerJob } from "./gitlab.ts";

export type KeyView =
	| { kind: "setup"; title: string }
	| { kind: "loading"; label: string }
	| { kind: "error"; label: string; message: string }
	/** Shown the moment a press starts a request, until GitLab answers. */
	| { kind: "working"; label: string; message: string; frame?: number }
	/** Brief feedback for a press that has nothing to do. */
	| { kind: "notice"; label: string; message: string }
	| { kind: "pipeline"; label: string; pipeline: Pipeline; frame?: number }
	| { kind: "runner"; label: string; runner: Runner; jobs: RunnerJob[] }
	| { kind: "health"; label: string; fleet: RunnerFleet };

type Glyph = "check" | "warning" | "cross" | "spinner" | "clock" | "cancel" | "skip" | "play" | "pause" | "question" | "alert" | "gear" | "idle" | "info";

type Colors = { background: string; foreground: string };
type Style = Colors & { glyph: Glyph };

const WHITE = "#FFFFFF";
const INK = "#0B1F26";

const GREEN: Colors = { background: "#108548", foreground: WHITE };
const RED: Colors = { background: "#C91C00", foreground: WHITE };
const YELLOW: Colors = { background: "#F2C200", foreground: INK };
const CYAN: Colors = { background: "#00BCD4", foreground: INK };
const PURPLE: Colors = { background: "#6E49CB", foreground: WHITE };
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

/** Green when passed, yellow when passed with warnings, red when failed, cyan while building, purple while a job waits for a runner. */
export function pipelineStyle(p: Pipeline): Style {
	if (p.status === "success" && p.warnings) return { ...YELLOW, glyph: "warning" };
	if (p.queue?.count && p.status !== "canceling") return { ...PURPLE, glyph: "clock" };
	return PIPELINE_STYLES[p.status] ?? { ...DARK, glyph: "question" };
}

/** Layout-independent description of what a key or dial shows. */
type Card = {
	colors: Colors;
	title: string;
	footer: string;
	body: { type: "glyph"; glyph: Glyph; frame?: number } | { type: "lines"; lines: [string, string] } | { type: "rows"; rows: [string, string][] };
};

function card(view: KeyView, now: Date): Card {
	const glyph = (colors: Colors, title: string, g: Glyph, footer: string, frame?: number): Card => ({ colors, title, footer, body: { type: "glyph", glyph: g, frame } });
	switch (view.kind) {
		case "setup":
			return glyph(DARK, view.title, "gear", "Configure");
		case "working":
			return glyph(CYAN, view.label, "spinner", view.message, view.frame);
		case "notice":
			return glyph(DARK, view.label, "info", view.message);
		case "loading":
			return glyph(DARK, view.label, "spinner", "Loading…");
		case "error":
			return glyph({ background: "#5C1A1A", foreground: WHITE }, view.label, "alert", view.message);
		case "pipeline": {
			const style = pipelineStyle(view.pipeline);
			return glyph(style, view.label, style.glyph, `${view.pipeline.ref} · ${timeLabel(view.pipeline, now)}`, view.frame);
		}
		case "runner":
			return runnerCard(view, now);
		case "health": {
			const { fleet } = view;
			return {
				colors: healthColors(fleet),
				title: view.label,
				footer: "",
				body: {
					type: "rows",
					rows: [
						[`${fleet.online}/${fleet.total}`, "online"],
						[`${fleet.busy}`, "building"],
						[fleet.queued === undefined ? "?" : `${fleet.queued}`, "queued"],
					],
				},
			};
		}
	}
}

/** Red with no runners online, yellow when jobs are queued, cyan while building, green when idle. */
export function healthColors(fleet: RunnerFleet): Colors {
	if (fleet.online === 0) return RED;
	if (fleet.queued) return YELLOW;
	if (fleet.busy > 0) return CYAN;
	return GREEN;
}

function runnerCard(view: Extract<KeyView, { kind: "runner" }>, now: Date): Card {
	const { runner, jobs } = view;
	const glyph = (colors: Colors, g: Glyph, footer: string): Card => ({ colors, title: view.label, footer, body: { type: "glyph", glyph: g } });
	if (runner.paused) return glyph(GREY, "pause", "Paused");
	if (runner.status !== "online") return glyph(GREY, "cancel", runner.status === "stale" ? "Stale" : "Offline");
	if (jobs.length === 0) return glyph(DARK, "idle", "Idle");

	const [job] = jobs;
	const elapsed = job.startedAt ? formatDuration(now.getTime() - Date.parse(job.startedAt)) : "";
	const footer = [jobs.length > 1 ? `${jobs.length} jobs` : job.name, elapsed].filter(Boolean).join(" · ");
	return { colors: CYAN, title: view.label, footer, body: { type: "lines", lines: [job.project, job.ref] } };
}

/** Renders a 144x144 key image. */
export function renderKey(view: KeyView, now: Date = new Date()): string {
	const c = card(view, now);
	const fg = c.colors.foreground;
	let body: string;
	switch (c.body.type) {
		case "glyph":
			body = drawGlyph(c.body.glyph, fg, c.body.frame);
			break;
		case "lines":
			body = text(fit(c.body.lines[0], 11), 72, 72, 22, "bold", fg) + text(fit(c.body.lines[1], 14), 72, 99, 17, "normal", fg);
			break;
		case "rows":
			body = c.body.rows.map(([value, caption], i) => row(16, 64 + i * 32, value, caption, fg)).join("");
			break;
	}
	const svg = canvas(144, 144, c.colors, text(fit(c.title, 12), 72, 30, 20, "bold", fg) + body + text(fit(c.footer, 16), 72, 130, 16, "normal", fg));
	return `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
}

/**
 * Renders a 200x100 image for a dial's touch strip. `position` (e.g. "2/5") marks where the dial is in the list it
 * turns through.
 */
export function renderDial(view: KeyView, now: Date = new Date(), position?: string): string {
	const c = card(view, now);
	const fg = c.colors.foreground;
	let body: string;
	switch (c.body.type) {
		case "glyph":
			// Glyphs are drawn for a 144px key centred on (72, 74); shrink and move them to the left half.
			body =
				`<g transform="translate(${50 - 72 * 0.8} ${52 - 74 * 0.8}) scale(0.8)">${drawGlyph(c.body.glyph, fg, c.body.frame)}</g>` +
				text(fit(c.title, 9), 100, 36, 19, "bold", fg, "start") +
				// The right column is narrow, so "ref · time" goes on two lines.
				c.footer
					.split(" · ")
					.slice(0, 2)
					.map((part, i) => text(fit(part, 14), 100, 62 + i * 22, 14, "normal", fg, "start"))
					.join("");
			break;
		case "lines":
			body =
				text(fit(c.title, 16), 100, 22, 15, "bold", fg) +
				text(fit(c.body.lines[0], 15), 100, 50, 21, "bold", fg) +
				text(fit(c.body.lines[1], 22), 100, 72, 15, "normal", fg) +
				text(fit(c.footer, 24), 100, 93, 14, "normal", fg);
			break;
		case "rows":
			body =
				text(fit(c.title, 16), 100, 22, 15, "bold", fg) +
				c.body.rows.map(([value, caption], i) => text(value, 36 + i * 64, 62, 26, "bold", fg) + text(caption, 36 + i * 64, 86, 14, "normal", fg)).join("");
			break;
	}
	if (position) body += `<text x="194" y="15" font-family="${FONT}" font-size="12" fill="${fg}" fill-opacity="0.75" text-anchor="end">${escapeXml(position)}</text>`;
	return `data:image/svg+xml;base64,${Buffer.from(canvas(200, 100, c.colors, body)).toString("base64")}`;
}

function canvas(width: number, height: number, colors: Colors, body: string): string {
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
		`<rect width="${width}" height="${height}" fill="${colors.background}"/>${body}</svg>`
	);
}

function row(x: number, y: number, value: string, caption: string, color: string): string {
	return (
		`<text x="${x}" y="${y}" font-family="${FONT}" font-size="24" font-weight="bold" fill="${color}">${escapeXml(value)}` +
		`<tspan font-size="17" font-weight="normal" dx="6">${escapeXml(caption)}</tspan></text>`
	);
}

/** Elapsed time for running pipelines, time since completion otherwise. */
export function timeLabel(p: Pipeline, now: Date): string {
	if (p.status === "canceling") return "canceling";
	if (p.queue?.count) return `queued ${formatDuration(p.queue.seconds * 1000)}`;
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

function text(value: string, x: number, y: number, size: number, weight: string, color: string, anchor: "middle" | "start" = "middle"): string {
	return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${escapeXml(value)}</text>`;
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
		case "info":
			return `${ring}<circle cx="72" cy="60" r="4.5" fill="${color}"/><path d="M72 72 L72 90" ${line(8)}/>`;
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
