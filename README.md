# obsidian-jarvisctl

`obsidian-jarvisctl` is a custom Obsidian control-plane view for live `jarvisctl` runtimes. It turns structured `jarvisctl list --json` session data into a dark operator dashboard with topology, applications, runtime, workflow, and observability surfaces inside the vault.

## Current Capabilities

- Custom Obsidian `ItemView`: `Jarvis Control`
- Vue 3 SFC UI with `<script setup lang="ts">`
- Tailwind CSS v4 design system compiled into plugin-local `styles.css`
- Live namespace polling from `jarvisctl list --json`
- Runtime actions:
  - attach namespace
  - continue/fresh Codex from ticket note
  - open ticket note
  - open transcript
  - tell agent
  - interrupt agent
  - close namespace
  - open `exec` terminals
- Control-plane regions:
  - top bar / environment and search
  - repository and agent sidebar
  - center tabs for topology, applications, and runtime
  - workflow lane
  - bottom observability tabs for logs, events, reasoning, and metrics

## Development

```bash
npm install
npm run build
npm run typecheck
npm run install-local
```

`install-local` copies the built plugin into:

```text
/home/rootster/documents/codex/.obsidian/plugins/jarvisctl-control
```

To iterate locally:

```bash
npm run dev
```

## Enabling In Obsidian

1. Build the plugin.
2. Run `npm run install-local`.
3. Reload the `jarvisctl-control` community plugin or restart Obsidian.
4. Open `Jarvis Control` from the command palette or ribbon icon.

## Runtime Requirements

The plugin expects a `jarvisctl` build with structured runtime support:

```bash
jarvisctl list --json
```

The configured binary path is exposed in plugin settings and defaults to:

```text
~/.local/bin/jarvisctl
```

## Current Limitation

The UI is wired to real `jarvisctl` session data, but it still depends on `jarvisctl` as the runtime provider. Git, Kubernetes, ArgoCD, and workflow-engine adapters are represented through the control-plane layout and live runtime state, not through direct external API integrations yet.

## Roadmap

- adapter interfaces for Git / Kubernetes / Argo-style providers
- richer workflow editing
- persisted panel preferences
- direct transcript and reasoning drill-down
- live stream transport instead of polling
