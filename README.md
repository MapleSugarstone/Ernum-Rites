# Ernum Rites

A two-player card game of summons, traps, spells and debt. The client is a
static site built for GitHub Pages; the rules engine is a pure TypeScript module
that also runs inside a Cloudflare Durable Object as the authority for online
play.

Hotseat and single-player against a bot both work today. Online play is
scaffolded but not wired up.

## Running it

Double-click `play.cmd`, or:

```bash
npm install
```

```bash
npm run dev
```

`check.cmd` runs the tests, both typechecks, and a bot-versus-bot sweep of every
deck pairing.

## How a turn goes

**Awake.** Your leader enters on your first turn with double its printed HP.
Everything you control unsaps, and field and summon triggers fire.

**Draw.** Two cards, unless you are the player going first and it is your first
turn. Every card you cannot draw because your deck is empty costs you a debt, so
an exhausted deck bleeds 2 a turn.

**Main.** Face one card from your hand as a supporter; sapping a supporter pays
one mana of that card's colour. Place summons into your three slots, where each
draws its HP off the top of your deck as face-down cards. Cast spells, set a
field, and use the powers of any summon that is not sapped. Powers do not sap
the summon by default, though the strongest ones now print "then this one saps"
and cost the body its attack.

**Attacking.** Drag a summon onto an enemy and release, the way you would in
Hearthstone; a curved arrow follows the cursor and turns red over a legal
target. Both sides deal their attack to each other and the attacker saps. HP
cards flip one at a time, attacker's side first, and each flipped card's effect
resolves before the next flip. You cannot attack on your first turn, and the
enemy leader is only reachable once their slots are empty.

**Flips.** A card turned over as damage may do something. Small effects fire for
free. Bigger ones are optional and cost something, printed ahead of the effect:
a mana price prints as pips on the flip line, and any other price in words
("Mill 1: draw a card"). You are asked once the damage finishes whether to
pay. A flip costs nothing on the stat line, so the printed cost of the bigger
ones is the only price. About a quarter of the set carries one, concentrated on
level 1 summons and on spells expensive enough that you would rather draw them
as HP than cast them. Every flip that heals carries a cost of one mana in its
colour, so free chip damage never undoes itself.

**Your leader may attack too.** It swings like a summon and takes the counter-hit
like a summon, but a leader that is *defending* deals nothing back. So attacking
with your leader spends HP you can rarely get back, and it saps the leader for the
rest of the turn. It is the button you press to close out a game, not a habit.

**Defending.** When an attack is declared and you hold a trap, the board hands
you a prompt in the middle of the screen: spring one trap or let it through.

**Losing.** Your leader dies, or your debt reaches 20. A summon that dies adds its
level (1 to 3) to your debt, and every undrawable card adds one.

**Battlecry.** Something a summon does as it enters play prints as `Battlecry:`.

**Deathrattle.** Something a summon does as it dies prints as `Deathrattle:`. It
fires while the debt is still unpaid, so a card can discount its own death.

**Strike.** Something a summon does as it declares an attack, before the clash,
prints as `Strike:`. All three trigger words print in their own colours, and
mechanic keywords print bold, so neither reads as a power.

**Scry N** means look at the top N cards of your deck, click a matching card to
take it to your hand, and put the rest on the bottom. A scry that turns up no
match still shows you what was there before the cards go under.

**Attack** is the number a body fights with, and buffs to it are permanent
unless the card says "until end of turn" or grants it as a standing bonus
("Ally summons have +1 attack"). "Ally" on a summon's own text means your other
summons, never itself.

**Stationary.** A Stationary body never declares an attack. It still deals its
attack back when attacked, so a high-attack wall punishes anyone who swings
into it.

**Character** is the word for summons and leaders together. "Deal 1 to every
character" hits everything on the table; "your characters" is your summons and
your leader.

**Spell Trap.** A trap whose response window is the enemy casting a spell
rather than an attack. Springing it counters the spell: it goes to its caster's
discard pile without resolving.

Hovering any card opens a small glossary: definitions for the keywords it
carries and the cards it names, so Rot never has to be taken on faith.

**Wounds** are Oil's currency: every 2 wounds on a body immediately become 1
damage, so a single wound lingers as a visible mark that Oil's payoff cards
read. One legend converts wounds 1 for 1 instead.

**Destroy** is the one word for sending a body to the debt zone, whoever owns it
and whatever caused it.

## Colours, factions and rarity

| Letter | Colour | Feel |
| --- | --- | --- |
| P | Pepper (red) | Burn, board damage, spell recursion, bodies that cash themselves in |
| O | Oil (purple) | Wounds and their payoffs, curses, debt manipulation, reanimation |
| R | Robot (green) | Power Shields, armour plating, reach, taking what you want |
| F | Fish (blue) | Bounce, enemy mill, catching spent HP, fishing the dead out of debt |
| S | Solar (yellow) | Extra supporters, permanent buffs, real healing |

Each of those lists is deliberately exclusive: an effect belongs to one colour,
dual cards may borrow from both of their halves, and neutral trades effects for
stats. The reasoning and the full ownership table are in
[claude-notes/set-redesign.md](claude-notes/set-redesign.md).

Nine factions run across the colours. Fish, Machine, Spirit and Living are each
one colour's identity; Mortal, Scholar and Star are deliberately spread so two
colours can share a payoff without sharing a cost; Beast and Hedron are small
and sit wherever the art does. Only a handful of cards read factions at all.

A deck may run up to 2 of any card. Rarity no longer caps copies: the level a
summon prints, 1 to 3, is what carries the trade-off. A 48-card deck is
therefore at least 24 different cards.

Rarity instead tracks what a card asks of you, in reading and in commitment. It
is derived, never assigned. The baseline is the character count of a card's
rules text, meaning its passive line, the text of each of its Powers and its
flip line, joined by single spaces. Name, factions, cost and the stat line are
not rules text and are not counted. Under 40 characters is Common, 40 to 69
Rare, 70 to 99 Epic, and 100 or more Legendary.

Five things then move a card off that baseline. A summon's level is worth
characters of its own, minus 15 at level 1, minus 8 at level 2 and plus 15 at
level 3, which pulls the two ends apart. A dual card is never Common and is
never pushed below what its own text earned, because asking a deck for two
colours is itself a cost. A triple card at level 3 is Legendary outright,
because it can only be played at all by a leader that brings all three of its
colours, which is the largest commitment the set can ask for. A starter is
Legendary. And a list of cards the rule reads wrong is fixed by hand.

Otherwise Legendary is a tier an adjustment cannot hand out: below 100
characters of printed text a card tops out at Epic, whatever its level and
colours, unless it is a starter, a triple or a named exception.

Character count measures how much a card prints, which is only a proxy for how
much it asks you to understand, and colours do not write at the same length. The
hand-fixed list is mostly there to correct that, so that no colour is harder to
collect than another: it moves simple Fish and Robot cards down to Common and
Pepper cards carrying two abilities or a keyword up to Rare.

| Rarity | Cards | Pepper | Oil | Robot | Fish | Solar | Mixed | Triple | Neutral |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Common | 110 | 17 | 17 | 17 | 18 | 16 | 0 | 0 | 25 |
| Rare | 88 | 17 | 13 | 14 | 9 | 7 | 23 | 0 | 5 |
| Epic | 58 | 4 | 6 | 7 | 9 | 11 | 17 | 0 | 4 |
| Legendary | 40 | 2 | 4 | 2 | 5 | 6 | 10 | 10 | 1 |

By level, 72% of level 1 summons are Common, 37% of level 2 and 18% of level 3.

The rule is `rarityForCard` in [src/engine/types.ts](src/engine/types.ts) and
`Rarities.ForCard` on the C# side, and the tier is computed when a card is
registered, so editing a card's text or level moves its rarity with it and the
two engines cannot disagree. Why these cuts and what the distribution looks like
is in [claude-notes/rarity.md](claude-notes/rarity.md).

**Colour identity.** A deck may only run cards whose colours its leader already
brings, and identity is a subset rather than an overlap. A leader brings its own
colours plus every colour its costs are written in, so a leader can never demand
mana its deck is forbidden to supply. A mono-Fish leader cannot
play a Fish-and-Robot dual card, because that card would drag a colour the leader
does not have; a Fish-and-Robot leader unlocks both colours and everything inside
them. Leading a deck is a seat, not a card type: any summon with a body can take
it, so picking a dual-colour summon as your leader is how you build two-colour
decks. The ten triple-colour legends take that to its end: nothing in the set
brings three colours except one of them, so each is the key to its own identity
and you either lead with it or never cast it. Five cards carry a `starter` flag, which marks them as the ones to hand a
player who has not built a deck yet. It is a curation hint and nothing more.

## The card set

296 cards, one for every piece of art in `assets/Cardgame`: ten level-1, ten
level-2 and ten level-3 summons per colour, one of which is that colour's
starter, ten spells, traps and fields per colour, 51 dual-colour cards across
ten colour pairs, and one level 3 legend for each of the ten three-colour
combinations. A test asserts that every art file is used by exactly one card and
that no card points at art the pack does not ship.

Cards are rendered with the real frames. The frame PNGs are transparent over the
art window, so the client lays the art underneath and positions name, power, HP,
rules and the artist footer on top at the exact pixel offsets the frames use.

## Card frames

The art pack ships one drawing per card shape, in blue. Every other colour is
generated at load time by `src/ui/frames.ts` rather than redrawn: the blue frame
is a single hue at varying brightness, so recolouring is "read how bright this
pixel is, apply that brightness to the target hue", which keeps antialiased
edges smooth. Changing the frame art means changing one file.

The frame PNGs are transparent over the art window, so the client lays the art
underneath and positions the name, level tab, HP, rules text, flip rule and the
attack circle on top at the pixel offsets the frames use. Rules text shrinks in
steps based on how much of it there is, so a wordy card never spills over the art.

## Layout

```
src/engine/    Pure rules engine. No DOM, no network, no imports from src/ui.
src/cards/     Card definitions, one file per colour plus the duals and decks.
src/ai/        The bot: one-ply search over every legal action.
src/ui/        Stylesheet and the frame recolouring for the client.
src/main.ts    The client: rendering, selection, targeting, drag arrow, bot driver.
worker/        Cloudflare Worker and the MatchRoom Durable Object.
csharp/        The same rules in C#, plus a fast test runner and simulator.
csharp/Selatza.Learn/  Networks that learn the game, and their tournament.
csharp/Selatza.Train/  The command line around it.
replays/       Recorded games both engines re-run, to catch any divergence.
conformance/   The card manifest the two engines are compared against.
tests/         Rules, card, deck, bot and cross-engine tests.
claude-notes/  Where every judgment call about the rules is written down.
```

The engine exposes one entry point, `applyAction(state, actor, action)`, which
clones the state, validates the action and returns either the next state or a
reason it was refused. Nothing else mutates a game. That is what lets the same
code run in the browser for hotseat and in a Durable Object for online play.

Card effects are TypeScript functions rather than data, so a card can do
anything the engine can: move HP cards between summons, turn flipped cards back
down, transform a summon into something else, seize an enemy body, put a spell
into play as a summon, or push your debt onto the other player. Any target a
card needs is declared up front in `targets`, which lets the client collect the
choices before dispatching and keeps effect resolution free of continuations.

## The deckbuilder

The setup screen has a Deckbuilder button. Pick a leader, and the browser shows
only what that leader's colours allow, in tabs by colour with the duals last, split
into level 1, 2 and 3, then spells, traps and fields. Clicking a card adds it and
clicking it in the list on the right takes it back out. The count, the two-copy
limit and the colour rule are checked as you go, and Save is refused until the
deck is legal.

The search box under the book matches a card's name, its rules text, or the name
of its rarity, so typing "legendary" finds every Legendary on the tab. Beside it
are four rarity chips. Light any of them to narrow the book to those tiers,
click one again to drop it, and lighting all four is the same as lighting none.

"Start from" copies any built-in or saved deck into the builder, which is the
quickest way to begin. Saved decks live in the browser's local storage and appear
under "Your decks" on the setup screen, playable like any other.

**Dev mode** is a checkbox on that screen. It puts a note button on every card;
write what should change and it is held locally. Export markdown writes them all
out as one file, grouped by card, each with the card's current stats and rules
text above the notes, which is a document someone can act on directly.

## Evolved decks

The setup screen offers three groups: the six hand-built starters, fifteen decks
the tournament built, and the lab decks. The evolved ones come out of a run where
every body that can stand as a leader, all 208 of them with the neutral and
dual-colour summons included, is handed to an agent and the population rebuilds
its decks over seven hundred rounds. The best deck for each colour and each of
the ten colour pairs is kept.

`node scripts/export-evolved.mjs --run runs/<name>` picks them out of the run's
`ladder.json` and writes code fragments for both engines, so a fresh run can
replace them wholesale. The run also writes `timing.txt` (lift by when a card
was played), `swing.txt` (spread of each card's per-game lift), `volatility.txt`
(how far each deck's games land from what the ratings predicted) and
`archetypes.txt` (the population's decks clustered by what they actually run).
The sweeps and the replay corpus deliberately stay on the curated decks, which
is what keeps `check.cmd` quick. The legality tests cover everything.

## Playing the bot

Pick "Play the bot" on the setup screen. It searches one ply: it plays every
legal action out on a copy of the state, scores the resulting board, and keeps
the best improvement, so a new card needs no bot support at all.

## Balancing the set against evolved decks

The fastest use of the trainer is with the networks switched off. A population of
agents, each stuck with a random leader and starting on a random legal deck, plays
a rated tournament and rebuilds whatever keeps losing.

```bash
npm run train -- --no-net --rounds 400 --agents 24 --games 8 --out runs/v1
```

That is about 41,000 games in thirty seconds. It writes `cards.txt` (a readable
report), `cards.csv` (diffable), `meta.csv` (deck slots per card per round, which
is where a buff shows up), `decks.txt` (every evolved deck) and `report.txt` (the
ladder). Two copies of the shipped bot on hand-built starter decks sit in the
field at a fixed 1500, so the ratings mean something.

To settle a card rather than nominate it, change one thing and play the deck
against itself:

```bash
npm run train -- matchup --a runs/v1/best-deck.txt \
  --swap px-firebolt=p1-beast --games 600
```

That reports a Wilson interval and says whether it clears an even matchup. Then
edit the card, run the tournament again into `runs/v2`, and:

```bash
npm run train -- diff --before runs/v1/cards.csv --after runs/v2/cards.csv
```

What the numbers mean, how big a move has to be before it is real, and what the
first full run said about the set are in
[claude-notes/balance-workflow.md](claude-notes/balance-workflow.md).

## Bots that learn the game

Double-click `train.cmd`, or:

```bash
npm run train -- --rounds 120
```

A population of agents plays a rated tournament against each other. Each one is
handed a leader it has to keep, of any level, which fixes the colours its deck may
run; each starts on a random legal deck; and whoever comes out of a round behind
swaps cards out. Two copies of the shipped one-ply bot sit in the field on
hand-built decks at a fixed rating of 1500, so the ladder has an absolute zero.

The search is the same one-ply search the shipped bot uses. What changes is the
scoring: the old evaluator ranks every legal action, and a small convolutional
network then adjusts that ranking by predicting how wrong the evaluator was. Its
main input is one column per card in the set, ordered so that neighbouring
columns are cards competing for the same deck slot, with the card's printed stats
and its rules text boiled down to tags underneath.

The network corrects rather than replaces for a specific reason, which is written
up in the notes: a network asked to rank the shortlist from scratch has to beat
the evaluator at exactly the comparisons the evaluator finds hardest, and one
that is merely as good picks worse. Predicting the correction means an untrained
network predicts zero and changes nothing.

**What the bot is allowed to know.** The observation is built from one side of
the table and contains nothing that player is not entitled to. On top of that it
counts how many copies of each card the opponent has played, which against the
rarity caps and the colours their leader allows bounds what can still be coming;
and each time the opponent plays a card it rolls three times at 15% to name a
card sitting in their deck, and once at 5% to name a card in their hand. Every
one of those numbers is a flag:

```bash
npm run train -- --scout-deck 0.08 --scout-rolls 2 --scout-hand 0.03
```

The tracker is clamped against the real zones after every action, so it can know
less than the truth but never something false. `npm run train:probe` plays a
single game and narrates what it managed to work out.

A run snapshots itself after every round, so a crash, a reboot or an update costs
one round rather than the whole run, and starting the same command again picks up
where it stopped. Ctrl+C finishes the round it is on first.

At the end it plays the best deck against the shipped bot several times over the
same games, letting the network make a larger correction each time, and prints
the sweep. The row where the correction is zero is the evaluator on its own. Most
of any good result is the deck, so the distance from that row is the only honest
measure of what the network is worth.

```bash
npm run train:gauntlet -- --net runs/latest/net0.snn --games 60
```

The design, and the reasoning behind each part of it, is in
[claude-notes/learning.md](claude-notes/learning.md).

## The C# engine

The same rules exist a second time in `csharp/`, where they run about nine times
faster. It is the harness you want for balance work, and the foundation if the
game ever needs a native client.

```bash
npm run cs:test
```

```bash
npm run cs:sim -- sweep --games 200
```

Two hundred bot games take three seconds there against twenty-one through the
TypeScript simulator, and the C# suite finishes in under a second.

Two implementations of one rulebook drift by default, so three things keep them
honest: a canonical position digest both engines build character for character, a
corpus of recorded replays in `replays/` that both re-run step by step, and a
card manifest in `conformance/` compared field by field. The whole arrangement,
including the engine bug the port flushed out, is written up in
[claude-notes/two-engines.md](claude-notes/two-engines.md).

```bash
npm run conform
```

After a rules change the replay corpus will fail, and it should: read which games
changed, then re-record with `npm run replays:record`. After a card change,
re-dump the manifest with `npm run cs:sim -- cards`.

`play.cmd` starts the game, `check.cmd` runs everything, and `cs.cmd` runs the
C# side on its own.

## Deploying the client

Push to `main`. `.github/workflows/deploy.yml` runs the tests, builds with the
asset base set to `/<repo-name>/`, and publishes to GitHub Pages. Enable Pages
with source "GitHub Actions" in the repository settings first.

The card art lives in `assets/` and is Vite's `publicDir`, so it ships verbatim
to `dist/Cardgame/...` and is served under the same base path as the app.

For a custom domain proxied through Cloudflare, build with `BASE_PATH=/`. On
Windows run that from PowerShell rather than Git Bash: MSYS rewrites a
leading-slash environment variable into a Windows path.

## The Cloudflare side

`worker/` holds a Durable Object, one per match, that owns the game state.
Clients connect over a WebSocket to `/api/room/<roomId>`, send intents, and get
back a view of the state with the opponent's hand, both decks and all face-down
HP replaced by a placeholder card (`src/engine/redact.ts`).

```bash
npx wrangler dev
```

What is still missing for online play: a lobby to create and share a room code,
the client-side socket that swaps `applyAction` for a send-and-await-state loop,
and reconnection.
