# streamdeck-gitlabci

A Stream Deck plugin for watching GitLab CI. Works with gitlab.com and self-hosted GitLab.
Every action works on keys and on Stream Deck + dials (touch strip).

## Actions

### Branch Status
Shows the latest pipeline for a project's branch (default branch if none is given):

| Colour | Meaning |
| --- | --- |
| Green | Passed |
| Yellow | Passed with warnings (an `allow_failure` job failed) |
| Red | Failed |
| Cyan | Building (running or queued) |
| Grey | Canceled, skipped, manual or scheduled |

- **Tap** retries a failed or canceled pipeline.
- **Hold** (0.6 s) cancels a running pipeline.

On a dial, **push** = tap, **hold the push** = hold, and **touch / long-touch** on the strip do the same.
**Turning** the dial switches what it shows, set under *Dial* in its settings:

- **switches branch** turns through the listed branches (one per line), or, if the list is blank,
  the project's 20 most recently updated branches.
- **switches project** turns through the listed projects (`group/project` or `group/project@branch`).

The configured project/branch is always the first entry; the strip shows the position (e.g. `2/5`).

Retry and cancel can be turned off with the checkboxes in the settings. They need a token with `api` scope;
with a `read_api` token the key is view-only.

### Runner Status
Pick a runner from the dropdown. The key shows **Idle**, **Paused**, **Offline/Stale**, or, while busy,
the project, ref and job it's running (with elapsed time). Turning a dial switches between all the
runners the token can see. Presses do nothing.

### Runner Health
Summarises every runner the token can see: runners online, runners building, and jobs queued
waiting for a runner. Red when no runner is online, yellow when jobs are queued, cyan while building,
green when idle. Queue depth needs an administrator token (shows `?` otherwise). Display only.

## Requirements

- Stream Deck 7.1+
- A GitLab personal access token: `read_api` to view, `api` to retry/cancel. Runner keys need
  access to the runners (administrator for instance runners).

## Setup

Set **GitLab URL** and **Access token** once in any key's settings; they're shared by all keys.
Each key can override both, e.g. to mix gitlab.com and a self-hosted instance. Branch keys also
accept a pasted project URL.

Keys poll every minute by default and every 10 seconds while something is building. GitLab has no
public push API that suits a desktop plugin (webhooks need a reachable endpoint; its GraphQL
subscriptions are per-job and meant for the web UI), so the plugin polls.

## Development

Requires Node.js 24+.

```sh
npm install
npx streamdeck link com.wyntersoft.gitlabci.sdPlugin   # link into Stream Deck (once)
npm run watch      # rebuild and restart the plugin on change
npm test           # unit tests
npm run typecheck
npm run pack       # validate and produce dist/com.wyntersoft.gitlabci.streamDeckPlugin
npm run icons      # regenerate the PNG icons in imgs/
```

| Path | Purpose |
| --- | --- |
| `src/gitlab.ts` | GitLab REST/GraphQL client |
| `src/render.ts` | Renders key (144×144) and dial (200×100) images as SVG |
| `src/targets.ts` | Which project/branch a branch key or dial shows |
| `src/actions/polling-action.ts` | Shared polling, animation, tap/hold and dial rotation |
| `src/actions/branch-status.ts` | Branch key: status, tap to retry, hold to cancel |
| `src/actions/runner-status.ts` | Runner key and its runner dropdown |
| `src/actions/runner-health.ts` | Runner health key |
| `com.wyntersoft.gitlabci.sdPlugin/` | Manifest, property inspector, images |

CI runs the tests and attaches the packaged `.streamDeckPlugin` to each pipeline.
