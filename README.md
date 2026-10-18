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

- Stream Deck 6.5+
- Node.js 20+ (for development)
- A GitLab personal access token with `read_api` scope

## Development

```sh
npm install
npm run build        # bundle into com.wyntersoft.gitlabci.sdPlugin/bin
npm run watch        # rebuild + restart plugin on change
streamdeck link com.wyntersoft.gitlabci.sdPlugin   # link into Stream Deck (once)
streamdeck pack com.wyntersoft.gitlabci.sdPlugin   # produce a .streamDeckPlugin
```

Requires the Elgato CLI: `npm install -g @elgato/cli`.
