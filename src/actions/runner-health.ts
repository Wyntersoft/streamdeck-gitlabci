import { action } from "@elgato/streamdeck";

import { resolveConnection } from "../connection";
import { fetchQueuedJobs, fetchRunnerJobs, listRunners, type Runner, sortRunners, summarizeRunners } from "../gitlab";
import { step } from "../targets";
import { type PollResult, type PollSettings, PollingAction, type Watch } from "./polling-action";

export type HealthSettings = PollSettings & {
	/** Runner a dial has been turned to; blank for the overview. */
	dialRunnerId?: string;
};

/**
 * Overall runner health: how many runners are online, how many are building, and how many jobs are queued.
 *
 * On a dial the overview is the first position, and turning steps through each runner's status. The runner list is
 * re-read on every poll, so runners that are added or removed appear and disappear by themselves.
 */
@action({ UUID: "com.wyntersoft.gitlabci.health" })
export class RunnerHealthAction extends PollingAction<HealthSettings, true> {
	/** Latest sorted runner list per dial, used to step through runners between polls. */
	readonly #runnerLists = new Map<string, Runner[]>();

	protected override label(watch: Watch<HealthSettings, true>): string {
		const id = this.#selected(watch);
		if (id) return this.#runnerLists.get(watch.action.id)?.find((r) => String(r.id) === id)?.name ?? `Runner #${id}`;
		return watch.settings.label?.trim() || "Runners";
	}

	protected override async poll(watch: Watch<HealthSettings, true>): Promise<PollResult<true>> {
		const conn = await resolveConnection(watch.settings);
		const id = this.#selected(watch);
		const runners = sortRunners(await listRunners(conn));
		this.#runnerLists.set(watch.action.id, runners);
		const total = runners.length + 1;

		const index = id ? runners.findIndex((r) => String(r.id) === id) : -1;
		const runner = runners[index];
		if (runner) {
			const jobs = await fetchRunnerJobs(conn, String(runner.id));
			return { view: { kind: "runner", label: runner.name, runner, jobs }, data: true, position: `${index + 2}/${total}`, fast: jobs.length > 0 };
		}

		// The overview; also shown when the selected runner has been removed.
		const fleet = summarizeRunners(runners, await fetchQueuedJobs(conn));
		return {
			view: { kind: "health", label: watch.settings.label?.trim() || "Runners", fleet },
			data: true,
			position: watch.action.isDial() && runners.length > 0 ? `1/${total}` : undefined,
			fast: fleet.busy > 0 || !!fleet.queued,
		};
	}

	protected override async rotate(watch: Watch<HealthSettings, true>, ticks: number): Promise<boolean> {
		let runners = this.#runnerLists.get(watch.action.id);
		if (!runners) {
			runners = sortRunners(await listRunners(await resolveConnection(watch.settings)));
			this.#runnerLists.set(watch.action.id, runners);
		}
		if (runners.length === 0) return false;

		// Positions: 0 = overview, 1..n = runners.
		const id = this.#selected(watch);
		const current = id ? runners.findIndex((r) => String(r.id) === id) + 1 : 0;
		const next = step(current, ticks, runners.length + 1);
		watch.settings.dialRunnerId = next === 0 ? "" : String(runners[next - 1].id);
		await this.saveSettings(watch);
		return true;
	}

	/** The runner a dial is turned to, if any; keys always show the overview. */
	#selected(watch: Watch<HealthSettings, true>): string | undefined {
		return (watch.action.isDial() && watch.settings.dialRunnerId?.trim()) || undefined;
	}
}
