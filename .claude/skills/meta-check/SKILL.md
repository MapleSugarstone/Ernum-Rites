---
name: meta-check
description: Use whenever running an Ernum Rites balance tournament or reading one afterwards — after changing card stats or text, when asked to "run a meta check", "run the meta", "check the balance", or to analyse colours, identities, matchups, card lift, leaders, card or power usage, or why a colour or deck is winning. Covers the run procedure (which builds the SQLite databases as part of the run), the queries to answer each kind of question, and the noise floors a claim has to clear. Every claim must come from a query rather than from reading the card.
---

# Running a meta check and reading it

Six tournaments, logged in full, loaded into SQLite, then queried. Everything
below exists because some part of it went wrong at least once.

## The rule that matters most: query it, do not reason about it

**Every claim in a meta report must come from a number the database returned.**
Reading a card and explaining why it must be strong is not analysis, it is a
hypothesis, and the hypotheses lose badly. Six from this project, all confidently
argued from the card text and all wrong:

| the theory | what the query said |
|---|---|
| Wounds are what makes Oil win | cutting 14 wound copies cost 8.9 points, cutting 14 non-wound cost 15.4 |
| Fish has no losing matchup | the matrix had Fish losing to Pepper at 49.2% |
| Hate Machine's 2-debt-a-turn is draining Robot | Robot gains 2.00 debt a turn with it out, 2.16 without |
| Statline nerfs are worth 1.5-2.5 points | Pistachio 1/3 to 1/2 moved it 0.26, inside noise |
| Leaders cannot attack | 22.9% of all combat is leader swings |
| Leaders do not fire battlecries | `onEnter` runs for leaders in both engines |

The database is built by the run itself, so there is never a reason to skip it.
If a question cannot be answered by a query, say the question is open rather
than filling the gap with a reading of the card.

### What to query for each kind of claim

| claim | query |
|---|---|
| "colour X is strong" | `profile.sql`, then `matrix.sql` to see if it is one matchup |
| "this card is strong/weak" | six-seed lift **and** adoption, then `matchup --swap` to settle |
| "this card is underused" | `powers.sql` first: a low fire rate means misplayed, not weak |
| "this leader is strong" | six seeds of `ladder.json`, never one |
| "X causes Y" | split the population on X and compare, e.g. debt per turn with and without the card |
| "this change worked" | before/after on matched seeds **plus** an untouched control group |

A card's text tells you what it *can* do. Only the log tells you what it *did*.

## Before the run

Card changes must land in **both** engines. `conformance/cards.json` is generated
from C# and the TS suite compares against it field by field, so a divergence is
caught for you if you run the tests.

```bash
npm run cs:release      # NOT cs:build - see the Debug trap below
npm run cs:sim -- cards
npm run replays:record
npm run cs:test && npm test
```

Re-record replays after any card change or they fail as stale. Both suites must
be green before a run is worth anything.

### The Debug trap, which has cost two runs

`dotnet build` defaults to **Debug**. The trainer runs from the **Release**
output. Building with `cs:build` or a bare `dotnet build` leaves Release stale
and the tournament silently plays the old cards.

`npm run cs:release` builds both Release projects. Then verify by timestamp
before trusting the run:

```bash
ls -l --time-style=+%H:%M:%S csharp/Selatza.Engine/Cards/Mixed.cs \
  csharp/Selatza.Train/bin/Release/net10.0/Selatza.Engine.dll
```

The DLL must be **newer** than the card file. The tell for a stale run is logs
that come back the same byte length across 198,000 games.

## The run

Copy the Release output to a scratch directory first. The trainer holds
`Selatza.Train.exe` for ten minutes, and a locked exe blocks every rebuild.

```bash
RUNDIR="<scratchpad>/trainbin"
rm -rf "$RUNDIR" && mkdir -p "$RUNDIR"
cp -r csharp/Selatza.Train/bin/Release/net10.0/* "$RUNDIR"/

# All seeds at once, few threads each, NOT one after another.
for s in 1 2 3 4 5 6; do
  "$RUNDIR/Selatza.Train.exe" train --no-net --every-leader --rounds 200 --games 6 \
    --seed $s --threads 2 --out runs/<tag>$s --log-games runs/<tag>$s/games.szgl \
    > runs/<tag>$s.log 2>&1 &
done
wait

# The databases are part of the run, not a later step. Six single-threaded
# builds run concurrently in about four minutes; one at a time takes ten each.
#
# Use the staged exe, NOT `npm run db`: that is `dotnet run`, which rebuilds,
# and six concurrent rebuilds fight over the same obj directory. Five of six
# died on 'cannot open Selatza.Engine.dll for writing, locked by VBCSCompiler'
# and the run looked finished until the first query failed.
for s in 1 2 3 4 5 6; do
  "$RUNDIR/Selatza.Train.exe" db --log runs/<tag>$s/games.szgl \
    --db runs/<tag>$s/games.db > runs/<tag>$s.db.log 2>&1 &
done
wait
```

Run the whole pipeline in the background: about 42 minutes for six seeds at 200
rounds, 132,000 games each, databases included. Measured: 2,283s of tournaments
plus 251s of database builds.

Check they exist before analysing: `ls -l runs/<tag>*/games.db` should show
six files of similar size. Nothing is analysed until the databases exist. A report written off `cards.csv`
and `ladder.json` alone can say what moved but never why, and "why" written
without a query is a guess.

Six at once beats one at a time by about a third (89s against 133s on a
six-round probe) because the serial work between rounds overlaps; a single
seed on 15 threads leaves the machine idle between them. This is free rather
than a tradeoff: a run is deterministic in its seed and **not** affected by
`--threads`, verified by running seed 7 at 15 and at 2 threads and hashing the
resulting ladder.

- `--no-net` is required. The evaluator plays and only the decks evolve. With
  networks on, the same wall clock buys a few hundred games instead of 198,000.
- `--every-leader` puts all 220 leaders in, which is what makes the identity
  analysis possible. Without it you get 24 random leaders.
- 200 rounds is the working default. 900 and 300 were both tried; seed-to-seed
  variance at 200 is unchanged (0.17-0.32 on colours, 1.41 median on leaders),
  so the extra rounds only bought card-lift sample.
- **Two seeds minimum, six for a single leader.** See the noise floors below.

## Extraction

The databases are built by the run block above and are not optional: the whole
point of `--log-games` is that the analysis is measured rather than argued. Query
them with:

```bash
npm run sql -- --db runs/<tag>1/games.db --file <query>.sql
```

Each database is ~1.6 GB for 132,000 games. Six of them is about 9 GB, and they
build in roughly four minutes when run concurrently, so build all six. Views:
`pg` (one row per player per game), `ev` (events with card names), `bd` (boards
with card names), `game` (one row per game).

### The `pg` view is the one to reach for

`pg` is one row per player per game: `game, seat, seed, leader, colour,
oppleader, oppcolour, won, onplay, reason, turns, actions`. Almost every
question is shaped that way, and without it each query has to union the `game`
table onto itself by seat, which is where the old queries got long and where a
mistake silently halves the sample.

Ready-made queries live beside this file in `queries/`, all built on `pg`:

| file | answers |
|---|---|
| `matrix.sql` | mono colour vs mono colour win rates |
| `identity.sql` | all 26 colour identities, with how each wins and dies |
| `bysize.sql` | one colour vs two vs three vs neutral |
| `leaders.sql` | every leader by win rate |
| `profile.sql` | how each mono colour wins and how it dies |
| `board.sql` | bodies, debt, hand, deck, leader HP per colour |
| `powers.sql` | **fire rate per Power, and the game either way** |
| `onplay.sql` | what going first is worth, overall and per colour |

`powers.sql` is the one that catches a card being misplayed rather than being
weak. A low fire rate next to a large win-rate gap means the evaluator is not
finding the line.

### Parsing SQL output

Leader and card names contain spaces, so splitting the table on whitespace
silently drops rows — this produced a wrong "42 powers never fire" claim that
was really 23. Emit a delimiter instead:

```sql
select name || '~' || count(*) row from ... group by name
```

Then split on `~`. `leaders.sql` is already written this way.

### Card lift

Lift comes from the trainer's own `runs/<tag>N/cards.csv`, not the database. It
is the game's result minus what the ratings expected beforehand, so a card in a
strong deck earns nothing for a win everyone saw coming. Keep only cards with
**3,000+ plays in both seeds** and require the two seeds to agree on sign. The
two runs normally correlate at r ≈ 0.95-0.97.

## Noise floors

Measured from seed-to-seed variation on unchanged cards. Nothing below these is
a finding:

| measure | noise |
|---|---|
| mono colour win rate | 0.2 pts |
| two-colour identity | 0.9 pts |
| three-colour identity | 1.1 pts |
| a single leader, 6-seed mean | ~1.0 pt (sd 1.2 / &radic;6) |
| a single leader, one seed | sd 1.2 typical, 2.3 for a volatile one |
| card lift, 3,000+ plays | ~0.005 |
| card lift, under 3,000 plays | up to 0.19 — exclude these |

Always report an untouched control group alongside a change. If the untouched
field drifted, the change did not do what the number suggests. A leader that was
deliberately skipped once moved 0.9 points on its own, further than five cards
that were actually cut.

### Six seeds for a claim about one leader

Two seeds is enough for colours and for card lift, and **not** enough for a
single leader. Comparing seed 2 to seed 2 once showed Slicer falling 58.4% to
54.0% after a buff; six seeds put it at 55.6% (CI 53.7-57.4) and the position
had barely moved. Its per-seed values were 58.2, 54.0, 56.6, 56.8, 56.1, 51.7.

Typical leader sd across seeds is 1.2 and the noisiest run near 2.3, so one seed
carries a 2-3 point error and two seeds only halve it. Six brings the standard
error to about 1 point, which is what a 1.5-point claim needs.

Run extra seeds with the same command and a new `--seed`; there is no need to
build a database for this, since `runs/<tag>N/ladder.json` already carries each
leader's wins and losses.

### Use win rate, not ladder rank

Rank is Elo against a shifting field and compounds small differences. Across the
same six seeds Slicer placed 1st, 11th, 12th, 25th, 46th and 68th while its win
rate stayed inside 6.5 points. Any claim of the form "this leader moved N places"
is almost certainly reading noise. Quote win rate.

## Engine facts that have been got wrong

- **Leaders attack.** 22.9% of all combat, ~3.5 swings a game. `readyAttackers`
  includes the leader in both engines. A stale comment in `state.ts` says
  otherwise; the one in `engine.ts` is right.
- **Leaders fire battlecries.** `onEnter` runs when the leader takes the field
  (`engine.ts:246`, `Engine.cs:267`). A battlecry drawback applies to the leader
  version too.
- **A leader carries printed HP doubled plus two.**
- **Statline nerfs do not work on a leader whose value is its text.** Professor
  Pistachio was cut from 1/3 to 1/2, which is 8 effective HP down to 6, and moved
  55.37% to 55.11% over six seeds each. The same 1/3 card had already scored
  55.59% and 55.37% in two runs where nothing about it changed, so the nerf is
  smaller than the noise it sits in. An earlier guess that 3-to-2 printed HP is
  worth 1.5-2.5 points did not survive being measured; do not quote it.
- The lever that does work on those leaders is the text. Pistachio draws a free
  card every turn and anthems its own faction, and none of that cares how much
  HP the body has. Five of the strongest mixed leaders are anthems or auras, so
  cut the text and leave the statline alone.
- Neutral is its own colour `N`, not a placeholder Robot. Read `color`, and
  `conformance/cards.json` now carries the `neutral` flag too.

## The bot has a turn-level probe (changed 2026-08-26)

`Bot.ChooseAction` used to be a greedy one-ply search: apply each candidate,
score the state right after it, take the best. That stopped before the attack
step, so every line reading "use the Power, then hit them" was scored as if the
second half never happened.

It now scores each playable action by rolling the rest of the turn forward:
replay bodies from hand strongest first, then swing with everything, aiming at
the leader when it is exposed and the softest body otherwise. Nothing in it
names a card; it reads only `Type`, `Level`, `Strength` and legality, so the bot
reaches a combo by search rather than by being told.

Two things this cost, both worth knowing before comparing runs:

- **About 2.4x slower**, roughly 880 ms to 2,100 ms a round. With all six seeds
  running concurrently a full check is about 40 minutes rather than 27. It was
  2,750 ms before two fixes worth remembering if the probe is touched again: the
  two-pass structure applied every candidate twice, and the develop step called
  `CandidateActions` (which builds every spell target combo and attack pairing)
  only to filter it down to summon plays.
- **Every baseline before this run is void.** The bot is the measuring
  instrument, so numbers from `n`, `tb`, `gf` and `an` cannot be compared with
  anything measured afterwards. Re-baseline before reading any change.

Two traps found while building it, in case it is touched again. Crediting the
*baseline* with the swing as well prices attacking out of its own comparison,
the bot passes instead of hitting, and game length doubles from 9 to 18 turns.
And probing only some action types credits those with a whole turn and the rest
with one action, which is not a comparison — probe everything or nothing.

## The biggest blind spot: the run measures the bot, not the card

Every number here is the evaluator's result with a card, so a card the bot plays
badly reads as a weak card. This is not a small correction. Split each card by
whether its Power was ever activated in that game:

| card | on board | Power fired | win when fired | when not | gap |
|---|---|---|---|---|---|
| Helemy | 5,894 | 9% | 82.6% | 43.8% | +38.8 |
| The Infinite Ship | 15,808 | 30% | 69.7% | 47.5% | +22.2 |
| Deep Sea Heart | 21,850 | 56% | 65.0% | 44.9% | +20.1 |
| Gold Wild | 12,588 | **4%** | 69.2% | 51.2% | +18.0 |
| Cyber Siren | 6,421 | 8% | 53.7% | 45.0% | +8.7 |
| Hate Machine | 21,825 | 83% | 53.1% | 49.4% | +3.7 |

The pattern is that the bot fires the simple always-on Powers and skips the
situational ones, and the situational ones are exactly where combo damage lives.
Set Sail bounces every other summon, and the leader is only attackable once the
slots in front of it are empty (`Engine.cs`, `LegalAttackTargets`), so Set Sail
into an alpha strike is lethal. The bot finds it 30% of the time.

So a low lift or low adoption on a card with an activated Power is **not**
evidence the card is weak. It may only be evidence the evaluator cannot pilot it.
Before nerfing or buffing anything with a Power, check its fire rate first.

Some of the gap is selection: you activate a Power when you have the mana and a
board worth using it on, which correlates with already winning. The fire rate is
not confounded, though, and a 4% or 9% fire rate is a plain statement that the
tool is going unused.

The corollary is that a card can be genuinely overpowered in human hands and
invisible here. `--every-leader` partly hides this for leaders, since a leader is
always in play and its Power is always reachable: The Infinite Ship is the 3rd
best leader at 57.49% with the tightest spread in the set, while ranking only
4th among Fish level 3s as a deck card.

## Finding an overpowered card

Lift is a residual, so it is not the only lens and not always the best one.
`runs/<tag>N/ladder.json` carries every surviving agent's full 48-card decklist,
which supports a measure lift cannot give: **adoption**, the share of decks that
*could* legally run a card and actually do. Compute legality from each deck's
`colors` against the card's colours, treating neutral as legal everywhere.

Pair it with **saturation**, `copies / (2 * decks holding it)`, since the copy
limit is 2. A card at 90% adoption and 99% saturation is one the population
treats as an auto-include wherever it is legal.

Across 239 cards the two agree closely, r = 0.84, so adoption is a cross-check
rather than a replacement. Adoption's advantage is that it is a direct count and
needs no ratings model. Typical values: median 31%, 75th 49%, 90th 69%.

## Settling a single card

Lift nominates, the matchup settles. Export a deck and swap one card:

```bash
dotnet run -c Release --project csharp/Selatza.Train -- matchup \
  --a runs/decks/<deck>.txt --swap old-id=new-id --games 2000 --no-net
```

That is the deck against itself with one card changed, over the same seeds both
ways, with a Wilson interval. Three things about it are easy to get wrong.

**Swap for a card the deck does not already run.** The copy limit is 2, so
swapping into a deck that already holds the replacement fails with "not usable".
Pick an absent neutral of the same level and use the same one across every card
you compare.

**Run the null swap first.** `--swap X=X` should come back at 50%. It measured
49.7% (47.5-51.9), which is the check that the tool is unbiased before you
believe any real result.

**The regime is not the tournament.** A deck against itself is an even matchup,
so games run about 18 turns and over half end on a deck-out, against 9.4 turns
in the tournament. Cards that pay off early are undersold here and attrition
cards are oversold. Treat a swap result as "worth this much in a long mirror",
not as a meta verdict.

Deck dependence is real and large. Slime measured +7.4 points in one shell and
−2.3 in another; Strange Station measured −4.4 in one Cyber Siren deck and an
even 49.6% in a different one. Test two decks before calling a card anything.

**What the ceiling looks like.** Measured against a replacement-level neutral,
the best cards in the set are worth +2.4 to +4.0 points: River Drinker +4.0,
Abyssal Walker +3.1, The Serpent +3.2, The Maestro +2.9. Nothing measured beyond
that. If a card ever comes back at +8 or more, that is the shape of genuinely
overpowered, and nothing in the set currently does.

## The round robin, and how it disagrees with the ladder

`roundrobin --decks <folder> --games N --seed S --out x.csv` plays a folder of
exported decks against each other, every pair, and is the fastest way to test a
card change: 42 decks is 861 pairings in about fifteen minutes against the
tournament's forty-five. Build the folder by taking the best one or two leaders
per colour identity out of `runs/<tag>1/decks.txt`, splitting on the row of
dashes and matching `leader: ... [id]`.

The two measurements disagree, and the disagreement is informative rather than a
fault. Measured on the same 42 decks: rank correlation 0.82, mean gap 6.6 points,
worst 16.6. The ordering broadly agrees. What differs is scale, and the ladder
spread those decks over 13.8 points where the round robin spread them over 35.8.

**The round robin is an amplifier, and the gain is about 2.1.** Measured
directly: 42 decks pulled from one run and sampled evenly across its whole rating
range, 1795 down to 1205, then played all-vs-all on the build that produced them.
Ladder spread 24.72, round robin spread 46.40. Regressing one on the other gives
`robin = -55.4 + 2.12 x ladder`, so a one-point ladder difference reads as 2.12
points in the robin. Rank is largely preserved (Spearman 0.845, Pearson 0.795),
absolute win rate is not: mean gap 6.28 points, worst 21.20.

The cause is matchmaking. The ladder pairs a deck mostly against its own rating
neighbours, so a weak deck holds a respectable score by playing other weak decks,
and a strong one cannot farm the bottom. A round robin forces every pairing
equally. The bias falls almost entirely on level:

| leader level | ladder | robin | gap |
|---|---|---|---|
| 1 | 46.85 | 40.46 | -6.39 |
| 2 | 50.47 | 52.75 | +2.28 |
| 3 | 50.18 | 52.84 | +2.67 |

So a round robin is sound for A/B deltas on a fixed folder, for finding cycles,
and for finding lopsided matchups. It is not a source of absolute win rates, and
a spread taken from one should be roughly halved before comparing it to a ladder
spread.

**Selection compresses, it does not inflate.** Building the folder from the best
one or two decks per identity narrows the field, so those runs read tighter than
the format warrants. The 28-31 spreads seen on hand-picked folders and the 46.40
on a full-range sample come from the same build.

**The ladder is also an adaptive equilibrium.** In the tournament decks evolve to
beat whatever is winning, so a dominant deck gets targeted and pulled back toward
50. Nothing adapts inside a round robin, so a deck with no counter present keeps
its whole edge. Banana Mage read 60.0 on the ladder and 69.9 in the round robin
off the same build.


### Deck staleness, which is a real flaw

A round robin's decks are frozen. Keep using the same folder across many card
changes and it measures a meta that no longer exists. The same card set scored
very differently depending only on how old the decks were:

| deck set | spread | 40-60 | cycles |
|---|---|---|---|
| stale (evolved two versions back) | 28.72 | 54.52% | 6.93% |
| fresh (evolved on this build) | 35.83 | 45.64% | 3.74% |

The stale run looked healthy and hid the 69.9% deck completely. Six round robins
were run on one deck folder across about ten card changes before this showed up.

**The rule: refresh the deck folder from the most recent meta check, and trust a
round robin only for changes made since that meta check.** Two or three
iterations deep is a clean A/B; ten deep is measuring a fossil. A round robin
saying a change worked is a hypothesis; only a meta check on rebuilt decks
confirms it.

**Do not evolve decks during a round robin.** Its whole value is that it is
controlled: same decks, one card changed, so the delta is attributable. Evolving
mid-run rebuilds the meta check more slowly and loses attribution. A two-branch
experiment showed the trap from the other side: a change measured a 14.22 spread
on frozen decks and came back 26.76 once the trainer rebuilt around it.

### Reading a round robin

The mean is exactly 50 by construction, so it is zero-sum: one deck gaining 20
points pushes about 0.5 onto everyone else. Never read those as thirty decks
improving. Judge health on spread, standard deviation, the share of matchups
inside 40-60, the blowout rate at 70+, and the rock-paper-scissors triple rate.
A field where under 5% of triples cycle is a strict pecking order, where deck
choice is "pick a better deck" rather than a read on the field.

Exclude the deliberately weak archetypes before judging: Redirection leaders and
Neutral cards are meant to sit at the bottom, and leaving them in inflates the
spread without telling you anything. Strange Station falling from 65% to 15% on
gaining Redirection moved the all-42 spread from 33 to 49 while the other 39
decks got slightly *better*.

## What actually moves a card

Measured repeatedly across one long balance session. Debt is the loss condition,
about 45% of losses are debt, and games run about eight turns, so anything
touching the debt clock is worth an order of magnitude more than anything else.

| change | effect |
|---|---|
| Old Gods, 3 debt per ally death | −31.5 |
| Coralhead, Mill 2 per turn (milling routes to the debt zone) | −21.0 |
| Banana Mage, +2 attack and +1 HP together | +21.0 |
| Obscure Slime, remove 1 debt per turn | +17.7 |
| Abyssal Walker, 1 debt on Strike | −13.4 |
| Gold Wild, 1 debt per turn | −12.0 |
| Seer Altine, a free untapped debt-relief power | +11.7 |
| Slimewitch, attack 3 to 4 | +7.8 |
| a single printed HP, on a body above ~8 effective | ±0 to 1 |
| a draw or debt rider added to an existing tapping power | ±0 to 1 |

Two lessons sit behind that table. **Single statline points are free above the
threshold**: Abyssal Walker lost a printed HP for −0.12 and Strange Station for
+1.19, while a +2/+1 together was worth 21. **Riders on tapping powers do
nothing**, because the power competes with the card's other power for the same
activation; Molly gained a dedicated 2-debt-relief power and moved 0.03.

Cost cuts on powers nobody casts are cliffs rather than slopes. Gold Wild's
Ultimate Novelty went from six Solar to four and the deck jumped 31 points,
because a board wipe that never fires at six is dominant at four.

## Other commands on the same data

- `npm run q` — filter, group and aggregate the log without SQL
- `npm run patterns` — colour rollups plus board persistence per card
- `npm run logstats -- --power <name>` — what a power targets
- `npm run mirror -- --games 3000 --every-deck` — the same deck both seats, which
  isolates turn order; also counts leader swings and first-turn attacks
- `npm run fuzz -- --games 400 --random` — invariant checks over random decks
