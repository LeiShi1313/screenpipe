# Company Brain — Spec

## Problem

Teams install screenpipe on every machine and expect a "company brain": one place that fills up
automatically with how the team actually works — decisions, SOPs, open loops, who-knows-what.

Today each person's data stays siloed on their own machine, and the value (sharing knowledge,
automating shared work) requires assembling the right pipes + connections by hand. Our healthiest
team deployments hit this wall: the champion runs 13 pipes, the rest of the team runs none, and
nobody has a *shared* brain — just N personal ones.

This is an **activation** problem (a north-star metric in `VISION.md`), not a missing-feature problem.
The pieces mostly exist; they aren't wired into one loop a team can turn on in a few clicks.

## The loop

A company brain is three verbs, same as the product (Record, Rewind, Ask):

```
  capture            share                 ask
  (per person,   →   (one shared,     →    (anyone queries
   local, RO)        opt-in dest)          the shared brain)
```

- **capture** — each person's screen/audio → structured knowledge (decisions, SOPs, open loops),
  read-only, on-device.
- **share** — that structured knowledge syncs to ONE shared destination the team already uses
  (Notion teamspace, Slack channel, …). This is the only genuinely new piece, and the one that
  turns N personal brains into one company brain.
- **ask** — anyone queries the shared destination, or asks screenpipe chat / the MCP server.

Local-first is non-negotiable: nothing leaves a machine without an explicit opt-in (`VISION.md`).

## Non-goals

- Not a new capture engine. Reuses existing screen/audio capture and the `/connections` layer.
- Not a god-pipe. A single do-everything pipe is an unconfigurable black box; we compose small pipes.
- Not a surveillance tool. The employer never sees raw screen/audio — only what each person opts to share.

---

## Phase 1 — bundled `company-brain` pipe (this PR)

Ship the loop as one guided, bundled pipe: `crates/screenpipe-core/assets/pipes/company-brain/pipe.md`,
registered in `install_builtin_pipes()` like the other featured templates.

It is an **installer + orchestrator**, mirroring the existing `automate-my-work` pattern (a manual pipe
that creates and enables other pipes) plus the `meeting-summary` ask-never-push connection pattern:

1. reads the user's last 7 days (read-only, ≤6 calls) to design around real work
2. finds the shared destination via `GET /connections`; if none is shareable, says so plainly
   (a personal digest is not a company brain) and offers to connect Notion/Slack
3. creates a read-only **workday-digest** pipe (hourly, local `digest.md`: decisions / SOPs / open
   loops / who-knows-what)
4. surfaces the digest as a **one-click** push to the shared destination — ask-never-push, exactly
   like meeting-summary; automatic only if the user explicitly opts in this run
5. confirms the capture → share → ask loop and names the single highest-leverage next step
   (usually: get one teammate to run the same setup)

This is shippable today, follows existing conventions, and is low-risk (capture is read-only; every
outbound action is opt-in). It is the thin slice that proves the loop with a real design-partner team.

---

## Phase 2 — brain manifest (declarative bundle)

A brain should be declarative, not a sequence of clicks. A manifest names the connections it needs,
the shared destination, the pipes it installs, and the skills it exposes:

```json
{
  "name": "consulting-brain",
  "version": "1.0.0",
  "connections": { "required": ["notion"], "optional": ["slack", "gmail"] },
  "shared_destination": { "type": "notion", "space": "${prompted_at_install}" },
  "pipes": [
    "workday-digest",
    { "id": "team-knowledge-sync", "to": "shared_destination" },
    "personal-crm",
    "todo"
  ],
  "skills": ["company-brain-query"]
}
```

Install = read the manifest, prompt only for what's missing (the required connection + the
destination target), install the pipes pointed at that destination. Every teammate runs the same
install → the same brain. Progressive disclosure: the manifest declares dependencies; the installer
asks lazily.

`team-knowledge-sync` generalizes Phase 1's share step into a reusable pipe (dedup + attribution +
routing are deterministic; only the summarization is model work).

## Phase 3 — marketplace + git change-control

Distribute brains like Claude Code plugins: a marketplace is a git repo of manifests. This splits
cleanly along the existing two tiers:

- **Consumer / self-serve** → the current Supabase pipe store. Click-install, no git.
- **Enterprise / private** → a git repo per company holding that company's brain manifest.

The git path is the unlock for regulated buyers (the team-brain ICP):

- the company's brain config is **code** in their private repo
- any change — add a pipe, swap destination, tweak a capture prompt — is a **pull request**
- an admin reviews + merges; devices reconcile from the repo (reuses the existing enterprise/MDM
  policy-deploy loop)
- every change to *what is captured and shared* is reviewable and auditable — a buying criterion in
  regulated environments, not a nice-to-have

Agentic extension: when a team needs a pipe that doesn't exist, the autofix agent drafts it and opens
a PR against the brain repo. Human review stays the gate.

## Rollout

1. **Phase 1 (this PR):** bundled `company-brain` pipe. Prove the loop with one design-partner team.
2. **Phase 2:** manifest format + a guided installer that consumes it + the `team-knowledge-sync` pipe.
3. **Phase 3:** git-backed brain repos for enterprise; PR-based change-control + MDM reconcile.

Gate each phase on the previous one working for a real team. Stability over features (`VISION.md`).
