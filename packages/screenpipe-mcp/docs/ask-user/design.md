# ask_user — inbox UI & edge-case design (v1.1)

> All examples use fabricated sample data (Acme / Globex / Initech, Alex / Sam / Jordan).

v1 surfaces an ask as a single ephemeral toast. That's the root of most failure modes: a missed, dismissed, or clobbered toast = a lost decision, and a silent timeout looks identical to "no." v1.1 makes asks **first-class, persistent, and authenticated**, with one durable home: a **"needs you" inbox**.

## Where it lives

Three surfaces, one source of truth (`GET /asks`):

1. **Toast** (exists today) — proactive nudge when an ask arrives. Now *non-destructive*: dismissing it never loses the ask; it just collapses into the inbox.
2. **Bell + "needs you" badge** (top bar) — a count of *pending asks* (distinct from passive notifications). This is the durable anchor: even if you miss the toast, the badge waits.
3. **Inbox view** (the bigger place) — opened from the bell ("see all") or auto-promoted when ≥3 are waiting. Lanes: **Needs you · Snoozed · Done**; cards grouped by pipe/entity; bulk approve. This is the actionable-inbox surface, anchored on asks.

The toast is the *nudge*; the inbox is the *truth*.

## Card lifecycle (the states)

```
pending ──answer──▶ answered   (locked, ✓ receipt, 10s undo)
   │
   ├──timeout──▶ expired        (agent took default; card says which)
   │
   └──can't surface──▶ undeliverable (agent fell back / held; answer here)
```

The key rule: **never silently default.** The agent must be able to tell `answered` from `expired` (default used) from `undeliverable` (never delivered) from `declined` (explicit no). v1 collapses all of these into one default.

## Edge case → design

| edge case (from the audit) | v1.1 behavior |
|---|---|
| missed / dismissed / clobbered toast | ask persists in the **bell badge + inbox** until resolved; dismissing the toast is non-destructive |
| notifications off / headless / app down → silent no-show | engine tracks `delivered`; if it couldn't surface, status → **`undeliverable`** and the agent gets that distinctly (can fall back to a connection like Telegram, or hold) — never a fake default |
| ignored → timeout | status → **`expired`**, card shows "no answer — agent used default: *skip*"; a late viewer sees what happened instead of a dead button |
| answer after timeout | expired card shows the outcome; the option buttons are **disabled** post-resolution (no silent stale write) |
| forged answers (auth-exempt) | **answer endpoint requires the local API key** (the panel already sends it); enumeration/forge from a random local page blocked |
| click but write fails | panel surfaces the error + retries; card only flips to ✓ on a confirmed write |
| no post-answer feedback | card shows **"✓ you chose *Send* · 9:42"** + 10s **undo**; buttons lock (first-write-wins) |
| double-click / change mind | first write wins; later clicks no-op once `answered` |
| engine restart kills in-flight asks | pending asks **persist** (lightweight on-disk store, not pure in-memory) so a restart resumes them; the agent's poll survives |
| hourly pipe re-asks the same thing | engine **dedups** by `(pipe, dedup_key)`; the inbox **groups** repeats ("followup-pipe · 3 pending") |
| two asks at once | both live in the inbox; toast shows the highest-priority one, the rest wait in the badge |
| no inbox surface | the inbox view *is* the surface; `GET /asks` already lists pending |
| blocked run stalls the schedule | long waits run **detached** from the schedule tick; the pipe can finish and resume on answer (this is the v2 durable-resume hook) |
| sensitive content persisted to history | ask bodies are **redaction-aware** (masked in card + history; `reveal` gated); short TTL on resolved asks |
| no validation (empty options/message) | engine **rejects** empty `message`/`options` (400) so you can't create an unanswerable ask |
| registry grows unbounded | **TTL + prune** answered/expired asks |
| multi-machine | out of scope for v1.1 (per-engine); noted — needs the cloud-synced ask queue |
| pipe path (LLM-driven) unreliable | the skill recipe stays, but the **engine owns delivery + timeout + dedup**, so the agent only has to `POST /asks` and read the final status — less for the LLM to get wrong |
| prompt-injection provenance | card shows the **pipe + why/evidence + scope** (reads / writes / sends · local / cloud) so the user judges before approving |

## Backend shape this implies (`/asks` v1.1)

- `Ask.status`: `pending | answered | expired | undeliverable`
- `Ask.delivered: bool`, `Ask.answered_at`, `Ask.answered_via`, `Ask.expires_at`, `Ask.dedup_key`, `Ask.priority`, `Ask.effects` (reads/writes/sends/public), `Ask.evidence`
- `POST /asks/:id/answer` → **auth required**; rejects if already resolved (lock)
- `POST /asks` → validates non-empty; dedups; engine schedules expiry + marks `delivered`
- light persistence (survive restart) + TTL prune
- agent gets the final status verb, not a guessed default

## Build order (after sign-off)

1. **Engine hardening** — status enum, `delivered`/expiry/lock, auth on answer, validation, dedup, TTL, persistence. (small, contained, no frontend)
2. **MCP tool + skill** — return the status distinction; deliver-check; fallback guidance.
3. **Inbox UI** — bell badge + "needs you" dropdown section + full inbox view + card states + undo. (the frontend build)

Mockups of every surface and flow: `use-cases.png` (the ask itself) + `inbox-flows.png` (surfaces, states, flows).
