// Renders the Elgato Marketplace listing images into marketplace/. Run with `npm run marketplace`.
// Keys and dials are drawn by the plugin's own renderer (src/render.ts) from sample data, so the gallery shows exactly
// what the plugin draws.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import type { Pipeline, PipelineProgress, Runner, RunnerJob } from "../src/gitlab.ts";
import { type KeyView, renderDial, renderKey } from "../src/render.ts";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "marketplace");
const W = 1920;
const H = 960;
const FONT = "Segoe UI, Helvetica Neue, Helvetica, Arial, sans-serif";

// ---- Sample data ----------------------------------------------------------------------------------------------------

const NOW = new Date("2026-11-02T12:00:00Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const job = (name: string) => ({ name, stage: "build" });

function pipeline(status: Pipeline["status"], extra: Partial<Pipeline> = {}): Pipeline {
	return { id: 1, status, warnings: false, ref: "main", sha: "0", webUrl: "", finishedAt: ago(7), ...extra };
}
function building(running: string, done: number, total: number, extra: Partial<Pipeline> = {}): Pipeline {
	const progress: PipelineProgress = { running: [job(running)], pending: [], queuedSeconds: 0, done, total };
	return pipeline("running", { startedAt: ago(4), progress, ...extra });
}
function waiting(pending: string, extra: Partial<Pipeline> = {}): Pipeline {
	const progress: PipelineProgress = { running: [], pending: [job(pending)], queuedSeconds: 150, done: 2, total: 3 };
	return pipeline("running", { startedAt: ago(6), progress, ...extra });
}
const branch = (label: string, p: Pipeline): KeyView => ({ kind: "pipeline", label, pipeline: p });

const runner = (name: string, extra: Partial<Runner> = {}): Runner => ({ id: 1, name, status: "online", paused: false, busy: false, type: "instance_type", ...extra });
const runnerJob = (project: string, ref: string, name: string, minutes: number): RunnerJob => ({ id: 1, name, stage: "build", ref, project, startedAt: ago(minutes), webUrl: "" });
const runnerKey = (r: Runner, jobs: RunnerJob[] = []): KeyView => ({ kind: "runner", label: r.name, runner: r, jobs });
const health = (online: number, total: number, busy: number, queued: number): KeyView => ({ kind: "health", label: "Runners", fleet: { online, total, busy, queued } });

const KEYS = {
	passed: branch("api", pipeline("success", { finishedAt: ago(12) })),
	warnings: branch("docs", pipeline("success", { warnings: true, finishedAt: ago(45) })),
	failed: branch("mobile", pipeline("failed", { finishedAt: ago(3), ref: "release" })),
	building: branch("web-app", building("unit-tests", 1, 3)),
	queued: branch("infra", waiting("deploy")),
	retrying: { kind: "working", label: "mobile", message: "Retrying…", frame: 1 } as KeyView,
	canceling: { kind: "working", label: "web-app", message: "Canceling…", frame: 5 } as KeyView,
	canceled: branch("web-app", pipeline("canceled", { finishedAt: ago(0.2) })),
	rebuilding: branch("mobile", building("compile", 0, 4, { ref: "release", startedAt: ago(0.3) })),
	health: health(5, 6, 3, 1),
	runnerBusy: runnerKey(runner("runner-1", { busy: true }), [runnerJob("web-app", "main", "unit-tests", 4)]),
	runnerBusy2: runnerKey(runner("runner-2", { busy: true }), [runnerJob("mobile", "release", "compile", 1)]),
	runnerIdle: runnerKey(runner("runner-3")),
	runnerPaused: runnerKey(runner("runner-4", { paused: true, busy: true }), [runnerJob("api", "main", "integration", 9)]),
	runnerOffline: runnerKey(runner("runner-5", { status: "offline" })),
};

// ---- Drawing helpers ------------------------------------------------------------------------------------------------

type Layer = { input: Buffer; left: number; top: number };

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

function text(x: number, y: number, value: string, size: number, opts: { weight?: number; color?: string; anchor?: string; opacity?: number } = {}): string {
	const { weight = 400, color = "#FFFFFF", anchor = "start", opacity = 1 } = opts;
	return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${color}" fill-opacity="${opacity}" text-anchor="${anchor}">${esc(value)}</text>`;
}

/** Background with the brand gradient glow, plus any extra SVG (headlines, captions, arrows). */
function background(extra: string): Buffer {
	return Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
			<defs>
				<radialGradient id="glow" cx="0.78" cy="0.15" r="0.9">
					<stop offset="0" stop-color="#2E3F8F" stop-opacity="0.75"/>
					<stop offset="0.6" stop-color="#1B1B24" stop-opacity="0"/>
				</radialGradient>
			</defs>
			<rect width="${W}" height="${H}" fill="#141419"/>
			<rect width="${W}" height="${H}" fill="url(#glow)"/>
			${extra}
		</svg>`,
	);
}

const svgOf = (dataUrl: string) =>
	dataUrl.includes(";base64,") ? Buffer.from(dataUrl.split(",")[1], "base64") : Buffer.from(decodeURIComponent(dataUrl.split(",")[1]));

/** A key as it looks on a Stream Deck: the image with rounded corners inside a dark bezel. */
async function key(view: KeyView, size: number): Promise<Buffer> {
	const bezel = Math.round(size * 0.06);
	const inner = size - bezel * 2;
	const radius = Math.round(inner * 0.16);
	const image = await sharp(svgOf(renderKey(view, NOW)), { density: (72 * inner) / 144 })
		.resize(inner, inner)
		.composite([{ input: Buffer.from(`<svg width="${inner}" height="${inner}"><rect width="${inner}" height="${inner}" rx="${radius}" fill="#fff"/></svg>`), blend: "dest-in" }])
		.png()
		.toBuffer();
	const frame = Buffer.from(
		`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius + bezel}" fill="#2A2A30" stroke="#3A3A42" stroke-width="2"/></svg>`,
	);
	return sharp(frame).composite([{ input: image, left: bezel, top: bezel }]).png().toBuffer();
}

/** A Stream Deck + touch-strip segment, drawn at `scale` times its 200x100 size. */
async function dial(view: KeyView, position: string | undefined, scale: number): Promise<Buffer> {
	const w = 200 * scale;
	const h = 100 * scale;
	return sharp(svgOf(renderDial(view, NOW, position)), { density: 72 * scale })
		.resize(w, h)
		.composite([{ input: Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${10 * scale}" fill="#fff"/></svg>`), blend: "dest-in" }])
		.png()
		.toBuffer();
}

/** A grid of keys inside a device-like panel; returns the layers and the panel's SVG. */
async function deck(views: KeyView[], cols: number, size: number, gap: number, left: number, top: number): Promise<{ layers: Layer[]; panel: string }> {
	const rows = Math.ceil(views.length / cols);
	const pad = Math.round(size * 0.28);
	const pw = cols * size + (cols - 1) * gap + pad * 2;
	const ph = rows * size + (rows - 1) * gap + pad * 2;
	const panel = `<rect x="${left - pad}" y="${top - pad}" width="${pw}" height="${ph}" rx="${pad}" fill="#0C0C10" stroke="#2C2C34" stroke-width="3"/>`;
	const layers = await Promise.all(
		views.map(async (view, i) => ({ input: await key(view, size), left: left + (i % cols) * (size + gap), top: top + Math.floor(i / cols) * (size + gap) })),
	);
	return { layers, panel };
}

function headline(title: string, subtitle: string, x = 120, y = 210): string {
	return text(x, y, title, 76, { weight: 700 }) + text(x, y + 70, subtitle, 34, { opacity: 0.75 });
}

async function save(file: string, base: Buffer, layers: Layer[]): Promise<void> {
	await sharp(base).composite(layers).png().toFile(path.join(out, file));
	console.log(`marketplace/${file}`);
}

// ---- Images ---------------------------------------------------------------------------------------------------------

await mkdir(out, { recursive: true });

// App icon: the plugin icon at the marketplace's 288x288.
await sharp(path.join(root, "com.wyntersoft.gitlabci.sdPlugin/imgs/plugin/marketplace@2x.png")).resize(288, 288).png().toFile(path.join(out, "icon.png"));
console.log("marketplace/icon.png");

// 1. Overview, also used as the thumbnail.
{
	const views = [KEYS.passed, KEYS.building, KEYS.failed, KEYS.warnings, KEYS.queued, KEYS.health, KEYS.runnerBusy, KEYS.runnerIdle];
	const { layers, panel } = await deck(views, 4, 190, 26, 1000, 300);
	const copy =
		text(120, 300, "Pipeline Status", 92, { weight: 700 }) +
		text(120, 400, "for GitLab", 92, { weight: 700, color: "#8FB4FF" }) +
		text(120, 490, "Your pipelines and runners, live on Stream Deck.", 34, { opacity: 0.8 }) +
		text(120, 545, "Works with gitlab.com and self-hosted GitLab.", 34, { opacity: 0.6 });
	await save("thumbnail.png", background(copy + panel), layers);
	await save("gallery-1-overview.png", background(copy + panel), layers);
}

// 2. Colours.
{
	const items: [KeyView, string, string][] = [
		[KEYS.passed, "Passed", "#3BC17C"],
		[KEYS.warnings, "Passed with warnings", "#F2C200"],
		[KEYS.failed, "Failed", "#FF6B57"],
		[KEYS.building, "Building", "#33D6EA"],
		[KEYS.queued, "Waiting for a runner", "#A88BFF"],
	];
	const size = 250;
	const gap = 80;
	const left = (W - (items.length * size + (items.length - 1) * gap)) / 2;
	const top = 420;
	const layers = await Promise.all(items.map(async ([view], i) => ({ input: await key(view, size), left: left + i * (size + gap), top })));
	const captions = items.map(([, label, color], i) => text(left + i * (size + gap) + size / 2, top + size + 70, label, 30, { weight: 600, color, anchor: "middle" })).join("");
	const copy = text(W / 2, 200, "One glance tells you where every branch stands", 64, { weight: 700, anchor: "middle" }) +
		text(W / 2, 270, "Building keys show the running job and progress; queued ones show what's waiting and for how long.", 30, { opacity: 0.75, anchor: "middle" });
	await save("gallery-2-colours.png", background(copy + captions), layers);
}

// 3. Retry and cancel.
{
	const size = 230;
	const gap = 150;
	const rows: [KeyView[], string, number][] = [
		[[KEYS.failed, KEYS.retrying, KEYS.rebuilding], "Tap to retry a failed pipeline", 300],
		[[KEYS.building, KEYS.canceling, KEYS.canceled], "Hold to cancel a running one", 620],
	];
	const left = 820;
	const layers: Layer[] = [];
	let extra = text(120, 200, "Retry and cancel", 76, { weight: 700 }) +
		text(120, 270, "without leaving your game, editor or call.", 34, { opacity: 0.75 });
	for (const [views, caption, top] of rows) {
		extra += text(120, top + size / 2 + 12, caption, 40, { weight: 600 });
		for (const [i, view] of views.entries()) {
			const x = left + i * (size + gap);
			layers.push({ input: await key(view, size), left: x, top });
			if (i < views.length - 1) {
				const ax = x + size + 30;
				const ay = top + size / 2;
				extra += `<path d="M${ax} ${ay} H${ax + gap - 60} M${ax + gap - 80} ${ay - 18} L${ax + gap - 60} ${ay} L${ax + gap - 80} ${ay + 18}" fill="none" stroke="#8FB4FF" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
			}
		}
	}
	extra += text(120, 900, "Both can be switched off per key. Retry and cancel need a token with the api scope.", 26, { opacity: 0.55 });
	await save("gallery-3-retry-cancel.png", background(extra), layers);
}

// 4. Runners.
{
	const views = [KEYS.health, KEYS.runnerBusy, KEYS.runnerBusy2, KEYS.runnerIdle, KEYS.runnerPaused, KEYS.runnerOffline];
	const { layers, panel } = await deck(views, 3, 210, 28, 1060, 290);
	const copy =
		text(120, 300, "Every runner, in step", 76, { weight: 700 }) +
		text(120, 380, "See what each runner is building, which are idle,", 34, { opacity: 0.8 }) +
		text(120, 430, "paused or offline, and how deep the queue is.", 34, { opacity: 0.8 }) +
		text(120, 530, "All runner keys update together from one request,", 30, { opacity: 0.6 }) +
		text(120, 575, "so the summary and the runners always agree.", 30, { opacity: 0.6 });
	await save("gallery-4-runners.png", background(copy + panel), layers);
}

// 5. Dials.
{
	const scale = 2.6;
	const strips: [KeyView, string][] = [
		[branch("web-app", building("unit-tests", 1, 3, { ref: "feature/login" })), "2/5"],
		[KEYS.health, "1/7"],
		[runnerKey(runner("runner-1", { busy: true }), [runnerJob("web-app", "main", "unit-tests", 4)]), "2/7"],
	];
	const gap = 40;
	const left = Math.round((W - (strips.length * 200 * scale + (strips.length - 1) * gap)) / 2);
	const top = 380;
	const layers = await Promise.all(strips.map(async ([view, pos], i) => ({ input: await dial(view, pos, scale), left: left + i * (200 * scale + gap), top })));
	const captions = [
		"Turn to switch branch or project",
		"Runner health overview",
		"…then turn through each runner",
	]
		.map((c, i) => text(left + i * (200 * scale + gap) + 100 * scale, top + 100 * scale + 60, c, 32, { weight: 600, anchor: "middle" }))
		.join("");
	const knobs = strips
		.map((_, i) => `<circle cx="${left + i * (200 * scale + gap) + 100 * scale}" cy="${top + 100 * scale + 180}" r="60" fill="#1E1E24" stroke="#3A3A42" stroke-width="4"/>`)
		.join("");
	const copy = headline("Made for dials too", "On Stream Deck +, push or touch to retry, hold to cancel, and turn to browse.");
	await save("gallery-5-dials.png", background(copy + captions + knobs), layers);
}
