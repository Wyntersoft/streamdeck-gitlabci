import streamDeck, { action, type SendToPluginEvent } from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { resolveConnection } from "../connection";
import { fetchRunner, fetchRunnerJobs, listRunners, type Runner } from "../gitlab";
import { step } from "../targets";
import { errorLabel, type PollResult, type PollSettings, PollingAction, type Watch } from "./polling-action";

export type RunnerSettings = PollSettings & {
	/** Numeric runner ID, chosen from the property inspector's dropdown or by turning a dial. */
	runnerId?: string;
};

/** How long a dial's runner list is reused before being fetched again. */
const RUNNER_LIST_TTL_MS = 5 * 60_000;

/**
 * Shows whether a runner is idle or what it's building. On a dial, rotating turns through the runners the token can
 * see. Presses do nothing.
 */
@action({ UUID: "com.wyntersoft.gitlabci.runner" })
export class RunnerStatusAction extends PollingAction<RunnerSettings, Runner> {
	readonly #runnerLists = new Map<string, { runners: Runner[]; fetchedAt: number }>();

	protected override label(watch: Watch<RunnerSettings, Runner>): string {
		// Dials turn away from the configured runner, so a custom label would be wrong there.
		const custom = watch.action.isDial() ? undefined : watch.settings.label?.trim();
		const id = watch.settings.runnerId;
		const known = watch.data?.id === Number(id) ? watch.data : this.#runnerLists.get(watch.action.id)?.runners.find((r) => String(r.id) === id);
		return custom || known?.name || (id ? `Runner #${id}` : "Runner");
	}

	protected override async poll(watch: Watch<RunnerSettings, Runner>): Promise<PollResult<Runner>> {
		const runnerId = watch.settings.runnerId?.trim();
		if (!runnerId) {
			// A dial can start from the first runner instead of needing the dropdown.
			if (!watch.action.isDial() || !(await this.rotate(watch, 0))) return { view: { kind: "setup", title: "Runner" } };
			return this.poll(watch);
		}

		const conn = await resolveConnection(watch.settings);
		const [runner, jobs] = await Promise.all([fetchRunner(conn, runnerId), fetchRunnerJobs(conn, runnerId)]);
		let position: string | undefined;
		if (watch.action.isDial()) {
			const runners = await this.#runners(watch).catch(() => []);
			const index = runners.findIndex((r) => r.id === runner.id);
			if (runners.length > 1 && index >= 0) position = `${index + 1}/${runners.length}`;
		}
		return {
			view: { kind: "runner", label: (!watch.action.isDial() && watch.settings.label?.trim()) || runner.name, runner, jobs },
			data: runner,
			position,
			fast: jobs.length > 0,
		};
	}

	protected override async rotate(watch: Watch<RunnerSettings, Runner>, ticks: number): Promise<boolean> {
		let runners: Runner[];
		try {
			runners = await this.#runners(watch);
		} catch (err) {
			streamDeck.logger.warn(`Listing runners failed: ${(err as Error).message}`);
			return false;
		}
		if (runners.length === 0) return false;

		const current = runners.findIndex((r) => String(r.id) === watch.settings.runnerId);
		const next = runners[step(Math.max(current, 0), current < 0 ? 0 : ticks, runners.length)];
		if (String(next.id) === watch.settings.runnerId) return false;
		watch.settings.runnerId = String(next.id);
		await this.saveSettings(watch);
		return true;
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

	override onDidReceiveSettings(ev: Parameters<PollingAction<RunnerSettings, Runner>["onDidReceiveSettings"]>[0]): void {
		this.#runnerLists.delete(ev.action.id);
		super.onDidReceiveSettings(ev);
	}

	async #runners(watch: Watch<RunnerSettings, Runner>): Promise<Runner[]> {
		const cached = this.#runnerLists.get(watch.action.id);
		if (cached && Date.now() - cached.fetchedAt < RUNNER_LIST_TTL_MS) return cached.runners;
		const runners = sortRunners(await listRunners(await resolveConnection(watch.settings)));
		this.#runnerLists.set(watch.action.id, { runners, fetchedAt: Date.now() });
		return runners;
	}
}

function sortRunners(runners: Runner[]): Runner[] {
	return [...runners].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
}
