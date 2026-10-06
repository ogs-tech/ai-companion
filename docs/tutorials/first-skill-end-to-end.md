---
title: Your first skill, end to end
description: Create a skill in the app, watch it appear in Claude Code's config, use it from a session, let the agent improve it, and see what that cost.
---

# Your first skill, end to end

> **Audience:** you have finished [Getting started](getting-started.md) and have the `claude` CLI signed in.
> **Outcome:** in about 15 minutes you will have seen the whole loop — one canonical file, linked into
> Claude Code, used and edited from a session, with its cost on record.

We will build a tiny skill called `tldr` that makes Claude answer in three bullet points.

## 1. Create the skill

1. Make sure you are on the **Início** tab, in the **Global** workspace.
2. In the **Customizations** panel on the right, find **Skills** and click its **+**.
3. In the properties form that opens, fill in:
   - **Name:** `tldr`
   - **Description:** `Use when the user asks for a TL;DR or a short summary of something.`
   - **Scope:** **Personal**
4. In the editor below, write the body:

   ```markdown
   Answer in at most three bullet points.
   Each bullet is one sentence. No preamble, no closing remarks.
   ```

5. Press **⌘S**.

A toast says **tldr salvo**, and `tldr` appears under **Skills**.

## 2. See where it went

Open a terminal:

```bash
ls -l ~/.claude/skills/
```

You will see something like:

```
tldr -> /Users/you/.ai-companion/skills/tldr
```

That arrow is the whole trick. The skill lives once, in the app's data dir; Claude Code sees it through a
symbolic link. Look at the real file:

```bash
cat ~/.ai-companion/skills/tldr/SKILL.md
```

Your name and description are in the YAML frontmatter at the top, the body below it.

## 3. Use it from a session

1. In the **Customizations** panel, find **Sessões** at the top and click its **+**.
   A terminal tab opens in the center and `claude` starts in your home folder.
2. Type:

   ```
   Give me a TL;DR of what a symbolic link is.
   ```

Claude reads the skill's description, decides it applies, and answers in three short bullets. (You can
also call it explicitly as `/tldr`.)

## 4. Let the agent improve its own skill

1. Right-click `tldr` under **Skills** → **New Action**.
   A second session opens with `@/Users/you/.ai-companion/skills/tldr/SKILL.md` already typed — not sent yet.
2. Complete the message and press Enter:

   ```
   @/Users/you/.ai-companion/skills/tldr/SKILL.md add a rule: end with a single relevant emoji.
   ```

3. Approve the edit when Claude asks.

The session edited the canonical file directly — through the same path the link points to. The app notices
the change on disk and re-syncs it; there is nothing to save. Click `tldr` under **Skills** to open it: the
new rule is there.

Back in the first session, ask for another TL;DR and note the emoji at the end.

## 5. See what it cost

1. At the bottom of the **Sessões** list, click **Ver todas as N**. The **Histórico** tab opens.
2. Turn off **Só este projeto** if your sessions don't show.
3. Find the two sessions you just ran: each row shows the model, duration, tokens and **Custo** — read
   from the CLI's own transcript, not estimated.

## 6. Clean up

Hover `tldr` under **Skills** and click the trash icon. Then:

```bash
ls -l ~/.claude/skills/
```

The link is gone, and so is `~/.ai-companion/skills/tldr`. Your sessions remain in **Histórico**.

## What you learned

- A customization lives **once**, in `~/.ai-companion/`, and each harness sees it through a link —
  [Why symlinks](../explanation/why-symlinks.md).
- Editing it from the app, from a session or from any editor are all the same thing.
- Sessions are real `claude` processes, and their history and cost come from Claude Code's own records.

## Next

- [Create skills, slash-commands and agents](../how-to/create-skills-and-agents.md) — scopes, renames,
  slash-commands.
- [Manage workspaces and projects](../how-to/manage-workspaces-and-projects.md) — give a repository its own
  customizations.
- [Write instructions](../how-to/write-instructions.md) — the always-loaded `CLAUDE.md` / `AGENTS.md`.
