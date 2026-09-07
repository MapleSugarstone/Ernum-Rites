---
name: bot-work
description: Use whenever touching the Ernum Rites bot or its training and measurement, in either engine — the search, the evaluator, the read, the probes, the network, head-to-heads, tuning, or a cloud meta check. Records how the bot works after the September 2026 rework, how a change is measured before it ships, the traps that cost a day each, the state of the learning line, and the maintainer's standing preferences. Read it before changing anything under src/ai, csharp/Selatza.Engine/Ai, csharp/Selatza.Learn or scripts/gcp-meta.sh.
---

# Working on the bot

Everything here was learned in one long session in September 2026 that took
the bot from even with the deployed one to 60 to 65 percent against it on
every pool. The long-form record is in `claude-notes/ai-audit.md` and
`claude-notes/learning.md`; this is what a session needs before it starts.

## Standing rules from the maintainer

- Never fan out subagents. Work in the main session.
- TypeScript is canonical. The C# engine trains and measures; a mirror fix
  goes C# toward TS. Every bot change lands in both, and the two bots have to
  agree step for step on the replay corpus (`scripts/botparity.ts`).
- A card change gets no test. A new mechanic gets one test, of the mechanic.
- Do not run the full gate as a matter of course. Verify a change with
  `npx tsc --noEmit`, `npm run cs:release`, and the one or two suites it
  touches. Run the full gate before a deploy and when asked.
- Meta checks run in the cloud at 300 to 400 rounds; the local machine cannot
  run one any more. See the meta-check skill and the cloud section below.
- The maintainer wants a bot that reads cards as what they do and never needs
  retraining after a balance change. The arithmetic bot is that; the network
  is at weight 0 and stays there until a run clears the bar.

## The bot, in one page

`src/ai/bot.ts` and `csharp/Selatza.Engine/Ai/Bot.cs`, kept identical in
behaviour. One decision:

1. `peek` rolls the read once a turn on the real table, then `redactTable`
   replaces every other hand with the believed one. The believed hand holds
   only cards the bot has actually seen or named; the rest is a blank trap
   (`knownOnly`, default on). Sampling the rest from the legal pool was
   measured four points worse on candy and even on random; known-only is
   four to ten points better than either. Everything unseen is priced as
   trap density, never imagined as cards.
2. Kill rollouts (`burn`, race then patient setup with the cash-in climb) and
   `findLethal` look for a win this turn.
3. `searchTurn` beams the turn (width 12, depth 10, 6000 applies), and the top
   six end-of-turn leaves get an `outlook`: the opponent's reply, then a
   threat measure. The reply is the bot's own beam on a small profile,
   width 8, depth 6, 600 applies, one ply deep so it cannot recurse, and
   `answerMine` answers what the reply leaves waiting on the bot (a dead
   body's replacement) instead of discarding the reply. This one change was
   worth five to eleven points on every pool.
4. `evaluate` prices leader HP, debt, bodies, hand, deck, and the standing
   terms (deathrattle, hooks, effect damage), plus three engine-derived
   terms: `reachOf` (what a card does on a probe board, so a Recomp or a
   grafted body is worth what it inherited), `cardDoes` (relief, heal and
   burst a card produces in one use), and the kit bonus from the deck scan.
   Debt is charged on a half-convex curve (`debtCurve` 0.5) less half the
   relief the list can still produce; the leader cliff rises with the
   enemy's measured burn or damage rate and falls with heals in hand.

Anything that reads a list must say whose list it may read. The root seat
(`rootSeat` / `_rootSeat` + `_rootSet`) may read its own deck; any other
seat is read as the density of what it has shown. Every probe board blanks
the opponent's hand and deck. Three real leaks were found by the read test
and the corpus, one of them a missing `_rootSet = true` in C# alone.

## How a change is measured

- Paired head-to-head against the deployed snapshot: `Selatza.Sim versus
  --games 600 --decks random|candy|heldout|dir:<folder> --seed N`, every deck
  played twice with seats swapped. 600 games is a 4-point interval. One seed
  is one deck set: candy seed 22 read five points below seed 12 for the same
  bot, so a claim needs two pools or two seeds. Switches on `versus`:
  `--set Name=v`, `--self`, `--perfect`, `--read known|sample`,
  `--hand <chance>x<rolls>`, `--reply <width>,<depth>,<budget>`,
  `--mutate <seed>` (a fake card set, for generalisation). It tallies own
  Store uses and haggles per side.
- Stage `csharp/Selatza.Sim/bin/Release/net10.0` to a scratch folder before a
  long run, and launch exes with PowerShell `Start-Process`, never from the
  Bash tool: its background jobs die at ten minutes.
- Both engines must agree on the corpus after any bot change: re-record with
  `npm run replays:record`, refresh with `npm run net:refresh`, then
  `scripts/botparity.ts` on every replay. A single disagreeing step is a
  real bug every time it happened: a tie broken by registry order, a client
  stand-in card in the pool, a missing root flag.

## Traps, each of which cost real time

- `npm run cs:release` builds Train and Sim only. Build `Selatza.Tests`
  explicitly before a `--no-build` test run or you test a stale binary.
- The Bash tool's working directory drifts into `csharp/` after a `cd`;
  use absolute paths or `cd` back at the start of a command.
- Files under `csharp/Selatza.Train` and `Selatza.Tests` are CRLF; a
  multi-line replace with `\n` silently fails. Normalise line endings in
  the edit script, or use the Edit tool.
- Killing processes by a command-line match can kill the shell issuing the
  command; match on the process name too.
- `structuredClone` was two thirds of a client decision; the engine has a
  hand-written `cloneState` now. Do not reintroduce deep copies in hot paths.
- Probes never nest (`probing` flag): a grafted Recompiler Power minted a new
  card at every level and overflowed the stack.
- Shop prices are cached by seat and slot for a whole decision; a probe must
  save and restore those caches (`kitReach`, `cardDoes` do).
- A card registered only in TypeScript (`hidden`, the face-down stand-in)
  put the two read pools one card apart. Anything walking `allCards()` for a
  collectible set is exposed to this.
- Damage lands one HP card at a time and a card with a flip cost holds the
  rest until its owner answers. `settle` answers the other side's offers
  now; before that every damaging line was scored on the first card of the
  blow, in the kill search, the threat measure and the reply alike.
- The patient climb keeps back the mana its best cash-in needs
  (`cashPotential(...).cashIn`). Without it a repeatable buff ate every pip
  and the Power that was to fire the buffed body was never affordable.
- When you build a board by hand to test a line, check the defending side
  for a Redirection body (Strange Station is one) before reading a missing
  leader target as a search bug. And a hand-built turn has to decline the
  other side's flip offers itself, or damage stays pending and no kill
  shows; `playTurnAnswered` in the combo tests does.

## The learning line

Nine training runs, two labels (result residual, search outlook) and two
uses (final-ranking correction, leaf screen), and none cleared the bar of
plus two points on the held-out starters. Best was plus 1.2. The code for
all of it stays: `train --label search`, `AgentConfig.Screen`,
`setNetwork(bundle, weight, 'screen')`. The reading is that the label is
noise for the residual and the application point is too narrow for the
screen. Do not spend more runs on it without a new idea; the search side gave
every point of the week.

## The cloud meta check

The full-profile bot costs about ten seconds of one core per tournament
game, so a meta check runs on Google Cloud. `scripts/gcp-meta.sh` does the
whole thing: publishes the trainer for Linux, stages it in the project's
`-meta` bucket, creates a spot VM whose startup script fetches the build and
any saved run, plays every seed, builds the databases, uploads `runs/<tag>*`
and a done marker, and the local script watches the bucket and pulls the
results. Facts that matter:

- Project `project-8874ede1-5508-4a5e-b39` ("My First Project") holds the
  quotas: 270 CPUs project-wide, 200 N2 and 176 C3 in us-central1. The SDK
  is at `%LOCALAPPDATA%\Google\Cloud SDK\google-cloud-sdk\bin`
  and is not on the Bash tool's PATH; export it first.
- Never put ssh on the critical path from Windows: the SDK uses PuTTY over
  an IAP tunnel, and it hangs on prompts and drops long commands and large
  copies. Short `--quiet` commands work for reading logs.
- Spot capacity comes and goes by zone and type; the script takes
  comma-separated lists of both and tries them in order. C3 was out in every
  zone one evening; the 128-core N2 was there.
- The `meta` leader pool: no neutral leaders, no Redirection leader but
  Humanity's Defender, no level 1 or 2 body whose whole text is a battlecry;
  186 leaders, 558 games a round.
- Launch through a `.cmd` wrapper with `Start-Process`; a launch through
  `bash -lc` from PowerShell died silently on quoting.
- Read the results with the meta-check skill as usual; the databases arrive
  with the run.

## Where things stood at the end of the session

- The bot in both engines measures 440-159 on candy seed 22 and 432-167 on
  random seed 21 against the deployed snapshot, paired, 600 games, after the
  flip answers and the mana reserve landed (it was 391-208 and 371-228 the
  same morning). Both suites pass, the corpus agrees 13 of 13.
- Heavier peeks (hand 0.25x2, deck 0.3x3) measured two to three points
  under the defaults on both pools. The defaults (hand 0.05x1, deck
  0.15x3) stay; measure any new read level with `versus --hand a x b
  --deck c x d` before changing them.
- A meta check, seed 1 of the `meta` pool to 300 rounds on a 128-core N2, was
  in flight; its results land in `runs/meta1` with `games.db`. Rerunning
  `scripts/gcp-meta.sh meta 1 400 n2-standard-128 ...` resumes it to 400.
- The run does not need a session watching it. The VM uploads `runs/meta*`
  and an `ALL_DONE` marker to `gs://<project>-meta/runs-meta/` on its own and
  stops itself after 14 hours. If the local watcher is gone: read progress
  with `gcloud storage cat gs://<project>-meta/runs-meta/progress.txt`, wait
  for `ALL_DONE` to appear in `gcloud storage ls` of that folder, pull with
  `gcloud storage cp -r gs://<project>-meta/runs-meta/meta* runs/`, then
  delete the VM with `gcloud compute instances delete meta-meta --zone
  us-central1-a --quiet` so its disk stops billing. Confirm with `gcloud
  compute instances list` that nothing else is left running.
- Next candidates on the search side, in order: cache the card probes per
  process (a tenth to a quarter of a tournament game), a cheaper reply
  profile for the tournament instrument only, the threat measure as a beam,
  and a two-ply look on lethal threats. Measure each paired, on two pools.
