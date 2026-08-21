---
title: Getting started
description: Run ai-companion locally from a fresh clone in under 5 minutes.
---

# Getting started

> **Audience:** first-time user with Node.js and Git installed.
> **Outcome:** the app is running on your machine and pointing to a workspace folder.

## Prerequisites

- macOS (the spike is macOS-only).
- Node.js 22+ and npm.
- Git.

## 1. Clone and install

```bash
git clone https://github.com/ogs-tech/ai-companion.git
cd ai-companion
npm install
```

## 2. Run in development

```bash
npm run dev
```

`electron-vite` boots the main and preload bundles, starts Vite for the renderer, and opens an Electron window.

### Launch without `cd` into the repo

From the repo root, install the Mac dev shortcut once:

```bash
npm run install:dev-shortcut
```

This registers the global CLI **`ai-companion-dev`** and installs **`/Applications/AI Companion Dev.app`** (or `~/Applications/` if `/Applications` is not writable). Finder opens on the app after install — drag it to the Dock.

Clicking the Dock icon while dev is already running focuses the open window. Dev starts in the background (no Terminal window). **Right-click** the Dock icon → **Open Terminal** to stream logs — closing that Terminal does **not** stop dev. Use **Quit AI Companion Dev** (Dock menu or ⌘Q on the launcher) to stop the project.

If you installed the shortcut before this behavior existed, rerun `npm run install:dev-shortcut` once to refresh the launcher.

Then from anywhere in Terminal:

```bash
ai-companion-dev
```

## 3. First-launch onboarding

On first launch the app has no workspace yet, so the **Onboarding** screen asks you to pick one. The workspace is just a folder on disk where your customizations live as `.md` files with YAML frontmatter.

Pick (or create) any folder you control — for example `~/ai-workspace`. The app then:

1. Persists your choice via `workspace.setActive`.
2. Bootstraps the folder layout via `workspace.bootstrap`.
3. Merges default settings (adapters, linked repos, UI).

After this, the **Main** screen opens with an empty customization list.

## 4. Verify

You're ready when:

- The main window shows the customization list (empty on first run).
- `Settings` shows your workspace path and the configured adapter targets (`~/.claude/`).
- The workspace folder on disk exists and is writable.

## What's next

- Create your first customization _(how-to TBD)_.
- Read the [architecture reference](../reference/architecture.md) to understand the layers underneath.

## Troubleshooting

- **Window doesn't open** — check that no other process is holding port **47173** (dev renderer; see `electron.vite.config.ts`) and rerun `npm run dev`.
- **I/O error screen** — the bootstrap step failed (workspace not writable, missing parent, etc.). Pick a different folder; the same retry button reruns the failed step.
- **Stale build artifacts** — delete `out/` and rerun.
