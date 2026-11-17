---
title: Watch sessions running outside the app
description: See Claude and Cursor sessions started in other terminals, observe them read-only, or take them over inside the app.
---

## Watch sessions running outside the app

Claude and Cursor sessions you started in another terminal appear in the **Sessões** list as
**externa · <terminal>**. The first time, a banner asks how to detect them:

- **Ver o estado exato** — installs small hooks in `~/.claude/settings.json` and `~/.cursor/hooks.json`.
  Only entries the app owns are added; your other keys are not touched. Cursor sessions opened before the
  install report their state only after Cursor reloads.
- **Só estimado** — changes nothing. The state is inferred from the transcript and running processes, and
  is drawn with a dashed indicator and an "estimado" note.

Change the choice, or remove the hooks, in **Settings → Sessões**.

On an external row:

- **Observar** — a read-only live view of the transcript. Always available.
- **Assumir aqui** — resumes the conversation inside the app. Enabled only when the external session is
  idle or closed; the external process is never killed. A closed external session shows "motivo
  desconhecido": the app cannot see the exit code of a process it did not start.
