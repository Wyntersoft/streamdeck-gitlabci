import streamDeck, { action, type SendToPluginEvent } from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { resolveConnection } from "../connection";
import { fetchRunner, fetchRunnerJobs, listRunners, sortRunners } from "../gitlab";
import { runnerHub } from "../runner-hub";
import { errorLabel, type PollResult, type PollSettings, PollingAction, type Watch } from "./polling-action";

export type RunnerSettings = PollSettings & {
	/** Numeric runner ID, chosen from the property inspector's dropdown. */
	runnerId?: string;
};

/**
 * Key showing whether a runner is idle or what it's building. Presses do nothing. Reads the shared runner snapshot so
 * it always agrees with Runner Health. On dials, runners are part of the Runner Health action instead.
 */
@action({ UUID: "com.wyntersoft.gitlabci.runner" })
export class RunnerStatusAction extends PollingAction<RunnerSettings, string> {
	protected override label(watch: Watch<RunnerSettings, string>): string {
		const id = watch.settings.runnerId;
		return watch.settings.label?.trim() || watch.data || (id ? `Runner #${id}` : "Runner");
	}

	protected override async poll(watch: Watch<RunnerSettings, string>): Promise<PollResult<string>> {
		const runnerId = watch.settings.runnerId?.trim();
		if (!runnerId) return { view: { kind: "setup", title: "Runner" } };

		const conn = await resolveConnection(watch.settings);
		const snapshot = await runnerHub.get(conn);
		// Poll as fast as Runner Health does, so keys and the summary stay in step.
		const fast = snapshot.runners.some((r) => r.busy) || !!snapshot.queued;

		let runner = snapshot.runners.find((r) => String(r.id) === runnerId);
		let jobs = snapshot.jobs[Number(runnerId)] ?? [];
		if (!runner) {
			// A runner the token can reach directly but that isn't in its runner list.
			[runner, jobs] = await Promise.all([fetchRunner(conn, runnerId), fetchRunnerJobs(conn, runnerId)]);
		}
		const label = watch.settings.label?.trim() || runner.name;
		return { view: { kind: "runner", label, runner, jobs }, data: runner.name, fast };
	}

	/** Supplies the runner dropdown in the property inspector (sdpi-components `datasource`). */
	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, RunnerSettings>): Promise<void> {
		const payload = ev.payload as { event?: string } | null;
		if (payload?.event !== "getRunners") return;

		let items: { label: string; value: string; disabled?: boolean }[];
		try {
			const conn = await resolveConnection(await ev.action.getSettings());
			items = sortRunners(await listRunners(conn)).map((r) => ({ label: `${r.name} (#${r.id}, ${r.type.replace("_type", "")})`, value: String(r.id) }));
			if (items.length === 0) items = [{ label: "No runners visible to this token", value: "", disabled: true }];
		} catch (err) {
			streamDeck.logger.warn(`Listing runners failed: ${(err as Error).message}`);
			items = [{ label: `Can't list runners: ${errorLabel(err)}`, value: "", disabled: true }];
		}
		await streamDeck.ui.sendToPropertyInspector({ event: "getRunners", items });
	}
}
