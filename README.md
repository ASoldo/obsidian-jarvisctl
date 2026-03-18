# obsidian-jarvisctl

Argocd-style Obsidian control tab for live `jarvisctl` namespaces and agents.

## Current Scope

- Custom Obsidian workspace view: `Jarvis Control`
- Polls `jarvisctl list --json` for live namespace and agent state
- Shows namespace cards, agent rows, and runtime metadata
- Opens real Obsidian Terminal tabs for:
  - `jarvisctl`
  - `jarvisctl attach --namespace ...`
  - `jarvisctl exec --namespace ... --agent ...`
- Runs direct non-interactive actions for:
  - `jarvisctl interrupt`
  - `jarvisctl delete`

## Local Development

```bash
npm install
npm run build
npm run install-local
```

This installs the built plugin into:

```text
/home/rootster/documents/codex/.obsidian/plugins/jarvisctl-control
```

## Runtime Dependency

The plugin expects a `jarvisctl` build that supports:

```bash
jarvisctl list --json
```

The default plugin setting uses `jarvisctl` from `PATH`, but the path is configurable in the plugin settings.

## Design Direction

- Dense operator surface inspired by ArgoCD and Palantir-style control consoles
- Keep the view inside Obsidian, but reuse Obsidian Terminal for real interactive attach/exec sessions
- Avoid scraping terminal text when `jarvisctl` can expose structured runtime state
