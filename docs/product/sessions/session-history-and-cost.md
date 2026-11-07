---
title: Session history and cost
description: Review past sessions, filter by period, harness and model, read their cost and override a model price.
---

## Review past sessions and cost

1. In **Sessões**, click **Ver as N sessões** at the bottom of the list. The **Histórico** tab opens.
2. The chart shows spend per day; click a day to filter to it (the **Dia …** chip clears it).
3. The table lists conversations, newest first by default — **Sessão** (the CLI's own title), **Custo**,
   **Harness**, **Modelo**, **Tokens**, **Duração**, **Quando**. Click a column header to sort by it;
   the **Pasta** is searchable but hidden.
4. Filter with the chips above the table:
   - **7 dias**, **30 dias** (the default), **90 dias**, **Tudo**, or **Personalizado** — which shows **De**
     and **Até** date fields for your own range.
   - **Só este projeto** limits the list to the folder in view; switch it off to see every conversation on
     the machine.
   - One chip per harness that has history (**Claude**, **Cursor**) and one per model; click again to
     clear. The total and the chart follow the period, project, harness and model chips.
5. **Retomar** on a row reopens that conversation in a new session tab (`claude --resume`, or the
   Cursor equivalent for a Cursor conversation).

Cost is the CLI's own figure (its `cost-state` record) whenever the transcript has one. Older transcripts
fall back to a bundled price table; a model with no known price shows no cost rather than `$0`.

## Override a model price

There is no UI for this. Add a `pricing` map to `~/.ai-companion/settings.json`, keyed by model id, in USD
per million tokens (the values below are placeholders — use your own rates):

```json
{
  "pricing": {
    "claude-opus-5-5": { "input": 15, "output": 75 }
  }
}
```

Overrides only apply where the CLI did not record a cost itself.
