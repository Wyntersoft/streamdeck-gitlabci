import streamDeck from "@elgato/streamdeck";

import { BranchStatusAction } from "./actions/branch-status";
import { RunnerHealthAction } from "./actions/runner-health";
import { RunnerStatusAction } from "./actions/runner-status";
import { watchGlobalSettings } from "./global-settings";
import { runnerHub } from "./runner-hub";

// Tokens pass through settings messages, so keep logging above "trace" to avoid writing them to disk.
streamDeck.logger.setLevel("info");

const runnerStatus = new RunnerStatusAction();
const runnerHealth = new RunnerHealthAction();
const actions = [new BranchStatusAction(), runnerStatus, runnerHealth];
for (const action of actions) streamDeck.actions.registerAction(action);

// Every runner key and dial redraws from each new runner snapshot together, so they never disagree.
runnerHub.onUpdate(() => {
	runnerStatus.resync();
	runnerHealth.resync();
});

const refreshAll = () => actions.forEach((action) => action.refreshAll());
watchGlobalSettings(refreshAll);
streamDeck.system.onSystemDidWakeUp(refreshAll);

streamDeck.connect();
