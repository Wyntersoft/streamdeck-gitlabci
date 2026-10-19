import { action } from "@elgato/streamdeck";

import { resolveConnection } from "../connection";
import { type Runner, summarizeRunners } from "../gitlab";
import { runnerHub } from "../runner-hub";
import { step } from "../targets";
import { type PollResult, type PollSettings, PollingAction, type Watch } from "./polling-action";

export type HealthSettings = PollSettings & {
	/** Runner a dial has been turned to; blank for the overview. */
	dialRunnerId?: string;
};

/**
 * Overall runner health: how many runners are online, how many are building, and how many jobs are queued.
 *
 * On a dial the overview is the first position, and turning steps through each runner's status. Everything comes
 * from the shared runner snapshot, so added or removed runners appear by themselves and every runner key agrees.
 */
@action({ UUID: "com.wyntersoft.gitlabci.health" })
export class RunnerHealthAction extends PollingAction<HealthSettings, Runner[]> {
	protected override label(watch: Watch<HealthSettings, Runner[]>): string {
		const id = this.#selected(watch);
		if (id) return watch.data?.find((r) => String(r.id) === id)?.name ?? `Runner #${id}`;
		return watch.settings.label?.trim() || "Runners";
	}

	protected override async poll(watch: Watch<HealthSettings, Runner[]>): Promise<PollResult<Runner[]>> {
		const snapshot = await runnerHub.get(await resolveConnection(watch.settings));
		const { runners } = snapshot;
		const fast = runners.some((r) => r.busy) || !!snapshot.queued;
		const total = runners.length + 1;

		const id = this.#selected(watch);
		const index = id ? runners.findIndex((r) => String(r.id) === id) : -1;
		const runner = runners[index];
		if (runner) {
			const jobs = snapshot.jobs[runner.id] ?? [];
			return { view: { kind: "runner", label: runner.name, runner, jobs }, data: runners, position: `${index + 2}/${total}`, fast };
		}

		// The overview; also shown when the selected runner has been removed.
		return {
			view: { kind: "health", label: watch.settings.label?.trim() || "Runners", fleet: summarizeRunners(runners, snapshot.queued) },
			data: runners,
			position: watch.action.isDial() && runners.length > 0 ? `1/${total}` : undefined,
			fast,
		};
	}

	protected override async rotate(watch: Watch<HealthSettings, Runner[]>, ticks: number): Promise<boolean> {
		const { runners } = await runnerHub.get(await resolveConnection(watch.settings));
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
	#selected(watch: Watch<HealthSettings, Runner[]>): string | undefined {
		return (watch.action.isDial() && watch.settings.dialRunnerId?.trim()) || undefined;
	}
}
