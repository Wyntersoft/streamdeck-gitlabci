import { action } from "@elgato/streamdeck";

import { resolveConnection } from "../connection";
import { fetchRunnerFleet } from "../gitlab";
import { type PollResult, type PollSettings, PollingAction, type Watch } from "./polling-action";

export type HealthSettings = PollSettings;

/**
 * Overall runner health: how many runners are online, how many are building, and how many jobs are queued.
 * Display only; key presses do nothing.
 */
@action({ UUID: "com.wyntersoft.gitlabci.health" })
export class RunnerHealthAction extends PollingAction<HealthSettings, true> {
	protected override label(settings: HealthSettings): string {
		return settings.label?.trim() || "Runners";
	}

	protected override async poll(watch: Watch<HealthSettings, true>): Promise<PollResult<true>> {
		const fleet = await fetchRunnerFleet(await resolveConnection(watch.settings));
		return {
			view: { kind: "health", label: this.label(watch.settings), fleet },
			data: true,
			fast: fleet.busy > 0 || !!fleet.queued,
		};
	}
}
