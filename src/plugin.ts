import streamDeck from "@elgato/streamdeck";

import { PipelineStatusAction } from "./actions/pipeline-status";
import { watchGlobalSettings } from "./global-settings";

// Tokens pass through settings messages, so keep logging above "trace" to avoid writing them to disk.
streamDeck.logger.setLevel("info");

const pipelineStatus = new PipelineStatusAction();
streamDeck.actions.registerAction(pipelineStatus);
watchGlobalSettings(() => pipelineStatus.refreshAll());
streamDeck.system.onSystemDidWakeUp(() => pipelineStatus.refreshAll());

streamDeck.connect();
