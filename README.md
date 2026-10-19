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

- **Tap** retries a failed, canceled, or passed-with-warnings pipeline (reruns its failed jobs).
- **Hold** (0.6 s) cancels a running pipeline.

A press shows **Retrying…** / **Canceling…** straight away and keeps showing it until GitLab reports the
pipeline restarted or stopped (checking every 2 s, for up to 30 s); if there is nothing to do it says so (e.g. **No failed jobs**, **Not running**). After a retry or cancel, runner keys refresh about 5 seconds later so they pick up the jobs.

On a dial, **push** = tap, **hold the push** = hold, and **touch / long-touch** on the strip do the same.
**Turning** the dial switches what it shows. Its settings only show the fields for the chosen mode:

- **Turn to switch: branches of a project**: set *Project*, and optionally list *Branches*
  (one per line). With the list blank it turns through the default branch followed by the 20 most
  recently updated branches.
- **Turn to switch: projects**: list *Projects*, one per line, as `group/project` or
  `group/project@branch` (default branch when no branch is given).

The strip shows the position (e.g. `2/5`), and the dial remembers where it was.

Retry and cancel can be turned off with the checkboxes in the settings. Both need a token with the
`api` scope (see [Creating a token](#creating-a-token)); with a `read_api` token the key only shows status
and a press shows **Needs api scope**.

### Runner Status (keys)
Pick a runner from the dropdown. The key shows **Idle**, **Paused**, **Offline/Stale**, or, while busy,
the project, ref and job it's running (with elapsed time). Presses do nothing. On dials, use
Runner Health, which includes every runner's status.

### Runner Health
Summarises every runner the token can see: runners online, runners building, and jobs queued
waiting for a runner. Red when no runner is online, yellow when jobs are queued, cyan while building,
green when idle. Queue depth needs an administrator token (shows `?` otherwise). Display only.

On a dial the overview is position 1, and **turning** steps through each runner's status (as on a
Runner Status key), then wraps back to the overview. The runner list is re-read on every poll, so
new or removed runners show up without any configuration.

## Requirements

- Stream Deck 7.1+
- A GitLab personal access token with the **`api`** scope (see below)

### Creating a token

1. In GitLab, open your avatar → **Edit profile** → **Access tokens** → **Add new token**.
2. Give it a name (e.g. *Stream Deck*) and an expiry date.
3. Tick the **`api`** scope. Nothing else is needed.
4. Create it, copy the token, and paste it into **Access token** in any key's settings. It's shared by
   every key and dial.

Why `api`: GitLab has no narrower scope that allows retrying or cancelling a pipeline. A `read_api`
token works for viewing only: status, runners and health show, but tap/hold on a Branch key fails with
**Needs api scope**. Use `read_api` if you want a strictly read-only deck and have turned retry/cancel off.

What the token's account needs:

| Feature | Access required |
| --- | --- |
| Branch status | Can view the project's pipelines (Reporter or above on private projects) |
| Retry / cancel | Developer or above on the project |
| Runner Status / Runner Health | Instance runners: administrator. Group/project runners: Maintainer/Owner |
| Queue depth on Runner Health | Administrator (otherwise shows `?`) |

A project or group access token with the `api` scope and the Developer role also works, limited to
that project or group.

## Setup

Set **GitLab URL** and **Access token** once in any key's settings; they're shared by all keys.
Each key can override both, e.g. to mix gitlab.com and a self-hosted instance. Branch keys also
accept a pasted project URL.

Keys poll every minute by default and every 10 seconds while something is building. Runner Status keys and
Runner Health share one runner snapshot (a single GraphQL query for administrators), so they always
update together and agree with each other. GitLab has no
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
| `src/runner-hub.ts` | Shared runner snapshot that keeps all runner keys in step |
| `src/actions/runner-health.ts` | Runner health key; on dials, overview plus each runner |
| `com.wyntersoft.gitlabci.sdPlugin/` | Manifest, property inspector, images |

CI runs the tests and attaches the packaged `.streamDeckPlugin` to each pipeline.
