# Codex PR Loop Automation

This project sets up a scheduled Codex review loop for a GitHub PR backlog.

The loop maintains one daily GitHub issue named `Codex PR loop memory - YYYY-MM-DD`. That issue becomes the AI memory layer for the day: it summarizes every open PR, highlights the maintainer queue, separates merge candidates from risky work, and keeps AI commentary out of PR threads unless a human chooses to use it.

## Shape Of The Loop

1. A Python collector reads GitHub PR metadata through `gh`.
2. The collector builds `pr-loop-context.md` with open PRs, CI state, review state, changed files, patch excerpts, recent discussion, and maintainer feedback examples.
3. `openai/codex-action@v1` runs Codex against `.github/codex/pr-loop-daily.md`.
4. A Python publisher creates or updates the daily GitHub issue with Codex's Markdown output.

The key distinction: Codex writes the daily maintainer brief. The script only gathers facts and publishes the result.

## What Codex Looks For

- PRs that are ready to merge after a final human skim.
- PRs that deserve maintainer attention first.
- Broken or missing CI.
- Missing tests or weak verification.
- Security, auth, billing, infra, database, migration, API, or server risk.
- Broad, low-signal, under-explained, or likely generated changes.
- PRs where a human comment would unblock review.

The prompt intentionally uses `slop-risk` as an internal triage label, not as a public accusation.

## Human And AI Boundary

- The daily issue is the main Codex memory layer.
- Codex does not approve PRs.
- Codex does not request changes as a GitHub review.
- Codex does not post PR comments in the main workflow.
- Draft comments in the daily issue are suggestions for a maintainer to edit or ignore.
- Existing CI runs the code; this workflow reads CI outcomes and patch excerpts.

## GitHub Setup

Add these files to the repository you want monitored and enable Actions.

Required secret:

- `OPENAI_API_KEY`: used by `openai/codex-action@v1`.

Recommended repository variable:

- `MAINTAINER_LOGINS`: comma-separated GitHub handles whose past PR comments/reviews should calibrate Codex, for example `louis030195,othermaintainer`.

If `MAINTAINER_LOGINS` is empty, the loop still analyzes PRs, but it will not pretend random review comments are your taste model.

The workflow in `.github/workflows/pr-loop.yml` runs every 30 minutes and can also be triggered manually with `dry_run=true`.

## Configuration

Edit `.github/pr-loop.json`.

Important knobs:

- `target_repo`: optional `owner/repo`; leave empty inside the target repo's Actions workflow.
- `timezone`: controls the daily issue date boundary.
- `priority.high_value_paths`: surfaces that deserve stronger review attention.
- `codex.maintainer_logins`: committed maintainer handles, if you prefer config over the `MAINTAINER_LOGINS` repo variable.
- `codex.recent_feedback_prs`: how many historical PRs to scan for maintainer feedback examples.
- `codex.max_feedback_examples`: how many examples to pass to Codex.
- `codex.max_diff_chars_per_pr`: patch excerpt budget per PR.
- `codex.max_total_context_chars`: total context budget before trimming.

## Local Context Preview

Install GitHub CLI and authenticate it, then run:

```powershell
$env:TARGET_REPO = "owner/repo"
$env:MAINTAINER_LOGINS = "your-github-handle"
$env:PYTHONPATH = ".github/scripts"
python -m pr_loop.guardian --context-out pr-loop-context.md
```

The older heuristic-only fallback is still available:

```powershell
$env:TARGET_REPO = "owner/repo"
$env:PYTHONPATH = ".github/scripts"
python -m pr_loop.guardian --dry-run
```

## Optional Local Publishing

If you already have a Codex-generated Markdown body in `codex-pr-loop-output.md`:

```powershell
$env:TARGET_REPO = "owner/repo"
$env:PYTHONPATH = ".github/scripts"
python -m pr_loop.guardian --publish-codex-output codex-pr-loop-output.md
```

## Validation

```powershell
$env:PYTHONPATH = ".github/scripts"
python -m unittest discover -s .github/scripts/pr_loop_tests
```
