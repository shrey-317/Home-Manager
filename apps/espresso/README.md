# Espresso Dial-In Coach

An offline, installable web app for dialling in espresso. Run the staged pre-infusion timer, log
the shot, and it tells you what to change next — in your grinder's own units.

Built around one specific setup: a **Turin Legato V2**, a **DF54** grinder, and a
**self-levelling tamper**. Nothing is hardcoded to it — gear is editable — but the app ships
pre-seeded with it, so there is no configuration between installing and pulling a shot.

## Why the advice is the way it is

Two details of that setup drive real design decisions rather than being cosmetic.

**On this DF54, a higher dial number is finer.** That is the opposite of most grinders and of most
dial-in advice you'll read. So grind direction is a property of the grinder record
(`dialDirection`), and every suggestion is expressed as "finer" or "coarser" and converted to a
signed dial change through it. There is a test asserting a 22 s shot suggests **17.0** from 16.5,
and a mirrored test on a `higher-is-coarser` grinder — because a coach that confidently tells you
to turn the wrong way is worse than no coach.

**A self-levelling tamper has no pressure override.** All flow correction is grind-based, so the
engine never suggests tamping differently, and says as much when it diagnoses channelling.

## How a shot is measured

Shots store raw phases — `preInfusionSec`, `extractionSec`, `firstDripSec` — never a single
pre-interpreted "total time". A pull on the Legato's auto cycle has 3 s of saturation and a 6 s
bloom before extraction begins, and comparing that against a bare pull is how you end up chasing
a grind setting that was never wrong. Which measurement the target window refers to is chosen at
read time and configurable in Setup; the default is extraction only, since that is the part the
grind actually governs.

The same care applies to first drip: "early" is measured from the *end* of pre-infusion, so 9 s to
first drip is normal here rather than alarming.

## The rules, in order

The engine (`src/domain/advice.ts`) is a pure function. The first rule that fires wins.

1. **Yield gate.** More than ±2 g off target and the elapsed time says as much about the extra
   liquid as about the grind. It reports flow rate in g/s and asks for a clean shot instead of
   changing anything.
2. **Time correction.** Below the window → finer; above → coarser. One step for a normal miss,
   more when the shot is nowhere near, clamped to the grinder's range and snapped to its steps.
3. **Oscillation guard.** If suggestions have been alternating finer/coarser, it stops stepping
   and asks for two pulls at the same setting — the real answer is between two clicks.
4. **Channelling.** With the time already on target, an uneven puck is the remaining problem, so
   the grind stays put and the advice is about distribution.
5. **Lock-in.** Two consecutive in-window shots at the same dial, with matching yields and within
   2 s of each other, and it offers to lock the dial in. One good shot is not a dial.
6. **Taste tie-breaker.** Only once the numbers are good: sour/thin → finer, bitter/harsh →
   coarser, with temperature offered as the alternative rather than the primary move.

Discarded shots (flushes, spills) stay in the log and are excluded from advice and statistics.

## Data

Everything is stored on the device in IndexedDB. No account, no server, nothing leaves the phone.
Export JSON to back up or move to a new phone, or CSV to open the shot log in a spreadsheet;
importing merges rather than replaces, newest edit winning per row.

Every row carries a sync envelope (`updatedAt`, `deletedAt`, `dirty`) and all writes funnel
through `src/db/repo`, which stamps them and queues an outbox entry in the same transaction.
Deletes are tombstones. **No sync service ships here** — `src/db/sync/types.ts` defines the seam
and documents the conflict policy (last write wins on `updatedAt`; a tombstone beats a concurrent
edit) so adding a backend later touches `src/db/sync/` and nothing else.

## Installing it on a phone

Deployed via GitHub Pages, which supplies the HTTPS origin a service worker needs.

- **Android / Chrome** — an install button appears in Setup.
- **iPhone** — Safari has no programmatic install: use **Share → Add to Home Screen**. It must be
  Safari; other iOS browsers cannot add to the home screen.

Once installed it runs full-screen and works with no network at all.

### What a web app can't do

No web page can keep a timer running while backgrounded, so the timer needs the app in the
foreground — fine for a 40-second shot, and the Screen Wake Lock API keeps the display on where
it's supported. `navigator.vibrate` doesn't exist on iOS, so every stage transition is signalled
three ways: a full-screen colour change, a tone, and vibration where available.

All of those touchpoints live behind thin adapters in `src/platform/`, so wrapping this in
Capacitor to ship real App Store / Play Store binaries later means swapping adapter
implementations rather than rewriting features.

## Development

```bash
npm install
npm run dev          # dev server
npm run typecheck    # tsc --noEmit
npm run lint
npm test             # Vitest unit tests
npm run test:e2e     # Playwright, against a production build
npm run icons        # regenerate the PWA icons from their SVG source
npm run build        # BASE_PATH=/ for a root-served build
```

`npm run test:e2e` also writes a walkthrough of every screen to `screenshots/`. Look at them after
a UI change — the automated checks cover colour and behaviour, not whether a label collides.

### Layout

```
src/domain/     pure logic: advice engine, metrics, timer state machine — no DB, no React
src/db/         Dexie schema, the repo layer every write goes through, seed, sync seam
src/hooks/      live queries and the pure context builder that joins them
src/platform/   haptics, wake lock, install — feature-detected, all degrade to no-ops
src/screens/    one file per screen
src/components/ shared UI and the charts
```

### Two things worth knowing before changing code

**Live queries.** Dexie only re-runs a live query when a table it observed is written, and that
observation is lost after the first `await` in an async callback. So hooks issue exactly one
un-awaited query per table (`queryTable`) and join in plain JavaScript. A nested async read path
looks correct and silently stops updating.

**The base path.** A project Pages site is served from `/<repo>/`, and the Vite `base`, the router
`basename`, and the manifest `scope`/`start_url` must all agree. They all derive from `BASE_PATH`;
disagreement produces a blank installed app or an install that silently refuses. An e2e test
checks the manifest against the path it was actually served from.
