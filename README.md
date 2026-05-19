# obsidian-jarvisctl

`obsidian-jarvisctl` is a custom Obsidian control-plane view for live `jarvisctl` runtimes. It turns structured `jarvisctl` session, cluster, mission, proposal, and ticket data into an operator dashboard for orchestrating Codex work from the vault.

## Current Capabilities

- Custom Obsidian `ItemView`: `Jarvis Control`
- Vue 3 SFC UI with `<script setup lang="ts">`
- Tailwind CSS v4 design system compiled into plugin-local `styles.css`
- Live namespace polling from `jarvisctl list --json`
- Native toolbar with repository scope, search, surface tabs, and runtime counters
- Mission-chain view for autonomy policy, proposals, next actions, lane scorecards, templates, and mission evidence
- Deploy dialog that can start from a ticket, create an ad-hoc ticket, or bind/create a mission template before launching a session
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
  - Obsidian-native top toolbar for scope, search, tabs, counters, deploy, refresh, and settings
  - collapsible repository, node, namespace, worker, and resource sidebar
  - full-height center surfaces for agent chat, execution steps, nodes, policies, namespaces, workers, and mission chain

## Development

```bash
npm install
npm run build
npm run typecheck
npm run install-local
```

`install-local` copies the built plugin into:

```text
/home/rootster/codex/.obsidian/plugins/jarvisctl-control
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
jarvisctl mission plan --output json
jarvisctl mission policy --output json
jarvisctl mission scorecards --output json
jarvisctl proposal list --output json
```

The configured binary path is exposed in plugin settings and defaults to:

```text
~/.local/bin/jarvisctl
```

## Current Limitation

The UI intentionally depends on `jarvisctl` as the runtime provider. GitOps, Kubernetes, ArgoCD, and external workflow engines are design references for the control flow, but the active source of truth is still the vault, mission ledger, session metadata, and `jarvisctl` control plane.

## Roadmap

- recurring two-node mission smoke from the dashboard
- richer proposal forms for worker-lane promotion and external runtime onboarding
- persisted panel preferences
- direct transcript and reasoning drill-down
- live stream transport instead of polling
