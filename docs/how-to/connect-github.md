---
title: Connect GitHub
description: Store a GitHub personal access token so the app can publish your plugins.
---

# Connect GitHub

The only feature that talks to the GitHub API is **publishing an owned plugin**, which creates a repository
under your account and pushes to it. Importing plugins and marketplaces uses plain `git` with your
existing Git credentials and does not need this token.

## Create a token

In GitHub → **Settings → Developer settings → Personal access tokens**, create a token that can create
repositories and push to them on your account — for a classic token, the `repo` scope (or `public_repo`
if you will only publish public plugins).

## Store it

1. Open **Settings** (gear icon) → **GitHub**.
2. Paste the token into **GitHub Personal Access Token** and click **Salvar**.

The status changes to **Configurado**. The token is encrypted with Electron `safeStorage` (backed by the
macOS Keychain) into `credentials.enc` under the app's Application Support folder. It is never sent back to
the UI or written to `settings.json`.

## Remove it

**Settings** → **GitHub** → **Limpar**. Publishing then fails with *Configure your GitHub PAT in Settings*
until a new token is stored.

## Next

[Publish your own plugin](install-plugins-and-marketplaces.md#publish-your-own-plugin).
