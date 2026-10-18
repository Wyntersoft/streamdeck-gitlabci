import streamDeck from "@elgato/streamdeck";

import { BranchStatusAction } from "./actions/branch-status";
import { RunnerHealthAction } from "./actions/runner-health";
import { RunnerStatusAction } from "./actions/runner-status";
import { watchGlobalSettings } from "./global-settings";

// Tokens pass through settings messages, so keep logging above "trace" to avoid writing them to disk.
streamDeck.logger.setLevel("info");

const actions = [new BranchStatusAction(), new RunnerStatusAction(), new RunnerHealthAction()];
for (const action of actions) streamDeck.actions.registerAction(action);

const refreshAll = () => actions.forEach((action) => action.refreshAll());
watchGlobalSettings(refreshAll);
streamDeck.system.onSystemDidWakeUp(refreshAll);

streamDeck.connect();
