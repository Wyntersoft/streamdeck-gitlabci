# streamdeck-gitlabci

A Stream Deck plugin that turns keys into live GitLab CI status indicators.

Each key watches a GitLab project (and optionally a branch/ref) and shows the
status of its latest pipeline — passed, failed, running, pending, canceled —
with a colour-coded icon. Pressing the key opens the pipeline in your browser.

Works with gitlab.com and self-hosted GitLab instances.

## Features

- Per-key configuration: GitLab URL, access token, project path, ref
- Polls the GitLab API on a configurable interval
- Status icons for success / failed / running / pending / canceled / skipped / unknown
- Press to open the latest pipeline in the browser

## Requirements

- Stream Deck 7.1+
- A GitLab personal or project access token with `read_api` scope (not needed for public projects)

## Usage

1. Drag **GitLab CI → Pipeline Status** onto a key.
2. In the property inspector set:
   - **Project**: `group/project`, a numeric project ID, or just paste the project URL from your browser.
   - **Branch / tag**: optional; defaults to the project's default branch.
   - **GitLab URL** and **Access token**: shared by all keys. You can override both per key, e.g. to
     mix gitlab.com and a self-hosted instance.
3. The key shows the project, the pipeline status, the ref, and how long ago it finished (or how long
   it's been running). Press it to open the pipeline in your browser.

Keys poll every minute by default and every 10 seconds while a pipeline is in progress.

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
| `src/gitlab.ts` | GitLab REST client (`/projects/:id/pipelines/latest`) |
| `src/render.ts` | Renders key images as SVG |
| `src/actions/pipeline-status.ts` | The key action: polling, rendering, key press |
| `com.wyntersoft.gitlabci.sdPlugin/` | Manifest, property inspector, images |

CI runs the tests and attaches the packaged `.streamDeckPlugin` to each pipeline.
