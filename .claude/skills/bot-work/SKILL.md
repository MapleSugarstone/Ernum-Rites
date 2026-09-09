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
- Playstyle may change (holding a piece, a bluff, a race), but the paired
  measurement against the snapshot stays the arbiter: a change ships when it
  is inside noise against bots and does what it claims against people. The
  maintainer's words: if the bot cannot deal with the direct bluntness of a
  bot, a human could do that too.
- The human game log is the validation set: never trained on, only
  measured. Training on misplays uses the bot's own games and is judged on
  the logged ones, so a bot tuned to beat default bots cannot hide there.
- Cloud work is watched, not polled on request. Arm a Monitor on every run
  and report each machine event unprompted; a meta check gets a check every
  thirty minutes. The maintainer should never have to ask whether a machine
  was lost.
- Cloud work is small, single seed, and stoppable at any moment with everything
  already finished still retrievable. One seed, a short leader roster
  (`runs/roster-lite2.txt` is 68 leaders against the full pool's 186), and as
  few arms as answer the question. Arms run one at a time on every core and
  upload as each finishes, so a machine lost at any point still leaves its
  finished arms in the bucket. An instance carries `--max-run-duration=2h`
  which GCP enforces from outside, so `shutdown -c` inside the guest cannot
  extend it: a batch that has not produced anything by then is simply gone.
  On 2026-09-08 eleven arms split across 128 cores put about 200 runnable
  threads on the machine, nothing had finished in two hours, and the whole
  batch was lost because the upload ran only after the last arm.
- A run and its notes must let another session, on another model, pick up
  where this one left off: the run state goes to memory with the exact
  commands, and anything long-lived runs detached from the session.
- The Bash tool strips one level of backslashes and mangles heredocs. Write
  files with Write or Edit, use the PowerShell tool for shell work that needs
  backslashes, and point a command at a file rather than inlining content.

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
   `findLethal` look for a win this turn. The exhaustive search sets a
   supporter for the pip a finisher wants and branches on the picks a spell
   asks or a tutor offers (`keepPicksOf` keeps the seat's own picks open
   through the buy-out); before 2026-09-08 a pick ended its line where the
   question was asked, and a person's kill of Loan, a supporter and Absurdly
   Spicy Candy was found only by the beam.
3. `searchTurn` beams the turn (width 12, depth 10, 6000 applies), and the top
   six end-of-turn leaves get an `outlook`: the opponent's reply, then a
   threat measure. The reply is the bot's own beam on a small profile,
   width 8, depth 6, 600 applies, one ply deep so it cannot recurse, and
   `answerMine` answers what the reply leaves waiting on the bot (a dead
   body's replacement) instead of discarding the reply. This one change was
   worth five to eleven points on every pool. The walker also closes the
   reply's own costed flip offers before ending their turn; a reply that
   stopped on one used to fail to end, and the position got no reply at
   all (worth 8 to 23 games per 600). The reply looks one turn ahead: its
   best distinct lines are asked whether they hand the next seat a kill
   (`handsKill`: hand the turn over, run the next seat's rollouts against
   the replying leader) and the first that does not is believed, standing
   after them (`replyPeril`, the count asked, 12). Without it the reply
   emptied its own board for a good trade and the outlook priced the kill
   it had handed itself, which is why the bot once stood with a free face
   hit. `settle` answers the other side's replacement windows greedily,
   as it answers flips, and never inside a probe: the engine refuses every
   action while a hole is unanswered, so before this a beam stopped dead
   at its first kill whenever the victim's owner held a body. The reply
   walk answers what their turn left waiting on the bot before their beam
   runs. At a hole of the bot's own, every answer is judged with the holes
   after it declined (`leafOutlook` sets the stance `replaceAnswers`
   reads): one blocker against none. Without those three the bot declined
   to fill a hole in front of a leader at ten facing an unsapped five,
   because the model's reply to a decline was a turn in which they did
   nothing. The standing side of the blend can
   write off every body the reply takes (`fallen`), so a doomed body is
   not kept at 40 percent of a value the visible board is about to take;
   it measured down on candy and random and ships at 0. The outlook can
   also charge what they do on the turn after their reply (`peril`,
   `standingDeath`), the place a combo one mana short lands; it measured
   a point down on every pool and ships at 0.
4. `evaluate` prices leader HP, debt, bodies, hand, deck, and the standing
   terms (deathrattle, hooks, effect damage), plus three engine-derived
   terms: `reachOf` (what a card does on a probe board, so a Recomp or a
   grafted body is worth what it inherited), `cardDoes` (relief, heal and
   burst a card produces in one use), and the kit bonus from the deck scan.
   The scan probes every piece and set at six pips and eight debt
   (`kitPips`, `kitDebt`) and keeps one card beside the leader as a kit
   (`kitSolo`): at three pips it read Warmateer beside Helemy as a third of
   a kill and kept nothing. A spell trap in hand is priced by the enemy
   pool's spell burst (`trapHold`), since the believed hand holds no spells
   for it to spring on in the search. The pool prior behind both is taken at
   the opponent's shown Love (steps of three to fifteen), since a card that
   spends Love deals what the table shows and the probe used to hand it
   three. A kit piece on the board can count
   for less while the kit's mana is short (`kitExposed`), which is what
   holds Warmateer on turn one; it measured down against bots and ships
   at 1, off, for the human game log to judge.
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

### Beyond the snapshot: the panel, the human log, the analyzer

A head-to-head against one opponent rewards whatever exploits that
opponent's habits, and the blunt bot never holds a piece, never bluffs a
trap and never races a combo. Three checks sit beside it (2026-09-07):

- `Selatza.Sim panel --games N --decks <pool> [--set ...]` plays the
  candidate against the snapshot and against four styles of the current
  bot with other weights in the other seat (blunt, holder, defensive,
  racer). A candidate that loses to any arm by more than noise is not to
  ship on that alone.
- The worker keeps a game log (`worker/gamelog.ts`): every finished solo
  game the client played against the bot, and every match between people,
  as a replay (seed, lists, actions) stamped with the app version, the
  build and a card-set hash, with nothing that names a person. Reading it
  needs the `LOG_TOKEN` secret; `LOG_TOKEN=... npx tsx scripts/pull-logs.ts
  https://<worker>` pulls new games into `replays/human/`. Those games are
  the validation set: never trained on, only measured. A game played on
  the dev server is logged too: the Vite proxy sends `/api/log` to the
  deployed worker (`LOG_URL` overrides), the worker accepts any localhost
  port as an origin, and a game the page could not send posts on the next
  load. The maintainer plays on localhost, and "0 games pulled" after a
  match they describe means it sat in that queue.
- `Selatza.Sim analyze --replay <file or folder> [--seat n] [--deep]`
  re-searches every decision of a replay and scores the played action
  against the best line found, on the redacted table, so the label is
  what the seat could know. The report is regret per seat (bot and
  person), kills on the table not taken, the played-against-best pairs
  behind the large gaps, and the largest gaps with their lines. On the
  bot's own replay at its table profile every gap is zero. A kill the
  root's checks find is the root's value; the report counts a kill on the
  table as a category rather than as the win constant.
- `--oracle` instead asks, per turn, whether the opponent had a kill
  after it with their real hand, and whether a safe end of turn was among
  the whole-turn lines the search weighed. It uses the bot's own searches,
  so a kill that needs a draw first is not one it finds.
- `npx tsx scripts/narrate.ts <replay>` tells a game turn by turn with
  step numbers; `npx tsx scripts/playout.ts <replay> [step] [--set ...]`
  lets the bot play both seats on from any step; `scripts/botexplain.ts`
  and `Selatza.Sim explain` both print the kill checks (race, built,
  exhaustive) beside the gathered leaves.
- Parity on a game the corpus does not cover: `Selatza.Sim decide --replay
  <file>` and `npx tsx scripts/botdecide.ts <file>` print each engine's
  decision at every step in one notation; `diff --strip-trailing-cr` the
  two. Human games are where the engines meet positions the corpus never
  reaches (a Candy hand at ten Love read six points apart in the explain
  tools, and the decisions still agreed on all 63 steps).

The tournament log (`.szgl`) cannot feed the analyzer: it stores a played
card by index, not the action. A log format that carries the raw action
and the lists as played is the step before training on regret.

## Traps, each of which cost real time

- `npm run cs:release` builds Train and Sim only. Build `Selatza.Tests`
  explicitly before a `--no-build` test run or you test a stale binary.
- `npm run replays:record` changes `replays/012-sweetshop-store.json`, and
  `conformance/net-parity.json` holds the trainer's encoding of positions
  from that file. Run `npm run net:refresh` after every re-record and run
  `npx vitest run tests/netparity.test.ts`, or the deploy gate fails on
  the next push (it did on 2026-09-08, twice, and the site stayed on the
  build before the reply change).
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
  card at every level and overflowed the stack. The same flag keeps
  `settle` from answering replacement windows inside a probe: the death
  probe reads a body coming back into the slot a replacement would fill,
  and the Graft pairing test moved the first time replacements were
  answered everywhere.
- `setSearchLimits` clears every cache and the root seat. The hole stance
  applies to the root seat's holes, so a hand-run reply that sets the
  reply's limits and then searches reads the bot's holes as greedy and
  looks nothing like the real reply. `warm(state, seat)` after it sets
  the seat again; the real reply path swaps `limits` without clearing.
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
- The client decides in a Web Worker (`src/ai/botworker.ts`, the bridge in
  `src/main.ts`): a decision on the page thread froze the page for four
  seconds on the bot's first turn, the deck scan and the pool prior
  together. `warm()` runs that once-a-game work at match start while the
  person takes their turn, and a worker that fails falls back to deciding
  on the page. `botStep` drops an answer whose match is gone.
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
- A run must not depend on the session that launched it. `scripts/gcp-keeper.sh`,
  started detached through `scripts/gcp-keeper.cmd` with `Start-Process`,
  attaches to the run's machine, starts it again when it stops, deletes and
  relaunches it elsewhere from the bucket checkpoint after three failed
  starts or when it is gone, pulls the results on the done marker, writes an
  `alive:` heartbeat with the round every thirty minutes to
  `runs/<tag>-keeper.log`, and exits at its hours cap. Arm a Monitor on that
  log in whatever session is current. The maintainer asked for a check every
  thirty minutes because the first online meta check needed constant upkeep.
- `gcp-meta.sh` deletes its machine from an EXIT trap, which also runs on a
  normal kill. Retire an in-session watcher with `kill -9` (no trap) once the
  keeper is up, or the run is deleted from under it.
- Spot capacity on 2026-09-07 evening: every us-central1 zone refused the
  176-core C3 and two refused the 88; us-central1-c took the 88, which ran
  about 85 seconds a round with 186 leaders, 558 games a round.

## Where things stood at the end of the session

- The map of the 2026-09-07 round (every change with its verdict, the
  human game program and its tools, the client thread, the cloud keeper,
  the open items) is `claude-notes/bot-round-2026-09-07.md`; the detail
  behind each item stays in `claude-notes/ai-audit.md`.
- The bot in both engines measures 434-164 on candy seed 22, 437-162 on
  random seed 21 and 435-162 on a mutated set against the deployed snapshot,
  paired, 600 games, with the worst case, the breach, the window answers,
  the climb tie-break and the body plays in the kill search all on (the
  morning's bot read 440-159 and 432-167; the day started at 391-208 and
  371-228). Both suites pass, the corpus agrees 13 of 13.
- Pricing since then: supporters by what the list can spend (`supporterOff`,
  `supporterExcess`), a card in hand by what it draws (`handDraw`), a
  Deathrattle by a death probe (`deathBurst`, `deathDebt`); flat on evolved
  and random, four points up on candy. The deck read is 0.30 three times a
  turn (free); every heavier hand read measured down. Evolved decks for a
  head-to-head: `--decks dir:runs/evolved-nb1` (top 48 of the nb run).
- The death probe (`deathDoes`) kills a body on the probe board and reads
  what its Deathrattle did: cards back, HP off the leader, debt, the body
  that returned (`deathReturn`), a seal on the enemy slots (`deathLock`)
  and HP off their bodies (`deathFront`). All neutral against bots; on for
  Skeleton, grafts and seals.
- Still open, named by the maintainer: board filling never charged for the
  trades an unseen hand makes next turn, and the deck scan blind to control
  kits it cannot trigger on its probe board.
- From the first pro meta check: Alchemize fires in half a percent of the
  games Helemy is on a board, as a finisher only. The pricing behind it is
  built (`fallen`: the outlook writes off a body the reply takes) and the
  reply walker bug found beside it (a reply stopping on its own flip offer
  left the position unjudged) was worth 8 to 23 games per 600. The
  write-off itself measured even on evolved and one to two and a half
  points down on candy and random at 0.5 and 1, so it ships at 0 (table
  in `claude-notes/ai-audit.md`).
  Deck size 48 to 54 is an evolution trait in the trainer since
  2026-09-07 (`--deck-size 48 --deck-max 54`, on by default for `train`;
  the Sim's pools stay at 48 so head-to-heads stay comparable).
- Why Helemy decks were not built toward, from the pro1 database: in 274
  Helemy-led games Warmateer landed on turn 1.8 with no supporters 231
  times and was never Rallied or fed to Alchemize in 162 of them. The scan
  at six pips now sees the kit; holding the piece (`kitExposed`) is the
  behaviour a bot cannot judge and the human log can. The next meta check
  is the test of whether the evolution converges on those pairs.
- From the seventh logged game (2026-09-08): the bot stood with an
  unsapped Ash Demon in front of an exposed leader at twelve because the
  reply it foresaw for standing traded everything away and handed it a
  kill, while the reply it foresaw after the hit blocked. The reply now
  asks its best lines whether they hand the next seat a kill and
  believes the first that does not (`replyPeril`, the count of distinct
  lines asked, 12; the safe line was the ninth in that position). Seven
  percent on decision time, neutral against bots, both engines pick the
  hit, 13 of 13 corpus and all 59 steps of the game agree. Write-up in
  `claude-notes/ai-audit.md`.
- From the sixteenth logged game (2026-09-08): a kill eight actions deep
  (clear three weakened blockers with the small attackers, set a
  supporter, +9 on the big one, swing) is beyond the race and patient
  rollouts and `findLethal` from either seat, so the oracle, `handsKill`
  and `perilOf` all read the position as safe. The bot's own regret on
  that game was 0.1. Next kill-search work: clear with the smallest
  sufficient attacker, keep the largest for the face, buff it before the
  swing (audit: "A kill eight actions deep that no search finds"). The
  losing decision in that game was declining three replacements with
  four bodies in hand while the leader stood exposed at 10 to an unsapped
  5-attack body. The cause was the reply model, not the prior: the
  engine refuses every action while a hole is unanswered, the search
  never answered the other side's holes, and the reply walk handed the
  bot's own hole to their beam, so the reply to a decline was a turn in
  which they did nothing. Fixed 2026-09-08 (replacement answers in
  `settle`, the walk answers the hole first, the hole stance in
  `leafOutlook`); the bot replaces at that step in both engines, the
  fixture `exposed-leader-hole.json` pins it, measurement in
  `claude-notes/ai-audit.md` ("The hole in the reply model"): 449-149,
  455-143, 448-152, inside noise, ships.
- The rollout block (2026-09-08, late): a supporter is a flat step the
  patient climb takes when it unlocks a paid step, the swing and the
  breach clear the front with the smallest attacker that kills so the
  largest stays for the leader, the breach runs whenever a front stands,
  and a rollout answers its own flip offers before weighing anything
  else. The patient rollout then finds the eight-action kill of game
  sixteen from the person's seat. Measured 461-138, 475-125, 474-126
  against 449-149, 455-143, 448-152 before it: up on every pool, ships.
  Both suites pass, corpus 13 of 13, both games agree step for step.
  Next reading: the five kills the deployed bot left on the table over
  the 28 logged games (`analyze --replay replays/human --seat 1 --top
  30`), then the four Helemy wins (games 22, 23, 25, 27).
- Ten gated mechanisms, measured one at a time: `worstCase`
  (on), `breach` (on), `windowAnswers` (on), `deepBurst` (off: two points
  down on random), `paranoia` (off: one to two points down), `fallen`
  (off: one to two and a half points down on candy and random), `peril`
  with `standingDeath` (off: a point down on every pool), `kitExposed`
  (off at 1: down on two pools of three), `trapHold` (on: neutral),
  `replyPeril` (on at 12: neutral, two points down on candy inside
  noise). The
  scan's `kitPips`, `kitDebt` and `kitSolo` ship at 6, 8 and 1, inside
  noise against bots. Switch any
  with `versus --set Name=0|1` before believing a claim about it. Their
  measurement table is in `claude-notes/ai-audit.md`.
- Head-to-heads run in the cloud: `scripts/gcp-versus.sh <tag> <games>
  <machines> <zones> "<arm>" ...`, about four minutes an arm on 128 cores;
  it deletes its machine on exit and the machine has a two-hour cap. A
  spot machine that goes missing before its logs come back is replaced,
  and the third machine is on demand: on 2026-09-07 two 128-core spot
  machines were reclaimed within minutes of starting, in two zones, while
  the same shape had run a full batch an hour earlier. Use a fresh tag for
  a relaunch by hand; the bucket folder of a lost run has no ALL_DONE.
  Watch every batch yourself: arm a Monitor on its log for created, reads
  GONE, before the logs came back, arm results and deleting, with a
  heartbeat, and report each event as it lands. The maintainer asked not
  to have to prompt for status to learn a machine was lost.
- When us-central1 has no capacity for any shape, on demand included (it
  happened for a whole afternoon on 2026-09-07), run the batch locally
  with the staged `Selatza.Sim.exe versus --threads 16`, one arm after
  another, about eight minutes an arm of 600 games. For the next cloud
  run, us-east1, us-east4, europe-west1 and europe-west4 each carry a
  200-CPU N2 quota (C3 is quota'd only in us-central1), so pass their
  zones in the zone list; the bucket is readable from any region.
- A hand-built board needs a deck behind the hand: a summon draws its HP
  from the deck and dies on arrival from an empty one.
- A TypeScript trace of a decision must run on the redacted root
  (`redactTable`, exported) and warm the caches by deciding every earlier
  step of the replay first; `scripts/botexplain.ts` does both. Read on
  the real table the enemy hand is eight points richer, and cold caches
  build their probe boards on a different step than the recording did.
  Both read as engine divergence and neither is.
- When a replay stops agreeing, `Selatza.Sim explain --replay <file>
  --step <n>` and `npx tsx scripts/botexplain.ts <file> <n>` print the
  gathered leaves with score, reply, fallen value and outlook in each
  engine. `--then '<action json or array>'` walks into a line with the
  search's own settlement. The one real divergence found this way: C#
  charged trap-window risk on a Store window, TypeScript never did.
- Two weights existed at zero before that: `worstCase` (unseen enemy cards priced at the
  top quarter of a pool prior, the kill rollout of every legal card beside
  their leader) and `paranoia` (a second reply with the pool's best cards
  in their hand, blended in). Measured paired: the worst case alone is
  even with the defaults, worst case plus paranoia 0.5 is one to two
  points down; paranoia 1 makes the bot pass when the feared kill cannot
  be stopped. Full write-up in `claude-notes/ai-audit.md`.
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
- From the first human games in the log (2026-09-08): the bot's own
  decisions read a mean regret near zero against the deeper search, and it
  still lost at 13 HP to Absurdly Spicy Candy from hand, which deals one
  plus the Love spent. The pool prior prices unseen burst on a probe board
  with three Love (`PROBE_LOVE`), so a Love-scaled card reads as four when
  the table shows twelve, and Love is public. Next read item: the prior at
  the opponent's shown Love. `scripts/narrate.ts` tells a pulled game turn
  by turn, `scripts/playout.ts <replay> [step]` lets the bot play both
  seats on from any position of it.
- Next candidates on the search side, in order: cache the card probes per
  process (a tenth to a quarter of a tournament game), a cheaper reply
  profile for the tournament instrument only, the threat measure as a beam,
  and a two-ply look on lethal threats. Measure each paired, on two pools.
