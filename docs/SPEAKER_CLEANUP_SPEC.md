# speaker cleanup — flow + edge cases

design spec for fixing speaker detection when one group ends up holding several
different voices. addresses [#4251](https://github.com/screenpipe/screenpipe/issues/4251).

> all names, transcripts and counts in the mockups are fabricated placeholders.
> screens are monochrome per [`DESIGN.md`](../DESIGN.md) (no color, sharp corners,
> space grotesk / crimson text / ibm plex mono).

## the problem

diarization over-clusters. the live matcher assigns an incoming voice to an
existing speaker when cosine distance `< 0.55`
([`crates/screenpipe-db/src/db/speakers.rs:68`](../crates/screenpipe-db/src/db/speakers.rs)).
that threshold is loose enough that, in a noisy day, youtube narration + a barista
+ a couple of real coworkers all collapse into a single "unknown #7" with ~29 clips.

today a user can **merge**, **rename**, **mark-noise**, **reassign one chunk**, and
see **similar** speakers — but there is no way to **split** an over-merged group.
that single missing primitive is what the reporter in #4251 is asking for ("a button
on each row to split it off… then name them one-by-one").

current surface for reference:
- `components/settings/speakers-section.tsx` — clusters, rename, merge suggestions
- `components/speaker-assign-popover.tsx` — per-chunk reassign + propagate
- `crates/screenpipe-engine/src/routes/speakers.rs` — `/speakers/{unnamed,update,merge,similar,reassign,hallucination,delete}`
- `merge_speakers` (`db/speakers.rs:514`) is the natural mirror for a new `split`

---

## user flow

### 1 · review inbox
the speakers screen leads with what needs attention: a mixed group gets a warning
and a single **split & name** action. progressive disclosure — quiet until there's
something to do.

![review inbox](https://raw.githubusercontent.com/screenpipe/screenpipe/assets/speaker-cleanup-mockups/m1.png)

### 2 · the mixed bucket
opening unknown #7 shows the clips are clearly heterogeneous (mic / youtube / cafe).
each row gets a hover **split ↪** affordance — the literal ask from #4251.

![mixed bucket](https://raw.githubusercontent.com/screenpipe/screenpipe/assets/speaker-cleanup-mockups/m2.png)

### 3 · auto-split (the magic moment)
instead of making the user split 29 rows by hand, re-cluster the group locally and
propose sub-voices + a media bucket. apple/google-photos "we found 3 people here".
nothing is written until **apply**.

![auto-split proposal](https://raw.githubusercontent.com/screenpipe/screenpipe/assets/speaker-cleanup-mockups/m3.png)

### 4 · name a sub-voice
name each sub-voice with audio confirm + existing-speaker autocomplete. after naming
we quietly check similar clips elsewhere and offer to fold them in (reusing the
`reassign` propagate path), always undoable.

![name a sub-voice](https://raw.githubusercontent.com/screenpipe/screenpipe/assets/speaker-cleanup-mockups/m4.png)

### 5 · manual multi-select (power path)
for people who'd rather drive: checkbox rows, shift-click ranges, then split / assign /
merge / ignore the selection in one go. linear/gmail bulk-select with keyboard.

![multi-select](https://raw.githubusercontent.com/screenpipe/screenpipe/assets/speaker-cleanup-mockups/m5.png)

### 6 · done
the group resolves into named people + a hidden lane for media. inbox returns to zero.

![done](https://raw.githubusercontent.com/screenpipe/screenpipe/assets/speaker-cleanup-mockups/m6.png)

---

## edge cases

### a · the whole group is media
if every clip came from system audio in youtube/spotify, it's probably not a person.
offer a one-tap "ignore as media" + an opt-in to auto-hide system audio next time.

![all media](https://raw.githubusercontent.com/screenpipe/screenpipe/assets/speaker-cleanup-mockups/m7.png)

### b · a few room-noise outliers
most of the group is one consistent voice with a few low-fit strangers (cafe orders,
background chatter). surface the outliers by fit and let the user split or ignore just
those — needs the cosine distance we already compute to be returned to the client.

![outliers](https://raw.githubusercontent.com/screenpipe/screenpipe/assets/speaker-cleanup-mockups/m8.png)

### c · one wrong clip inside a named person
from a person's page, any clip can be popped back out with "not <name>" — a one-clip
split that leaves the rest of the person intact.

![not this person](https://raw.githubusercontent.com/screenpipe/screenpipe/assets/speaker-cleanup-mockups/m9.png)

### d · two names, one person
the inverse failure: the same person named twice. a side-by-side confirm with a match
meter, wired to the existing `/speakers/merge`.

![merge duplicate](https://raw.githubusercontent.com/screenpipe/screenpipe/assets/speaker-cleanup-mockups/m10.png)

### e · undo
every split / merge / ignore is reversible, and the undo persists (not a 5-second
snackbar). reuses `undo-reassign`'s `old_assignments`.

![undo](https://raw.githubusercontent.com/screenpipe/screenpipe/assets/speaker-cleanup-mockups/m11.png)

### f · nothing to review
inbox-zero state so the screen isn't a wall of unknowns.

![inbox zero](https://raw.githubusercontent.com/screenpipe/screenpipe/assets/speaker-cleanup-mockups/m12.png)

---

## what it needs from the backend

| capability | status | note |
|---|---|---|
| `POST /speakers/split` (move chunk_ids → new speaker + their embeddings) | **new** | mirror of `merge_speakers` (`db/speakers.rs:514`) |
| sub-cluster a single speaker's embeddings | **new** | small k-means / threshold pass over its `speaker_embeddings` |
| return match distance per clip | **new** | already computed in the matcher, just not surfaced |
| typed ignore (media / background / noise) | **extend** | generalize the `hallucination` flag into a category |
| reassign + propagate, undo, merge, similar, mark-noise | **exists** | reuse as-is |

---

## ai-assisted identify — map speakers from screen context

audio-only diarization can't tell alex from a youtube host from a barista — they're
just voice vectors. but screenpipe has the **screen frame at the same timestamp**, and
the screen usually names the speaker outright (zoom's active-speaker tile), flags media
(a youtube video playing), or flags background (no meeting app focused). an **✦ identify
with AI** button — or a background pipe — turns that context into names. this is the part
no audio-only tool can copy, because they don't have the frames.

### tiered, so it stays cheap and private
1. **text first (no model call)** — at each clip's timestamp, read `accessibility_text`
   of the focused window (zoom/meet/teams tiles already contain participant names),
   `is_input_device`, app + window title, and calendar attendees. resolves the easy
   majority deterministically.
2. **VLM for the rest** — only ambiguous clips go to **gemma4-e4b** (the private video
   model already running in the tinfoil enclave / locally — the same one `vision-clone`
   uses). it *looks* at the frame: who's highlighted, is this a video, is this even a
   meeting.
3. **confirm, don't auto-apply** — output is a proposal with the resolved name, a
   one-line "why", an **evidence frame**, and a match score. the human rubber-stamps;
   everything is undoable. runs as a background pipe → only the unsure ones surface.
   that's the scalable part: labeling stops being manual.

### before → after

| before (today) | after (AI-mapped) |
|---|---|
| ![before](https://raw.githubusercontent.com/screenpipe/screenpipe/assets/speaker-cleanup-mockups/proto-before.png) | ![after](https://raw.githubusercontent.com/screenpipe/screenpipe/assets/speaker-cleanup-mockups/proto-after.png) |

one stuck "unknown #7 · 29 clips" with only rename/merge → 2 people named from the zoom
tile + calendar, media & room split off, each carrying the frame it was inferred from.

### walkthrough

![walkthrough](https://raw.githubusercontent.com/screenpipe/screenpipe/assets/speaker-cleanup-mockups/walkthrough.gif)

(also as [mp4](https://raw.githubusercontent.com/screenpipe/screenpipe/assets/speaker-cleanup-mockups/walkthrough.mp4))

### privacy
frames are the most sensitive surface screenpipe has — this never ships them to a third
party. gemma4-e4b runs in the tinfoil enclave or fully local, matching the local-first
promise the enterprise ICP buys on.

### what it needs
- the tiered resolver as a pipe: clip timestamp → frame/a11y join (exists: `frames`,
  `accessibility_text`, `get-frame-elements`) → name proposal
- the selected AI preset drives which model runs (cloud / ollama / enclave)
- reuses `/speakers/split`, `reassign`, typed-ignore from the manual flow — the AI just
  pre-fills the same confirm screen

---

## build order

1. `/speakers/split` + per-row split (#2) + multi-select (#5) — answers #4251 directly, smallest surface.
2. typed ignore + source-aware "ignore as media" (#a) — kills the noise that causes the over-cluster.
3. auto-split proposal (#3) — the high-value step once split exists.
4. surface match distance → outliers (#b) + confidence sorting.
5. ✦ identify-with-AI pipe (tiered text→VLM) feeding the same confirm screen — the scalable endgame.

---

## testing

the interactive prototype of the AI flow is driven **end-to-end with playwright** — 16
assertions, all green. it's the proof the flow hangs together before any app code ships:

```
✓ before: mixed 29-clip group is shown
✓ before: "identify with AI" button present
✓ identify: shows reading-screen-context state
✓ identify: surfaces the privacy guarantee
✓ after: resolved a real name (alex rivera) from the zoom tile
✓ after: used a calendar attendee as a name source
✓ after: flagged the media/youtube group to ignore
✓ after: flagged café/background as room noise
✓ after: per-group actions present (×4)
✓ done: 2 people named automatically · result is undoable · media hidden
```

when the real UI lands, the app-level WDIO spec mirrors the existing
[`e2e/specs/settings-sections.spec.ts`](../apps/screenpipe-app-tauri/e2e/specs/settings-sections.spec.ts)
— `data-testid`-driven so copy changes never break it — plus a `coverage-map.json` entry
(a new spec without one reds the coverage report on every platform):

```ts
// e2e/specs/speakers-cleanup.spec.ts
describe('speaker cleanup', () => {
  before(async () => { await waitForAppReady(); await openHomeWindow(); await openSettings(); });

  it('splits an over-merged group into a new speaker', async () => {
    await (await $('[data-testid="settings-nav-speakers"]')).click();
    await (await $('[data-testid="cluster-unknown"] [data-testid="select-clip"]')).click();
    await (await $('[data-testid="bulk-split"]')).click();
    expect(await $('[data-testid="speaker-new"]')).toBeExisting();
  });

  it('identify-with-AI proposes names + evidence, applies on confirm', async () => {
    await (await $('[data-testid="btn-identify"]')).click();
    await (await $('[data-testid="panel-after"]')).waitForExist({ timeout: 15_000 });
    await (await $('[data-testid="btn-apply"]')).click();
    expect(await $('[data-testid="panel-done"]')).toBeExisting();
  });

  it('undo restores the original grouping', async () => {
    await (await $('[data-testid="undo"]')).click();
    expect(await $('[data-testid="cluster-unknown"]')).toBeExisting();
  });
});
```
