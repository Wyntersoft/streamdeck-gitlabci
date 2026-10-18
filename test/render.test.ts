import assert from "node:assert/strict";
import { test } from "node:test";

import { fit, formatDuration, renderKey, timeLabel } from "../src/render.ts";

const now = new Date("2026-01-01T12:00:00Z");
const base = { id: 1, ref: "main", sha: "x", webUrl: "u" };

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
	const svg = decodeURIComponent(url.split(",")[1]);
	assert.match(svg, /#C91C00/);
	assert.match(svg, /&#60;p&#38;q&#62;/);
	assert.match(svg, /main · 1h ago/);
	for (const kind of ["setup", "loading", "error"] as const) {
		assert.match(renderKey({ kind, label: "x", message: "m" } as never), /^data:image\/svg/);
	}
});

test("rendered SVG elements never repeat an attribute", () => {
	const statuses = ["success", "failed", "running", "pending", "canceled", "skipped", "manual", "scheduled"] as const;
	const views = [
		...statuses.map((status) => ({ kind: "pipeline" as const, label: "p", pipeline: { ...base, status } })),
		{ kind: "setup" as const },
		{ kind: "loading" as const, label: "p" },
		{ kind: "error" as const, label: "p", message: "m" },
	];
	for (const view of views) {
		const svg = decodeURIComponent(renderKey(view, now).split(",")[1]);
		for (const tag of svg.match(/<[a-z]+\s[^>]*>/g) ?? []) {
			const names = [...tag.matchAll(/\s([a-z-]+)=/g)].map((m) => m[1]);
			assert.equal(new Set(names).size, names.length, `duplicate attribute in ${tag}`);
		}
	}
});
