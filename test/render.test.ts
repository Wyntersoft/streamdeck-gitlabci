import assert from "node:assert/strict";
import { test } from "node:test";

import { fit, formatDuration, healthColors, type KeyView, pipelineStyle, renderDial, renderKey, timeLabel } from "../src/render.ts";

const now = new Date("2026-01-01T12:00:00Z");
const base = { id: 1, ref: "main", sha: "x", webUrl: "u", warnings: false };
const runner = { id: 9, name: "r1", status: "online", paused: false, busy: false, type: "instance_type" };
const svg = (view: KeyView) => decodeURIComponent(renderKey(view, now).split(",")[1]);
const dialSvg = (view: KeyView, position?: string) => Buffer.from(renderDial(view, now, position).split(",")[1], "base64").toString("utf8");

test("formatDuration", () => {
	assert.equal(formatDuration(-5), "0s");
	assert.equal(formatDuration(42_000), "42s");
	assert.equal(formatDuration(5 * 60_000), "5m");
	assert.equal(formatDuration(3 * 3_600_000), "3h");
	assert.equal(formatDuration(72 * 3_600_000), "3d");
});

test("timeLabel shows elapsed for running and age otherwise", () => {
	assert.equal(timeLabel({ ...base, status: "running", startedAt: "2026-01-01T11:58:00Z" }, now), "2m");
	assert.equal(timeLabel({ ...base, status: "success", finishedAt: "2026-01-01T09:00:00Z" }, now), "3h ago");
	assert.equal(timeLabel({ ...base, status: "manual" }, now), "manual");
});

test("fit truncates long text", () => {
	assert.equal(fit("short", 10), "short");
	assert.equal(fit("a-very-long-project-name", 10), "a-very-lo…");
});

test("renderKey produces escaped SVG data URLs", () => {
	const url = renderKey({ kind: "pipeline", label: "<p&q>", pipeline: { ...base, status: "failed", finishedAt: "2026-01-01T11:00:00Z" } }, now);
	assert.match(url, /^data:image\/svg\+xml;charset=utf8,/);
	const out = decodeURIComponent(url.split(",")[1]);
	assert.match(out, /#C91C00/);
	assert.match(out, /&#60;p&#38;q&#62;/);
	assert.match(out, /main · 1h ago/);
});

test("branch colours follow the spec", () => {
	assert.equal(pipelineStyle({ ...base, status: "success" }).background, "#108548");
	assert.equal(pipelineStyle({ ...base, status: "success", warnings: true }).background, "#F2C200");
	assert.equal(pipelineStyle({ ...base, status: "failed" }).background, "#C91C00");
	assert.equal(pipelineStyle({ ...base, status: "running" }).background, "#00BCD4");
	assert.equal(pipelineStyle({ ...base, status: "pending" }).background, "#00BCD4");
});

test("runner keys show idle or the running job", () => {
	assert.match(svg({ kind: "runner", label: "r1", runner, jobs: [] }), /Idle/);
	assert.match(svg({ kind: "runner", label: "r1", runner: { ...runner, status: "offline" }, jobs: [] }), /Offline/);
	assert.match(svg({ kind: "runner", label: "r1", runner: { ...runner, paused: true }, jobs: [] }), /Paused/);
	const job = { id: 1, name: "compile", stage: "build", ref: "feature/x", project: "api", startedAt: "2026-01-01T11:55:00Z", webUrl: "u" };
	const busy = svg({ kind: "runner", label: "r1", runner, jobs: [job] });
	assert.match(busy, />api</);
	assert.match(busy, /feature\/x/);
	assert.match(busy, /compile · 5m/);
	assert.match(svg({ kind: "runner", label: "r1", runner, jobs: [job, job] }), /2 jobs · 5m/);
});

test("health key colours and counts", () => {
	assert.equal(healthColors({ total: 2, online: 0, busy: 0, queued: 0 }).background, "#C91C00");
	assert.equal(healthColors({ total: 2, online: 2, busy: 2, queued: 4 }).background, "#F2C200");
	assert.equal(healthColors({ total: 2, online: 2, busy: 1, queued: 0 }).background, "#00BCD4");
	assert.equal(healthColors({ total: 2, online: 2, busy: 0 }).background, "#108548");
	const out = svg({ kind: "health", label: "Runners", fleet: { total: 5, online: 4, busy: 3 } });
	assert.match(out, /4\/5<tspan[^>]*>online/);
	assert.match(out, /\?<tspan[^>]*>queued/);
});

test("rendered SVG elements never repeat an attribute", () => {
	const statuses = ["success", "failed", "running", "pending", "canceled", "skipped", "manual", "scheduled"] as const;
	const views: KeyView[] = [
		...statuses.map((status) => ({ kind: "pipeline" as const, label: "p", pipeline: { ...base, status } })),
		{ kind: "pipeline", label: "p", pipeline: { ...base, status: "success", warnings: true } },
		{ kind: "setup", title: "p" },
		{ kind: "loading", label: "p" },
		{ kind: "error", label: "p", message: "m" },
		{ kind: "working", label: "p", message: "Retrying…", frame: 3 },
		{ kind: "notice", label: "p", message: "No failed jobs" },
		{ kind: "runner", label: "p", runner, jobs: [] },
		{ kind: "runner", label: "p", runner: { ...runner, paused: true }, jobs: [] },
		{ kind: "health", label: "p", fleet: { total: 3, online: 2, busy: 1, queued: 0 } },
	];
	for (const view of views) {
		for (const tag of [svg(view), dialSvg(view, "1/2")].join("").match(/<[a-z]+\s[^>]*>/g) ?? []) {
			const names = [...tag.matchAll(/\s([a-z-]+)=/g)].map((m) => m[1]);
			assert.equal(new Set(names).size, names.length, `duplicate attribute in ${tag}`);
		}
	}
});

test("dial images are 200x100 and show the list position", () => {
	const out = dialSvg({ kind: "pipeline", label: "api", pipeline: { ...base, status: "success", finishedAt: "2026-01-01T11:00:00Z" } }, "2/5");
	assert.match(renderDial({ kind: "setup", title: "x" }), /^data:image\/svg\+xml;base64,/);
	assert.match(out, /width="200" height="100"/);
	assert.match(out, />2\/5</);
	assert.match(out, />main<\/text>.*>1h ago</);
	assert.doesNotMatch(dialSvg({ kind: "setup", title: "x" }), /\d\/\d/);
	const health = dialSvg({ kind: "health", label: "Runners", fleet: { total: 5, online: 4, busy: 3, queued: 2 } });
	for (const caption of ["online", "building", "queued"]) assert.match(health, new RegExp(`>${caption}<`));
});
