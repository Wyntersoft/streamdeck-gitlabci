import assert from "node:assert/strict";
import { test } from "node:test";

import type { RunnerSnapshot } from "../src/gitlab.ts";
import { RunnerHub } from "../src/runner-hub.ts";

const snapshot = (queued: number): RunnerSnapshot => ({ runners: [], jobs: {}, queued });
const conn = { baseUrl: "https://gl.test", token: "t" };
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("concurrent and fresh requests share one fetch", async () => {
	let fetches = 0;
	let now = 0;
	const hub = new RunnerHub(async () => snapshot(++fetches), () => now);

	const [a, b] = await Promise.all([hub.get(conn), hub.get(conn)]);
	assert.equal(fetches, 1);
	assert.equal(a, b);

	now = 2000;
	assert.equal((await hub.get(conn)).queued, 1);
	now = 3500;
	assert.equal((await hub.get(conn)).queued, 2);
});

test("each new snapshot notifies listeners once", async () => {
	let now = 0;
	const hub = new RunnerHub(async () => snapshot(0), () => now);
	let updates = 0;
	hub.onUpdate(() => updates++);

	await hub.get(conn);
	await hub.get(conn);
	await tick();
	assert.equal(updates, 1);

	now = 5000;
	await hub.get(conn);
	await tick();
	assert.equal(updates, 2);
});

test("separate connections get separate snapshots", async () => {
	let fetches = 0;
	const hub = new RunnerHub(async () => snapshot(++fetches));
	await hub.get(conn);
	await hub.get({ ...conn, token: "other" });
	assert.equal(fetches, 2);
});

test("reloadSoon refetches every known connection after the delay", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	let fetches = 0;
	const hub = new RunnerHub(async () => snapshot(++fetches), () => 0);
	await hub.get(conn);
	hub.reloadSoon(5000);
	t.mock.timers.tick(4999);
	assert.equal(fetches, 1);
	t.mock.timers.tick(1);
	assert.equal(fetches, 2);
});
