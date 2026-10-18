import streamDeck, { action, type SendToPluginEvent } from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { resolveConnection } from "../connection";
import { fetchRunner, fetchRunnerJobs, listRunners, type Runner, sortRunners } from "../gitlab";
import { errorLabel, type PollResult, type PollSettings, PollingAction, type Watch } from "./polling-action";

export type RunnerSettings = PollSettings & {
	/** Numeric runner ID, chosen from the property inspector's dropdown. */
	runnerId?: string;
};

/**
 * Key showing whether a runner is idle or what it's building. Presses do nothing. On dials, runners are part of the
 * Runner Health action instead.
 */
@action({ UUID: "com.wyntersoft.gitlabci.runner" })
export class RunnerStatusAction extends PollingAction<RunnerSettings, Runner> {
	protected override label(watch: Watch<RunnerSettings, Runner>): string {
		const id = watch.settings.runnerId;
		return watch.settings.label?.trim() || watch.data?.name || (id ? `Runner #${id}` : "Runner");
	}

	protected override async poll(watch: Watch<RunnerSettings, Runner>): Promise<PollResult<Runner>> {
		const runnerId = watch.settings.runnerId?.trim();
		if (!runnerId) return { view: { kind: "setup", title: "Runner" } };

		const conn = await resolveConnection(watch.settings);
		const [runner, jobs] = await Promise.all([fetchRunner(conn, runnerId), fetchRunnerJobs(conn, runnerId)]);
		return {
			view: { kind: "runner", label: watch.settings.label?.trim() || runner.name, runner, jobs },
			data: runner,
			fast: jobs.length > 0,
		};
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
