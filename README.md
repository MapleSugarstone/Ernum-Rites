# Ernum Rites

A card game of summons, traps, spells and debt for two to four players. The
client is a static site built for GitHub Pages. The rules engine is a pure
TypeScript module that also runs inside a Cloudflare Durable Object as the
authority for online play.

Hotseat, single-player against a bot, and online play against another person
all work today. Three or four people can share one online match in party mode.

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

**Main.** Face one card from your hand as a supporter. Sapping a supporter pays
one mana of that card's color. Place summons into your three slots. Each
draws its HP off the top of your deck as face-down cards. Cast spells, set a
field, and use the powers of any summon that is not sapped. Powers do not sap
the summon by default, though the strongest ones now print "then this one saps"
and cost the body its attack.

**Attacking.** Drag a summon onto an enemy and release. A curved arrow follows
the cursor and turns red over a legal target. Both sides deal their attack to each other and the attacker saps. HP
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
color, so free chip damage never undoes itself.

**Your leader may attack too.** It swings like a summon and takes the counter-hit
like a summon, but a leader that is *defending* deals nothing back. So attacking
with your leader spends HP you can rarely get back, and it saps the leader for the
rest of the turn. It is the button you press to close out a game rather than a habit.

**Defending.** When an attack is declared and you hold a trap, the board hands
you a prompt in the middle of the screen: spring one trap or let it through.

**Losing.** Your leader dies, or your debt reaches 25. A summon that dies adds its
level (1 to 3) to your debt, and every undrawable card adds one.

**Battlecry.** Something a summon does as it enters play prints as `Battlecry:`.

**Deathrattle.** Something a summon does as it dies prints as `Deathrattle:`. It
fires while the debt is still unpaid, so a card can discount its own death.

**Strike.** Something a summon does as it declares an attack, before the clash,
prints as `Strike:`. All three trigger words print in their own colors, and
mechanic keywords print bold, so neither reads as a power.

**Scry N** means look at the top N cards of your deck, click a matching card to
take it to your hand, and put the rest on the bottom. A scry that turns up no
match still shows you what was there before the cards go under.

**Attack** is the number a body fights with, and buffs to it are permanent
unless the card says "until end of turn" or grants it as a standing bonus
("Ally summons have +1 attack"). "Ally" on a summon's own text means your other
summons and never itself.

**Stationary.** A Stationary body never declares an attack. It still deals its
attack back when attacked, so a high-attack wall punishes anyone who swings
into it.

**Character** is the word for summons and leaders together. "Deal 1 to every
character" hits everything on the table. "Your characters" is your summons and
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

## Colors, factions and rarity

| Letter | Color | Feel |
| --- | --- | --- |
| P | Pepper (red) | Burn, board damage, spell recursion, bodies that cash themselves in |
| O | Oil (purple) | Wounds and their payoffs, curses, debt manipulation, reanimation |
| R | Robot (green) | Power Shields, armor plating, reach, taking what you want |
| F | Fish (blue) | Bounce, enemy mill, catching spent HP, fishing the dead out of debt |
| S | Solar (yellow) | Extra supporters, permanent buffs, real healing |

Each of those lists is deliberately exclusive: an effect belongs to one color,
dual cards may borrow from both of their halves, and neutral trades effects for
stats.

Nine factions run across the colors. Fish, Machine, Spirit and Living are each
one color's identity. Mortal, Scholar and Star are deliberately spread so two
colors can share a payoff without sharing a cost, and Beast and Hedron are small
and sit wherever the art does. Only a handful of cards read factions at all.

A deck may run up to 2 of any card. Rarity does not cap copies. The level a
summon prints from 1 to 3 is what carries the trade-off, so a 48-card deck is at
least 24 different cards.

Rarity is assigned per card and frozen. `RARITY_FIXED` in
[src/engine/types.ts](src/engine/types.ts) holds a tier for every card in the set
and is the only thing read at runtime, so editing a card's text never reprints it
at a different tier. `Rarities.ForCard` mirrors the table on the C# side.

The tiers come out of the training runs. Cards are ranked by how they actually
performed across a run and the top of that ranking prints at the higher tiers, so
a card's rarity reflects what it did in play rather than how long its rules text
happens to be.

`rarityForCard` still prices a card from the length of its rules text and its
level and color count. It runs only for an id the table has never seen. That
gives a newly written card a starting point and nothing more. Every card in the
set today is already in the table.

| Rarity | Cards |
| --- | --- |
| Common | 99 |
| Rare | 93 |
| Epic | 61 |
| Legendary | 51 |
| Prismatic | 1 |

Prismatic belongs to one card. Ernum carries every color and prints on a frame of
its own.

By level 66% of level 1 summons are Common, 39% of level 2 and 20% of level 3.

**Color identity.** A deck may only run cards whose colors its leader already
brings, and identity is a subset rather than an overlap. A leader brings its own
colors plus every color its costs are written in, so a leader can never demand
mana its deck is forbidden to supply. A mono-Fish leader cannot
play a Fish-and-Robot dual card, because that card would drag a color the leader
does not have. A Fish-and-Robot leader unlocks both colors and everything inside
them. Leading a deck is a seat rather than a card type: any summon with a body can take
it, so picking a dual-color summon as your leader is how you build two-color
decks. The ten triple-color legends take that to its end: nothing in the set
brings three colors except one of them, so each is the key to its own identity
and you either lead with it or never cast it. Five cards carry a `starter` flag. It marks them as the ones to hand a
player who has not built a deck yet. It is a curation hint and nothing more.

## The card set

296 cards, one for every piece of art in `assets/Cardgame`: ten level-1, ten
level-2 and ten level-3 summons per color, one of which is that color's
starter, ten spells, traps and fields per color, 51 dual-color cards across
ten color pairs, and one level 3 legend for each of the ten three-color
combinations. A test asserts that every art file is used by exactly one card and
that no card points at art the pack does not ship.

Cards are rendered with the real frames. The frame PNGs are transparent over the
art window, so the client lays the art underneath and positions name, power, HP,
rules and the artist footer on top at the exact pixel offsets the frames use.

## Card frames

The art pack ships one drawing per card shape, in blue. Every other color is
generated at load time by `src/ui/frames.ts` rather than redrawn: the blue frame
is a single hue at varying brightness, so recoloring is "read how bright this
pixel is, apply that brightness to the target hue". That keeps antialiased
edges smooth. Changing the frame art means changing one file.

The frame PNGs are transparent over the art window, so the client lays the art
underneath and positions the name, level tab, HP, rules text, flip rule and the
attack circle on top at the pixel offsets the frames use. Rules text shrinks in
steps based on how much of it there is, so a wordy card never spills over the art.

## Layout

```
src/engine/    Pure rules engine. No DOM, no network, no imports from src/ui.
src/cards/     Card definitions, one file per color plus the duals and decks.
src/ai/        The bot: one-ply search over every legal action.
src/ui/        Stylesheet and the frame recoloring for the client.
src/main.ts    The client: rendering, selection, targeting, drag arrow, bot driver.
worker/        Cloudflare Worker and the MatchRoom Durable Object.
csharp/        The same rules in C#, plus a fast test runner and simulator.
csharp/Selatza.Learn/  Networks that learn the game, and their tournament.
csharp/Selatza.Train/  The command line around it.
replays/       Recorded games both engines re-run, to catch any divergence.
conformance/   The card manifest the two engines are compared against.
tests/         Rules, card, deck, bot and cross-engine tests.
```

The engine exposes one entry point called `applyAction(state, actor, action)`.
It clones the state, validates the action and returns either the next state or a
reason it was refused. Nothing else mutates a game. That is what lets the same
code run in the browser for hotseat and in a Durable Object for online play.

Card effects are TypeScript functions rather than data, so a card can do
anything the engine can: move HP cards between summons, turn flipped cards back
down, transform a summon into something else, seize an enemy body, put a spell
into play as a summon, or push your debt onto the other player. Any target a
card needs is declared up front in `targets`. That lets the client collect the
choices before dispatching and keeps effect resolution free of continuations.

## Party mode

Three or four players can share one online match. Host a private game with the
Players toggle set to 3 Player or 4 Player and share the code. A party code
seats every guest rather than only the first, and the match starts the moment
the room fills. Party games are hosted only, so the random queue stays
head-to-head.

The rules travel almost unchanged. Everyone opens with two extra cards, the
debt limit rises from 25 to 30, and turns pass around the table in seat order.
Losing eliminates you rather than ending the game: your cards leave the board,
your turns are skipped, and you may keep watching or head back to the menu. The
last player standing wins, and the final two inherit every head-to-head ending
rule, the attacker-takes-the-trade tiebreak included. A card that says "the
enemy" makes you pick one by clicking their leader, effects that touch every
enemy or every character still touch them all, an attack's trap window goes to
whoever is being attacked, and a spell offers its window to each enemy holding
a Spell Trap in turn order until one springs. The in-game rulebook carries all
of this under section 2-3.

The engine handles any seat count with one code path: `PlayerIdx` covers four
seats, `state.players` is an array, and helpers like `livingOpponents` decide
who "the enemy side" fans out to. The interesting problem was the roughly
hundred card effects that read `c.opp` meaning the one opponent. Rather than
editing every card, the context's `opp` became a getter: an action can carry an
`enemy` pick, and when a party action arrives without one the effect runs once
against the discarded trial state with a tracking getter. If the effect reached
for its enemy, the action is refused with a `NEEDS_ENEMY` sentinel, the client
rings the enemy leaders, and one click re-sends the action with the pick
attached. Automatic triggers with no action to carry a pick fall back to a
derived enemy: the other side of the battle, then the caster of the spell being
answered, then whoever acted. Every branch collapses to the one opponent in a
duel, which is what keeps the two-player game bit-for-bit unchanged.

Party mode lives only in the TypeScript engine. The C# mirror, the replay
corpus and the balance harness stay strictly two-player, and the digest keeps
that honest by printing the new state fields only when they are set, which
never happens in a duel, so the conformance suite still pins both engines to
identical two-player strings. On the wire, the party size rides in the room's
own name, a mid-game disconnect concedes for the player who dropped and the
game goes on, and `RULES_REVISION` was bumped so a stale build cannot be
seated in a room it does not understand.

On screen the opponents' boards sit next to each other at 70% size in a
horizontal carousel: a slider under the row pans between them, the row glides
to whoever's turn begins, and one hand fan per opponent shares the top bar. A
clash between two opponents plays out sideways across their boards, riding a
stand-in pinned to the viewport so the scroller cannot clip the lunge.

## The deckbuilder

The setup screen has a Deckbuilder button. Pick a leader, and the browser shows
only what that leader's colors allow, in tabs by color with the duals last, split
into level 1, 2 and 3, then spells, traps and fields. Clicking a card adds it and
clicking it in the list on the right takes it back out. The count, the two-copy
limit and the color rule are checked as you go, and Save is refused until the
deck is legal.

The search box under the book matches a card's name, its rules text, or the name
of its rarity, so typing "legendary" finds every Legendary on the tab. Beside it
are four rarity chips. Light any of them to narrow the book to those tiers,
click one again to drop it, and lighting all four is the same as lighting none.

"Start from" copies any built-in or saved deck into the builder and is the
quickest way to begin. Saved decks live in the browser's local storage and appear
under "Your decks" on the setup screen. They are playable like any other.

**Dev mode** is a checkbox on that screen. It puts a note button on every card,
write what should change and it is held locally. Export markdown writes them all
out as one file, grouped by card, each with the card's current stats and rules
text above the notes. The result is a document someone can act on directly.

## Evolved decks

Fifteen decks in the set were built by the training tournament rather than by
hand. They come out of a run where every body that can stand as a leader is
handed to an agent and the population rebuilds its decks over seven hundred
rounds. The best deck for each color and each of the ten color pairs is kept.

They are no longer offered on the setup screen. That screen lists your saved
decks above the five hand-built starters. The evolved decks stay in
`evolvedDecks` and are still reachable by key, so an imported deck naming one
resolves.

`node scripts/export-evolved.mjs --run runs/<name>` picks them out of the run's
`ladder.json` and writes code fragments for both engines, so a fresh run can
replace them wholesale. The run also writes `timing.txt` (lift by when a card
was played), `swing.txt` (spread of each card's per-game lift), `volatility.txt`
(how far each deck's games land from what the ratings predicted) and
`archetypes.txt` (the population's decks clustered by what they actually run).
The sweeps and the replay corpus deliberately stay on the curated decks. That
is what keeps `check.cmd` quick. The legality tests cover everything.

## Playing the bot

Set Opponent to Bot on the setup screen. It plans a whole turn: a beam over the
sequences of actions the turn can hold, a rollout that looks for a kill, a greedy
model of the opponent's reply, and a term for what the board still threatens
after that. Every step applies actions to copies of the state and reads the
result, so a new card needs no bot support at all.

## Balancing the set against evolved decks

The fastest use of the trainer is with the networks switched off. A population of
agents, each stuck with a random leader and starting on a random legal deck, plays
a rated tournament and rebuilds whatever keeps losing.

```bash
npm run train -- --no-net --rounds 400 --agents 24 --games 8 --out runs/v1
```

That is about 41,000 games in thirty seconds. It writes `cards.txt` (a readable
report), `cards.csv` (diffable), `meta.csv` (deck slots per card per round, so a buff shows up here), `decks.txt` (every evolved deck) and `report.txt` (the
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

## Bots that learn the game

Double-click `train.cmd`, or:

```bash
npm run train -- --rounds 120
```

The client ships the best of these networks inside its bundle and lets it adjust
the bot's final choice each turn, so what the trainer learns reaches the game.
The client loads the best of these networks at boot and lets it adjust the shipped bot’s final choice. A population of agents plays a rated tournament against each other. Each one is
handed a leader of any level that it has to keep, fixing the colors its deck may
run, each starts on a random legal deck, and whoever comes out of a round behind
swaps cards out. Two copies of the shipped bot sit in the field on hand-built
decks at a fixed rating of 1500, so the ladder has an absolute zero.

The search is the shipped bot's. What changes is its last comparison: the search
plays the opponent's reply out against its best few end-of-turn candidates, and
a small convolutional network then adjusts the ranking of those candidates by
predicting how wrong the search's score was. Its main input is one column per
card in the set, ordered so that neighboring columns are cards competing for the
same deck slot, with the card's printed stats and its rules text boiled down to
tags underneath.

The network corrects rather than replaces for a specific reason written
up in the notes: a network asked to rank the shortlist from scratch has to beat
the evaluator at exactly the comparisons the evaluator finds hardest, and one
that is merely as good picks worse. Predicting the correction means an untrained
network predicts zero and changes nothing.

**What the bot is allowed to know.** The observation is built from one side of
the table and contains nothing that player is not entitled to. On top of that it
counts how many copies of each card the opponent has played, and against the
rarity caps and the colors their leader allows that bounds what can still be coming.
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

## The C# engine

The same rules exist a second time in `csharp/` and run about nine times
faster there. It is the harness you want for balance work, and the foundation if the
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
card manifest in `conformance/` compared field by field.

Party mode is the one deliberate gap between the two: three and four player
games exist only in TypeScript, and every two-player position still digests
identically in both engines, so the conformance suite is what proves a party
change left the duel untouched.

```bash
npm run conform
```

After a rules change the replay corpus will fail, and it should: read which games
changed, then re-record with `npm run replays:record`. After a card change
re-dump the manifest with `npm run cs:sim -- cards`.

`play.cmd` starts the game, `check.cmd` runs everything, and `cs.cmd` runs the
C# side on its own.

## Deploying the client

Push to `main`. `.github/workflows/deploy.yml` runs the tests, builds with the
asset base set to `/<repo-name>/`, and publishes to GitHub Pages. Enable Pages
with source "GitHub Actions" in the repository settings first.

The card art lives in `assets/` and is Vite's `publicDir`, so it ships verbatim
to `dist/Cardgame/...` and is served under the same base path as the app.

Build with `BASE_PATH=/` for a custom domain proxied through Cloudflare. On
Windows run that from PowerShell rather than Git Bash: MSYS rewrites a
leading-slash environment variable into a Windows path.

## The Cloudflare side

`worker/` runs the online half of the game. Two Durable Object classes back it:
`Lobby`, a single instance named `front-desk` that pairs players up, and
`MatchRoom`, one instance per match that owns the game state.

A room runs the same TypeScript rules engine the browser does. Clients open a
WebSocket to `/api/room/<roomId>`, send intents, and get back a view of the
state with the opponent's hand, both decks and all face-down HP replaced by a
placeholder card (`src/engine/redact.ts`), so the authority never hands a client
anything it should not see. A turn clock runs on Durable Object alarms and times
out a player who stops acting.

The room owns every timer. A card played on your own turn adds time back to it,
1.5 seconds for the first card and less for each one after, reaching 0 at the
tenth. The count resets on your next turn. See `playBonusMs` in
`src/engine/timing.ts`. Clients never compute the bonus themselves. They display
whatever `clock` the push carries, and the clock is not part of the digest, so it
cannot cause a desync.

Matchmaking is four POST routes onto the lobby. `/api/queue/public` joins or
opens a public room, `/api/queue/host` opens a private one and returns a code,
`/api/queue/join?code=` looks a private room up, and `/api/queue/cancel` takes a
waiting room back out of the queue. `src/net/client.ts` is the browser side of
all of them.

Hosting with `?party=3` or `?party=4` opens a party room, and `?timers=off`
opens one that runs no clocks at all. Both ride in the room's name (`prv3-`,
`prv4-`, and an `nt-` segment for a room without clocks), so the `MatchRoom`
sizes itself and decides whether to arm an alarm before the first join, and a
tampered client can only mislead a room nobody else is routed to. A head-to-head
code is consumed by its first guest. A party code stays valid for its full hour
so it can seat every guest, and the room's own "room is full" answer turns away
anyone extra. While a party room fills, everyone seated
gets a roster with each `waiting` push.

Both players have to be running the same build. `src/version.ts` derives a
version from the digest format and every printed number, cost and rules line in
the set, the client sends it with `join`, and a room refuses a seat to anything
that disagrees. It is derived rather than written down so it cannot be forgotten,
and it means a card change wants the worker deployed alongside the push: until
both are out the two halves disagree and nobody is seated.

What is still missing is reconnection. Closing a socket frees the seat in
`worker/room.ts`, so a player who drops cannot resume the match they were in.
A party room softens this without fixing it: a mid-game drop concedes for that
seat, the player is eliminated, and the match carries on for everyone else.

```bash
npx wrangler dev
```

Vite proxies `/api` to `http://127.0.0.1:8787`, socket upgrade included, so
`npm run dev` and `wrangler dev` running side by side behave like the deployed
pair.

The deployed worker is `ernum-rites-server` at
`https://ernum-rites-server.maplesugarstone.workers.dev`, published with `npx
wrangler deploy`. `ALLOWED_ORIGINS` in `wrangler.toml` lists the origins allowed
to open a socket, matched against the browser's `Origin` header, so the entries
are bare origins with no repo path. Anything not on the list gets no CORS
headers back.

The client learns that URL from `VITE_SERVER_URL`.
`.github/workflows/deploy.yml` fills it from a repository variable named
`SERVER_URL`. Left unset, the build ships with online play disabled rather than
pointing at a host that does not answer.
