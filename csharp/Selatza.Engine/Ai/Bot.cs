namespace Selatza.Ai;

public sealed class BotWeights
{
    public double LeaderHp = 8;
    public double Debt = 12;
    /// <summary>Panic term once a player is within two debt of losing.</summary>
    public double DebtCliff = 40;
    /// <summary>
    /// Charged per point a leader is below <c>LeaderCliffAt</c>, on top of the
    /// flat rate. The last points of a leader are worth more than the first, and
    /// a flat rate says otherwise: it prices nine HP spared off a leader on
    /// thirty at exactly what it prices nine spared off a leader on ten.
    /// </summary>
    public double LeaderCliff = 6;
    public double Strength = 3;
    public double Hp = 2.5;
    public double Level = 2;
    public double Wound = 2;
    public double Hand = 1.5;
    /// <summary>Extra per level above 1 for a card in hand, so a hand is not just a count.</summary>
    public double HandLevel = 1;
    /// <summary>Worth more than the card is in hand, so it always makes its land drop.</summary>
    public double Supporter = 2;
    public double Deck = 0.15;
    /// <summary>
    /// Per level 3 card still in the deck, capped. The bot reads its own deck
    /// while it plans, so "my answer is still in there" is a fact available to it
    /// rather than a guess, and a deck holding its win condition is worth more
    /// than the same number of cards without it.
    /// </summary>
    public double DeckLevel = 0.5;
    public double Stage = 3;
    /// <summary>
    /// Per point of the enemy's nearer clock the standing board could still take
    /// off next turn. Priced below <see cref="LeaderHp"/> because the opponent
    /// gets a turn to answer, which is what keeps the bot spending small Powers
    /// for chip damage while holding the pieces of something larger.
    /// </summary>
    public double Threat = 4;
    /// <summary>A kill that is already assembled but not reachable until next turn.</summary>
    public double StandingKill = 60;
    /// <summary>
    /// How much of a position's score is read after the opponent has answered
    /// it rather than where it stands. The rest is read where it stands,
    /// because the reply is a greedy guess and a position should not be judged
    /// entirely on one guess about it.
    /// </summary>
    public double Reply = 0.6;
    /// <summary>What opening a response window costs when they certainly hold a trap.</summary>
    public double TrapWindow = 12;

    public static readonly BotWeights Default = new();
}

/// <summary>
/// A searching bot, identical in shape to src/ai/bot.ts. Every part of it plays
/// actions out on copies of the state and reads the result, so it knows nothing
/// about any particular card and a new card needs no bot support at all.
///
/// Three searches run on an open turn, each covering what the others miss.
/// <see cref="Burn"/> plays the turn out choosing whichever action takes the most
/// off the enemy's clocks, and is the only part that can find a long combo,
/// because it never consults the evaluator about whether a step looks sensible.
/// <see cref="SearchTurn"/> is a beam over sequences of this turn's actions,
/// which is what orders a turn correctly: a Power fired before the body that
/// owns it attacks and saps. <see cref="ThreatBonus"/> measures what the board
/// left standing could still do if the turn came round again, which is the
/// reason to hold a combo rather than spend it for chip damage.
/// </summary>
public static class Bot
{
    private const int DeckValueCap = 20;
    /// <summary>Leader HP below which the cliff term starts charging.</summary>
    private const int LeaderCliffAt = 6;
    /// <summary>Level 3 cards in the deck counted before the term stops growing.</summary>
    private const int OutsCap = 6;
    /// <summary>Draw steps the deck-out bill is projected over.</summary>
    private const int FatigueLookahead = Rules.DrawPerTurn * 3;
    private const int MaxCombos = 48;
    /// <summary>Positions the turn search carries from one action to the next.</summary>
    private const int BeamWidth = 12;
    /// <summary>Actions deep one turn is searched.</summary>
    private const int MaxTurnDepth = 10;
    /// <summary>Applies the turn search spends before it settles for its best line.</summary>
    private const int SearchBudget = 6000;
    /// <summary>Actions the clock rollout plays out before it gives up on a kill.</summary>
    private const int MaxBurnSteps = 60;
    /// <summary>Actions the same rollout spends building up before it starts swinging.</summary>
    private const int MaxSetupSteps = 30;
    /// <summary>Actions it spends building up when it is only measuring a threat.</summary>
    private const int MaxThreatSetup = 10;
    /// <summary>Actions that rollout plays out when it is only measuring a threat.</summary>
    private const int MaxThreatSteps = 24;
    /// <summary>End-of-turn positions the opponent's reply is played out against.</summary>
    private const int ThreatLeaves = 6;
    /// <summary>Actions the opponent is given to answer a position with.</summary>
    private const int MaxReplySteps = 14;
    /// <summary>Actions deep the exhaustive kill search will look.</summary>
    private const int LethalDepth = 3;
    /// <summary>Applies that search spends before it gives up.</summary>
    private const int LethalBudget = 2500;
    /// <summary>
    /// How far short of a kill the rollout may come and still be worth an
    /// exhaustive check. The rollout takes the largest hit available at every
    /// step, which is not always the ordering that finishes.
    /// </summary>
    private const int LethalSlack = 6;
    /// <summary>A win, scored above anything the evaluator can reach.</summary>
    private const double Win = 1e9;

    /// <summary>Every opponent still playing. This engine seats two, so this is one.</summary>
    private static IEnumerable<int> LivingOpponents(GameState state, int me)
    {
        yield return GameState.Other(me);
    }

    public static double Evaluate(GameState state, int me, BotWeights? w = null)
    {
        w ??= BotWeights.Default;
        if (state.Winner == me) return 1e9;
        if (state.Winner >= 0) return -1e9;

        double score = 0;
        var sides = new List<(int Side, double Sign)> { (me, 1.0) };
        foreach (var foe in LivingOpponents(state, me)) sides.Add((foe, -1.0));

        foreach (var (side, sign) in sides)
        {
            var p = state.Players[side];

            int hp = p.Leader?.RemainingHp ?? 0;
            score += sign * w.LeaderHp * hp;
            // Graded rather than a step, so the search is not sitting on a knife
            // edge one point of damage wide.
            score -= sign * w.LeaderCliff * Math.Max(0, LeaderCliffAt - hp);

            double cliff = p.DebtCount >= Rules.DebtLimit - 2 ? w.DebtCliff : 0;
            score -= sign * (w.Debt * p.DebtCount + cliff);

            foreach (var s in p.Slots)
            {
                if (s is null) continue;
                score += sign * (w.Strength * Effects.EffectiveStrength(state, s)
                    + w.Hp * s.RemainingHp
                    + w.Level * GameState.LevelOf(s, Registry.Card(s.CardId))
                    - w.Wound * s.Wounds);
            }

            // Cards in hand are not interchangeable, and the game says so with levels.
            double hand = 0;
            foreach (var id in p.Hand) hand += w.Hand + w.HandLevel * (Registry.Card(id).Level - 1);
            score += sign * hand;

            score += sign * w.Supporter * p.Supporters.Count;
            score += sign * w.Deck * Math.Min(p.Deck.Count, DeckValueCap);

            int outs = 0;
            foreach (var id in p.Deck)
            {
                if (Registry.Card(id).Level >= 3 && ++outs >= OutsCap) break;
            }
            score += sign * w.DeckLevel * outs;

            score += sign * (p.Stage is not null ? w.Stage : 0);

            // What running dry will cost, at the price the engine will actually
            // charge for it: a bill that climbs every time this deck has already
            // done it. Charged in proportion to how near the next few draw steps
            // come to the end. The old term charged a flat debt per card missing
            // from the next two draws, which both overcharged a deck one card
            // short and could not see that a deck which had already cycled twice
            // owes three times as much for the next one.
            double near = Math.Min(1.0,
                Math.Max(0, FatigueLookahead - p.Deck.Count) / (double)FatigueLookahead);
            if (near > 0) score -= sign * w.Debt * Effects.ReshuffleCost(state, side) * near;
        }
        return score;
    }

    /// <summary>
    /// An attack that opens a trap window is judged on what happens after the
    /// window closes, assuming the trap is not sprung; otherwise the bot sees no
    /// change and never swings at anyone holding a trap.
    /// </summary>
    private static GameState Settle(GameState state)
    {
        if (state.Pending is null) return state;
        var res = Engine.Apply(state, state.Pending.Player, GameAction.PassResponse());
        return res.Ok ? res.State! : state;
    }

    private static List<TargetRef[]> TargetCombos(GameState state, int me, TargetSpec[]? specs,
        CardDef? source = null)
    {
        var combos = new List<TargetRef[]> { Array.Empty<TargetRef>() };
        if (specs is null || specs.Length == 0) return combos;
        foreach (var spec in specs)
        {
            var cands = Engine.TargetCandidates(state, me, spec, source);
            if (cands.Count == 0)
            {
                if (!spec.Optional) return new List<TargetRef[]>();
                continue;
            }
            var next = new List<TargetRef[]>();
            foreach (var b in combos)
            {
                foreach (var t in cands)
                {
                    // The engine rejects the same body picked twice in one action.
                    if (t.IsBody && Array.IndexOf(b, t) >= 0) continue;
                    var arr = new TargetRef[b.Length + 1];
                    Array.Copy(b, arr, b.Length);
                    arr[b.Length] = t;
                    next.Add(arr);
                }
            }
            combos = next.Count > MaxCombos ? next.GetRange(0, MaxCombos) : next;
        }
        return combos;
    }

    /// <summary>Battlecry targets: each spec is required only while it has a candidate.</summary>
    private static List<TargetRef[]> EnterCombos(GameState state, int me, CardDef def)
    {
        var specs = def.Targets;
        if (specs is null || specs.Length == 0) return new List<TargetRef[]> { Array.Empty<TargetRef>() };
        var lenient = specs.Select(s => new TargetSpec
        {
            Kind = s.Kind,
            Label = s.Label,
            Side = s.Side,
            IncludeLeader = s.IncludeLeader,
            Optional = true,
            Filter = s.Filter,
        }).ToArray();
        return TargetCombos(state, me, lenient, def);
    }

    public static List<GameAction> CandidateActions(GameState state, int me)
    {
        var acts = new List<GameAction>();
        var p = state.Players[me];

        // A response window outranks a queued choice, which is the order
        // CurrentActor reads them in. Checking the choice first handed no
        // candidates at all to a player whose trap window was open while
        // somebody else's choice sat at the head of the queue.
        if (state.Pending is not null)
        {
            if (state.Pending.Player != me) return acts;
            bool wantsSpellTrap = state.Pending!.Spell is not null;
            for (int i = 0; i < p.Hand.Count; i++)
            {
                var def = Registry.Card(p.Hand[i]);
                if (def.Type != CardType.Trap || !Engine.CanPay(p, Engine.CostFor(p, def))) continue;
                if (def.SpellTrap != wantsSpellTrap) continue;
                foreach (var t in TargetCombos(state, me, def.Targets, def)) acts.Add(GameAction.CastTrap(i, t));
            }
            return acts;
        }

        if (state.ChoiceQueue.Count > 0)
        {
            var ch = state.ChoiceQueue[0];
            if (ch.Player != me) return acts;
            if (ch.Cards is not null)
            {
                foreach (var index in ch.Legal ?? Array.Empty<int>())
                {
                    acts.Add(GameAction.ResolveChoice(index: index));
                }
            }
            else
            {
                foreach (var pick in ch.Refs ?? Array.Empty<TargetRef>())
                {
                    if (pick.Kind is TargetKind.Summon or TargetKind.Leader
                        && state.Find(pick) is null)
                    {
                        continue;
                    }
                    acts.Add(GameAction.ResolveChoice(pick));
                }
            }
            if (ch.Optional || acts.Count == 0) acts.Add(GameAction.ResolveChoice());
            return acts;
        }

        if (state.FlipQueue.Count > 0)
        {
            var offer = state.FlipQueue[0];
            if (offer.Player != me) return acts;
            var fcost = Registry.Card(offer.CardId).FlipCost;
            if (fcost is not null && fcost.Discard > 0)
            {
                for (int i = 0; i < p.Hand.Count; i++) acts.Add(GameAction.PayFlip(i));
            }
            else
            {
                acts.Add(GameAction.PayFlip());
            }
            return acts;
        }

        if (state.ReplaceQueue.Count > 0)
        {
            if (state.ReplaceQueue[0].Player != me) return acts;
            for (int i = 0; i < p.Hand.Count; i++)
            {
                var def = Registry.Card(p.Hand[i]);
                if (def.Type != CardType.Summon) continue;
                foreach (var t in EnterCombos(state, me, def)) acts.Add(GameAction.ReplaceSummon(i, t));
            }
            return acts;
        }

        if (state.Active != me || state.Phase != Phase.Main) return acts;

        if (p.SupportersLeft > 0)
        {
            for (int i = 0; i < p.Hand.Count; i++) acts.Add(GameAction.PlaySupporter(i));
        }

        for (int i = 0; i < p.Hand.Count; i++)
        {
            var def = Registry.Card(p.Hand[i]);
            if (def.Type == CardType.Summon)
            {
                for (int slot = 0; slot < p.Slots.Length; slot++)
                {
                    if (p.Slots[slot] is null)
                    {
                        foreach (var t in EnterCombos(state, me, def)) acts.Add(GameAction.PlaySummon(i, slot, t));
                    }
                }
            }
            else if (def.Type == CardType.Spell && Engine.CanPay(p, Engine.CostFor(p, def)))
            {
                foreach (var t in TargetCombos(state, me, def.Targets, def)) acts.Add(GameAction.CastSpell(i, t));
            }
            else if (def.Type == CardType.Stage && Engine.CanPay(p, Engine.CostFor(p, def)))
            {
                acts.Add(GameAction.PlayStage(i));
            }
        }

        var sources = new List<TargetRef>();
        for (int slot = 0; slot < p.Slots.Length; slot++)
        {
            if (p.Slots[slot] is not null) sources.Add(TargetRef.Summon(me, slot));
        }
        if (p.Leader is not null) sources.Add(TargetRef.Leader(me));
        foreach (var source in sources)
        {
            var s = state.Find(source);
            if (s is null) continue;
            var powers = GameState.PowersOf(s, Registry.Card(s.CardId));
            for (int pi = 0; pi < powers.Length; pi++)
            {
                if (Engine.PowerBlockers(state, me, source, pi) is not null) continue;
                foreach (var t in TargetCombos(state, me, powers[pi].Targets))
                {
                    acts.Add(GameAction.ActivatePower(source, pi, t));
                }
            }
        }

        foreach (var attacker in Engine.ReadyAttackers(state, me))
        {
            foreach (var target in Engine.LegalAttackTargets(state, attacker))
            {
                acts.Add(GameAction.DeclareAttack(attacker, target));
            }
        }

        return acts;
    }

    private static GameAction PassAction(GameState state)
    {
        if (state.Pending is not null) return GameAction.PassResponse();
        if (state.ChoiceQueue.Count > 0)
        {
            var ch = state.ChoiceQueue[0];
            if (ch.Optional) return GameAction.ResolveChoice();
            if (ch.Cards is not null)
            {
                return GameAction.ResolveChoice(
                    index: ch.Legal is { Length: > 0 } l ? l[0] : null);
            }
            foreach (var r in ch.Refs ?? Array.Empty<TargetRef>())
            {
                if (r.Kind is TargetKind.Summon or TargetKind.Leader && state.Find(r) is null)
                {
                    continue;
                }
                return GameAction.ResolveChoice(r);
            }
            return GameAction.ResolveChoice();
        }
        if (state.FlipQueue.Count > 0) return GameAction.DeclineFlip();
        if (state.ReplaceQueue.Count > 0) return GameAction.DeclineReplace();
        return GameAction.EndTurn();
    }

    /// <summary>
    /// A prior on cards nobody has seen. A deck is about fifty cards drawn from a
    /// legal pool many times that size, so a card that has never surfaced is far
    /// less likely to be in there than one whose other copy is already in the
    /// discard. Cards that have shown up count in full and the rest count at this.
    /// </summary>
    private const double UnseenWeight = 0.25;

    public sealed class EnemyRead
    {
        /// <summary>Share of the cards they could still be holding that are traps.</summary>
        public double TrapDensity;
        /// <summary>The cheapest trap their colours still allow them to be holding.</summary>
        public CardDef? CheapestTrap;
        /// <summary>The seat this read is about.</summary>
        public int Seat;
    }

    /// <summary>One read per living opponent: any of them can spring a trap.</summary>
    public static List<EnemyRead> ReadTable(GameState state, int me)
    {
        var reads = new List<EnemyRead>();
        foreach (var foe in LivingOpponents(state, me)) reads.Add(ReadEnemy(state, foe));
        return reads;
    }

    /// <summary>
    /// What the opponent's public zones say about the deck behind them.
    ///
    /// Everything read here is face up to both players: the discard pile, the
    /// bodies they owe debt for, their board and supporters and stage, and every
    /// HP card that has been flipped. Their hand and the order of their deck are
    /// not read.
    ///
    /// Their leader is face up from turn one and fixes the colours their deck may
    /// run, so the pool is known exactly. What is not known is which of it they
    /// actually built with, and every card that surfaces settles a little more of
    /// that: a card in the discard is proof its other copy is in the deck, where
    /// a card nobody has seen is only proof that it was allowed.
    /// </summary>
    public static EnemyRead ReadEnemy(GameState state, int seat)
    {
        var foe = state.Players[seat];
        var pool = PoolBehind(foe.LeaderCardId);
        if (pool.Total <= 0) return new EnemyRead { Seat = seat };

        var seen = new Dictionary<string, int>(StringComparer.Ordinal);
        void Note(string id)
        {
            if (pool.Legal.Contains(id)) seen[id] = seen.GetValueOrDefault(id) + 1;
        }

        foreach (var id in foe.Discard) Note(id);
        foreach (var id in foe.DebtZone) Note(id);
        foreach (var sup in foe.Supporters) Note(sup.CardId);
        if (foe.Stage is not null) Note(foe.Stage);
        foreach (var b in foe.Slots.Append(foe.Leader))
        {
            if (b is null) continue;
            Note(b.CardId);
            // An HP card is face down until something flips it, and face up after.
            foreach (var h in b.Hp) if (h.Flipped) Note(h.CardId);
        }

        // The pool above counted every card as unseen. Only the handful that
        // have actually surfaced need correcting, which is what keeps this off
        // the whole set on every plan.
        double total = pool.Total, traps = pool.Traps;
        foreach (var (id, shown) in seen)
        {
            int left = Math.Max(0, Rarities.CopyLimit - shown);
            double delta = left - Rarities.CopyLimit * UnseenWeight;
            total += delta;
            if (Registry.Card(id).Type == CardType.Trap) traps += delta;
        }

        return new EnemyRead
        {
            TrapDensity = total > 0 ? Math.Clamp(traps / total, 0, 1) : 0,
            CheapestTrap = pool.CheapestTrap,
            Seat = seat,
        };
    }

    private sealed class LeaderPool
    {
        /// <summary>Every collectible card the leader's colours allow.</summary>
        public HashSet<string> Legal = new(StringComparer.Ordinal);
        /// <summary>Weight of the whole pool with nothing yet seen.</summary>
        public double Total;
        /// <summary>The trap share of that weight.</summary>
        public double Traps;
        public CardDef? CheapestTrap;
    }

    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, LeaderPool>
        PoolCache = new(StringComparer.Ordinal);

    /// <summary>
    /// The card pool a leader allows, which is fixed the moment the leader is
    /// turned face up and is the same in every game that leader is played in.
    /// Held rather than rebuilt, because walking the whole set on every plan cost
    /// more than every search in the bot put together.
    /// </summary>
    private static LeaderPool PoolBehind(string leaderCardId) =>
        PoolCache.GetOrAdd(leaderCardId, static id =>
        {
            var identity = Identity.DeckIdentity(id);
            var built = new LeaderPool();
            int cheapestPips = int.MaxValue;

            foreach (var def in Registry.All)
            {
                if (def.Uncollectible) continue;
                if (!Identity.IsLegalUnder(def, identity)) continue;
                built.Legal.Add(def.Id);
                double weight = Rarities.CopyLimit * UnseenWeight;
                built.Total += weight;
                if (def.Type != CardType.Trap) continue;
                built.Traps += weight;
                int pips = def.Cost.Total;
                if (pips < cheapestPips)
                {
                    cheapestPips = pips;
                    built.CheapestTrap = def;
                }
            }
            return built;
        });

    /// <summary>
    /// How likely they are holding a trap they could pay for right now.
    ///
    /// The second half is what makes this worth reading rather than guessing. A
    /// trap somewhere in their colours is a fact about the set; a trap they have
    /// the unsapped supporters to cast this instant is a fact about the attack
    /// being declared.
    /// </summary>
    private static double TrapRisk(GameState state, List<EnemyRead> reads)
    {
        double worst = 0;
        foreach (var read in reads)
        {
            var foe = state.Players[read.Seat];
            if (foe.Hand.Count == 0 || read.TrapDensity <= 0 || read.CheapestTrap is null) continue;
            if (!Engine.CanPay(foe, Engine.CostFor(foe, read.CheapestTrap))) continue;
            double risk = 1 - Math.Pow(1 - read.TrapDensity, foe.Hand.Count);
            if (risk > worst) worst = risk;
        }
        return worst;
    }

    /// <summary>Whether there is any of my own turn left to search.</summary>
    private static bool TurnGoesOn(GameState state, int me)
        => !state.IsOver && state.Active == me && state.Pending is null;

    private static int LeaderHpOf(GameState state, int side)
        => state.Players[side].Leader?.RemainingHp ?? 0;

    /// <summary>
    /// How much of a player's nearer clock one action consumed, as a fraction of
    /// what was left of it.
    ///
    /// Both routes to a loss count. A line that piles debt on the opponent ends
    /// the game as surely as one that empties their leader, and a rollout
    /// watching only leader HP would walk past every deck built the other way.
    /// Measuring each as a fraction of its own remaining clock puts the two on
    /// one scale without having to claim an exchange rate between a point of HP
    /// and a point of debt.
    /// </summary>
    private static double ProgressAgainst(GameState before, GameState after, int me)
    {
        double total = 0;
        foreach (var foe in LivingOpponents(before, me))
        {
            var was = before.Players[foe];
            var now = after.Players[foe];
            int hpWas = was.Leader?.RemainingHp ?? 0;
            int hpNow = now.Leader?.RemainingHp ?? 0;
            int debtLeft = Rules.DebtLimit - was.DebtCount;
            total += (hpWas - hpNow) / (double)Math.Max(1, hpWas)
                + (now.DebtCount - was.DebtCount) / (double)Math.Max(1, debtLeft);
        }
        return total;
    }

    /// <summary>The leader closest to falling, which a threat is measured against.</summary>
    private static int NearestFoeHp(GameState state, int me)
    {
        int least = int.MaxValue;
        foreach (var foe in LivingOpponents(state, me))
        {
            int hp = LeaderHpOf(state, foe);
            if (hp < least) least = hp;
        }
        return least == int.MaxValue ? 0 : least;
    }

    /// <summary>
    /// What a position could still be turned into: bodies that can still act,
    /// cards that can still be played, mana that can still be spent.
    ///
    /// Deliberately silent about the harm a line does to its owner, because the
    /// rollout it ranks is asking how much damage this turn can be made to hold
    /// rather than whether the board is in good order afterwards. A Power that
    /// mills you and takes a debt to draw a card is a loss on every term the
    /// evaluator carries, and it is also how a body whose attack scales with
    /// your own debt reaches the number that ends the game.
    /// </summary>
    private static double Potential(GameState state, int me)
    {
        var p = state.Players[me];
        double total = 0;
        foreach (var s in p.Slots)
        {
            if (s is not null && !s.Sapped) total += Effects.EffectiveStrength(state, s);
        }
        if (p.Leader is { Sapped: false }) total += Effects.EffectiveStrength(state, p.Leader);
        total += p.Hand.Count;
        foreach (int pips in Engine.AvailableMana(p)) total += pips;
        return total;
    }

    /// <summary>Whether an action hands the game to the opponent or ends it level.</summary>
    private static bool LosesIt(GameState state, int me)
        => state.Drawn || (state.Winner >= 0 && state.Winner != me);

    private sealed class Rollout
    {
        public GameState State = null!;
        /// <summary>Every action of the line, in order.</summary>
        public List<GameAction> Line = new();
        /// <summary>Points taken off the enemy leader over the whole line.</summary>
        public int Damage;
    }

    /// <summary>
    /// Play the turn out taking whichever action pushes the opponent furthest
    /// towards a loss, breaking ties on the evaluator.
    ///
    /// Greedy on the clocks rather than on the evaluator, and that is the point
    /// of it. A recursion loop scores every one of its own steps as a loss: a
    /// body that deals damage when it dies and returns to hand costs a body and
    /// a debt each time round, so the evaluator marks every cycle down and only
    /// the last one is a win. A beam ordered by the evaluator prunes such a line
    /// at its first step however wide the beam is, because the line never looks
    /// good until it is over. This is the search that can follow one.
    ///
    /// It stops once nothing on offer either hurts the opponent or improves the
    /// board, so a line that has run out of cycles does not spend the rest of
    /// its budget shuffling.
    ///
    /// <paramref name="setup"/> is how many actions it may spend climbing
    /// <see cref="Potential"/> before it starts swinging. Greedy on damage from
    /// the first action is greedy too early: a body whose attack rises with your
    /// own debt wants every free Power fired first, and a rollout that took the
    /// largest hit available immediately would cash it at half size. Called with
    /// zero it strikes at once, which is the right line about as often, so both
    /// are tried and whichever kills is the one used.
    /// </summary>
    private static Rollout Burn(GameState state, int me, int steps, BotWeights w, int setup = 0)
    {
        // Damage is tracked per seat and reported as the worst any one of them
        // took, because a threat is a threat against somebody in particular.
        var startHp = new Dictionary<int, int>();
        foreach (var f in LivingOpponents(state, me)) startHp[f] = LeaderHpOf(state, f);
        int WorstDrop(GameState at)
        {
            int worst = 0;
            foreach (var (f, was) in startHp)
            {
                int drop = was - LeaderHpOf(at, f);
                if (drop > worst) worst = drop;
            }
            return worst;
        }
        var line = new List<GameAction>();
        var cur = state;

        for (int step = 0; step < setup; step++)
        {
            if (!TurnGoesOn(cur, me)) break;
            GameAction? built = null;
            GameState? builtState = null;
            double best = Potential(cur, me);

            foreach (var action in CandidateActions(cur, me))
            {
                var res = Engine.Apply(cur, me, action);
                if (!res.Ok) continue;
                var after = Settle(res.State!);
                if (after.Winner == me)
                {
                    line.Add(action);
                    return new Rollout { State = after, Line = line, Damage = WorstDrop(after) };
                }
                if (LosesIt(after, me)) continue;
                double pot = Potential(after, me);
                if (pot > best + 1e-9)
                {
                    best = pot;
                    built = action;
                    builtState = after;
                }
            }

            if (built is null || builtState is null) break;
            line.Add(built);
            cur = builtState;
        }

        for (int step = 0; step < steps; step++)
        {
            if (!TurnGoesOn(cur, me)) break;
            double standingStill = Evaluate(cur, me, w);
            GameAction? pick = null;
            GameState? pickState = null;
            double bestGain = double.NegativeInfinity;
            double bestBoard = double.NegativeInfinity;

            foreach (var action in CandidateActions(cur, me))
            {
                var res = Engine.Apply(cur, me, action);
                if (!res.Ok) continue;
                var after = Settle(res.State!);
                if (after.Winner == me)
                {
                    line.Add(action);
                    return new Rollout { State = after, Line = line, Damage = WorstDrop(after) };
                }
                if (LosesIt(after, me)) continue;
                double gain = ProgressAgainst(cur, after, me);
                double board = Evaluate(after, me, w);
                if (gain > bestGain + 1e-9 || (Math.Abs(gain - bestGain) <= 1e-9 && board > bestBoard))
                {
                    bestGain = gain;
                    bestBoard = board;
                    pick = action;
                    pickState = after;
                }
            }

            if (pick is null || pickState is null) break;
            if (bestGain <= 1e-9 && bestBoard <= standingStill) break;
            line.Add(pick);
            cur = pickState;
        }

        return new Rollout { State = cur, Line = line, Damage = WorstDrop(cur) };
    }

    /// <summary>
    /// The position at the start of my next turn, with the opponent having taken
    /// theirs against it.
    ///
    /// Everything else in the bot stops when my own turn does, which leaves it
    /// unable to price the two things a turn costs rather than gains. A body put
    /// down is worth its stat line and never the debt its funeral will charge,
    /// and a body that returns to hand when it dies scores exactly what a body
    /// of the same stats that stays dead scores.
    ///
    /// The opponent's turn is played greedily on their own reading of the board,
    /// which is a guess and not a search. That is what <c>w.Reply</c> is for: it
    /// is the share of a position's score read from here rather than from where
    /// the position stands, and it is not 1.
    /// </summary>
    private static GameState? NextTurn(GameState state, int me, BotWeights w)
    {
        int from = state.Players[me].TurnsTaken;
        var s = state;

        for (int i = 0; i < 24; i++)
        {
            if (s.IsOver) return s;
            if (s.Players[me].TurnsTaken > from
                && s.Active == me
                && s.Pending is null
                && s.ChoiceQueue.Count == 0
                && s.FlipQueue.Count == 0
                && s.ReplaceQueue.Count == 0)
            {
                return s;
            }
            // Every seat between me and my next turn spends its own, not just
            // the one opposite.
            if (s.Active != me && s.Pending is null && s.Phase == Phase.Main)
            {
                int seat = s.Active;
                s = ReplyOf(s, seat, w);
                if (s.IsOver) return s;
                if (s.Active == seat && s.Phase == Phase.Main && s.Pending is null)
                {
                    var ended = Engine.Apply(s, seat, GameAction.EndTurn());
                    if (!ended.Ok) return null;
                    s = ended.State!;
                }
                continue;
            }
            int actor = s.CurrentActor;
            var res = Engine.Apply(s, actor, PassAction(s));
            if (!res.Ok) return null;
            s = res.State!;
        }
        return null;
    }

    /// <summary>
    /// One opponent's turn.
    ///
    /// Their combos are looked for the same way mine are, and this is the reason.
    /// A purely greedy reply is exactly as blind as this bot was before the
    /// rollout existed: every step of a recursion loop scores as a loss, so greed
    /// refuses the first of them and a position that is about to be killed reads
    /// as safe. Modelling the opponent as a weaker player than yourself is how
    /// you walk into the line you just taught yourself to play.
    /// </summary>
    private static GameState ReplyOf(GameState state, int foe, BotWeights w)
    {
        var race = Burn(state, foe, MaxBurnSteps, w);
        if (race.State.Winner == foe) return race.State;
        var built = Burn(state, foe, MaxBurnSteps, w, MaxSetupSteps);
        if (built.State.Winner == foe) return built.State;

        var s = state;
        for (int step = 0; step < MaxReplySteps; step++)
        {
            if (!TurnGoesOn(s, foe)) break;
            GameState? pick = null;
            double best = Evaluate(s, foe, w);
            foreach (var action in CandidateActions(s, foe))
            {
                var res = Engine.Apply(s, foe, action);
                if (!res.Ok) continue;
                var after = Settle(res.State!);
                double score = Evaluate(after, foe, w);
                if (score > best + 1e-6)
                {
                    best = score;
                    pick = after;
                }
            }
            if (pick is null) break;
            s = pick;
        }
        return s;
    }

    /// <summary>
    /// What holding a position is worth on top of what it already is: the damage
    /// the standing board could still deal next turn, plus a lump for a kill
    /// that is assembled and only waiting for the turn to come round.
    ///
    /// This is the term that stops the bot cashing a combo for chip damage.
    /// Firing a body's Power for eight to the face and losing the body scores
    /// about what holding it does, so the body it keeps decides the comparison,
    /// and once the enemy leader drops inside range the kill search takes over.
    /// </summary>
    private static double Outlook(GameState state, int me, BotWeights w, double standing)
    {
        var next = state.IsOver ? state : NextTurn(state, me, w);
        if (next is null) return standing;
        double settled = (1 - w.Reply) * standing + w.Reply * Evaluate(next, me, w);
        if (next.IsOver) return settled;

        int foeHp = NearestFoeHp(next, me);
        if (foeHp <= 0) return settled;
        int reach = Math.Max(
            Burn(next, me, MaxThreatSteps, w).Damage,
            Burn(next, me, MaxThreatSteps, w, MaxThreatSetup).Damage);
        if (reach <= 0) return settled;
        return settled + w.Threat * Math.Min(reach, foeHp)
            + (reach >= foeHp ? w.StandingKill : 0);
    }

    private sealed class Leaf
    {
        public GameState State = null!;
        /// <summary>Every action of the turn up to this position, in order.</summary>
        public List<GameAction> Line = new();
        /// <summary>Charged for every response window the line opened along the way.</summary>
        public double Risk;
        public double Score;
    }

    /// <summary>
    /// A beam over the sequences of actions one turn can hold, scored by the
    /// evaluator at the point the turn would end.
    ///
    /// Every position reached is a leaf, because stopping there and ending the
    /// turn is always legal. Ending the turn is scored where it stands rather
    /// than after the opponent has been handed the turn: a value function asked
    /// to compare across the turn boundary answers a different question on each
    /// side of it.
    ///
    /// Positions are deduplicated by digest, so the many orderings of one set of
    /// actions cost a single slot in the beam instead of filling it.
    /// </summary>
    private static List<Leaf> SearchTurn(GameState state, int me, BotWeights w, List<EnemyRead> reads)
    {
        var leaves = new List<Leaf>();
        var seen = new HashSet<string>();
        var level = new List<Leaf> { new Leaf { State = state, Line = new List<GameAction>() } };
        int spent = 0;

        for (int depth = 0; depth < MaxTurnDepth && spent < SearchBudget; depth++)
        {
            var next = new List<Leaf>();
            foreach (var node in level)
            {
                foreach (var action in CandidateActions(node.State, me))
                {
                    if (spent >= SearchBudget) break;
                    var res = Engine.Apply(node.State, me, action);
                    spent++;
                    if (!res.Ok) continue;
                    var after = Settle(res.State!);
                    var line = new List<GameAction>(node.Line) { action };
                    if (after.Winner == me)
                    {
                        return new List<Leaf> { new Leaf { State = after, Line = line, Score = Win } };
                    }
                    // Settling assumed the trap was not sprung. This is what that
                    // assumption is worth, charged once per window the line opened.
                    double risk = node.Risk + (res.State!.Pending is not null
                        ? w.TrapWindow * TrapRisk(res.State!, reads)
                        : 0);
                    var leaf = new Leaf
                    {
                        State = after,
                        Line = line,
                        Risk = risk,
                        Score = Evaluate(after, me, w) - risk,
                    };
                    leaves.Add(leaf);
                    if (TurnGoesOn(after, me)) next.Add(leaf);
                }
            }
            if (next.Count == 0) break;
            next.Sort((a, b) => b.Score.CompareTo(a.Score));
            level = new List<Leaf>();
            foreach (var leaf in next)
            {
                if (level.Count >= BeamWidth) break;
                if (!seen.Add(Digest.Of(leaf.State))) continue;
                level.Add(leaf);
            }
            if (level.Count == 0) break;
        }

        leaves.Sort((a, b) => b.Score.CompareTo(a.Score));
        return leaves;
    }

    /// <summary>
    /// Depth-first search for a line that ends the game this turn.
    ///
    /// The rollout above finds most kills and finds the long ones, but it
    /// commits to the largest hit at every step and some kills need a smaller
    /// one first. This covers those exhaustively over the actions that can carry
    /// damage, a small enough branching factor to be worth doing whenever a kill
    /// is close.
    /// </summary>
    private static GameAction? FindLethal(GameState state, int me, int depth, ref int budget)
    {
        if (depth <= 0 || budget <= 0 || !TurnGoesOn(state, me)) return null;
        foreach (var action in CandidateActions(state, me))
        {
            if (action.Type is not (ActionType.ActivatePower or ActionType.DeclareAttack
                or ActionType.CastSpell)) continue;
            if (budget <= 0) break;
            budget--;
            var res = Engine.Apply(state, me, action);
            if (!res.Ok) continue;
            var after = Settle(res.State!);
            if (after.Winner == me) return action;
            if (FindLethal(after, me, depth - 1, ref budget) is not null) return action;
        }
        return null;
    }

    /// <summary>
    /// The turn the searches settled on, and the position it expects to be
    /// handed next.
    ///
    /// A turn is planned once and then followed rather than re-derived before
    /// every action. Re-deriving costs the whole search five or six times a turn
    /// for an answer that hardly ever changes. The plan is followed only while
    /// the position matches the digest it was built against, so a sprung trap or
    /// any other surprise throws it out and plans again.
    ///
    /// Thread-static because the tournament plays games in parallel and a shared
    /// plan would have one game following another game's turn.
    /// </summary>
    private sealed class Plan
    {
        public int Me;
        /// <summary>Digest of the position this plan's next action belongs to.</summary>
        public string Key = "";
        public List<GameAction> Line = new();
    }

    [ThreadStatic] private static Plan? _plan;

    /// <summary>Forget the planned turn. Exposed so a test can time one decision alone.</summary>
    public static void ClearPlan() => _plan = null;

    /// <summary>The next action of the standing plan, or null if there is nothing to follow.</summary>
    private static GameAction? Follow(GameState state, int me, string key)
    {
        var p = _plan;
        if (p is null || p.Me != me || p.Key != key) return null;
        if (p.Line.Count == 0)
        {
            _plan = null;
            return null;
        }
        var next = p.Line[0];
        p.Line.RemoveAt(0);
        var res = Engine.Apply(state, me, next);
        if (!res.Ok)
        {
            _plan = null;
            return null;
        }
        var after = Settle(res.State!);
        // A card arriving in hand is a set of options the rest of this plan was
        // ranked without, and the plan's tail had the least search left of any
        // of it. Draw one, mint one or take one back, and the turn is planned
        // again.
        if (!SameHand(state.Players[me].Hand, after.Players[me].Hand))
        {
            _plan = null;
            return next;
        }
        p.Key = Digest.Of(after);
        return next;
    }

    private static bool SameHand(List<string> before, List<string> after)
    {
        if (before.Count != after.Count) return false;
        for (int i = 0; i < before.Count; i++)
        {
            if (before[i] != after[i]) return false;
        }
        return true;
    }

    /// <summary>Adopt a line as the plan and hand back its first action.</summary>
    private static GameAction? Begin(GameState state, int me, string key, List<GameAction> line)
    {
        if (line.Count == 0) return null;
        _plan = new Plan { Me = me, Key = key, Line = new List<GameAction>(line) };
        return Follow(state, me, key);
    }

    public static GameAction ChooseAction(GameState state, int me, BotWeights? w = null)
    {
        w ??= BotWeights.Default;
        var pass = PassAction(state);

        // In a response window, standing still means letting the attack resolve,
        // so that outcome is the bar a trap has to beat. One ply is the right
        // depth here, because the rest of the turn is not mine to plan.
        if (state.Pending is not null)
        {
            _plan = null;
            var passed = Engine.Apply(state, me, pass);
            var bestTrap = pass;
            double bar = Evaluate(passed.Ok ? passed.State! : state, me, w);
            foreach (var action in CandidateActions(state, me))
            {
                var res = Engine.Apply(state, me, action);
                if (!res.Ok) continue;
                double score = Evaluate(Settle(res.State!), me, w);
                if (score > bar + 1e-6)
                {
                    bar = score;
                    bestTrap = action;
                }
            }
            return bestTrap;
        }

        string key = Digest.Of(state);
        if (Follow(state, me, key) is { } planned) return planned;

        // Built once. It reads their public zones, which my own turn barely moves.
        var reads = ReadTable(state, me);

        // A kill this turn beats anything the evaluator can score, and it is the
        // one thing the evaluator cannot see: a play that converts the whole
        // board into exactly enough damage reads as a small gain, not as a win.
        var race = Burn(state, me, MaxBurnSteps, w);
        if (race.State.Winner == me && Begin(state, me, key, race.Line) is { } finisher)
        {
            return finisher;
        }
        var built = Burn(state, me, MaxBurnSteps, w, MaxSetupSteps);
        if (built.State.Winner == me && Begin(state, me, key, built.Line) is { } assembled)
        {
            return assembled;
        }
        if (Math.Max(race.Damage, built.Damage) + LethalSlack >= NearestFoeHp(state, me))
        {
            int budget = LethalBudget;
            if (FindLethal(state, me, LethalDepth, ref budget) is { } kill) return kill;
        }

        // Otherwise take the best turn the beam found, judged on where it leaves
        // the board, on what survives the opponent's answer, and on what still
        // threatens them after that. Standing still is one of the candidates
        // rather than a bar the others have to clear, so holding a combo and
        // spending it are compared the same way.
        var stand = new Leaf { State = state, Line = new List<GameAction>(), Score = Evaluate(state, me, w) };
        var ranked = new List<Leaf> { stand };
        var seen = new HashSet<string> { key };
        foreach (var leaf in SearchTurn(state, me, w, reads))
        {
            if (leaf.Score >= Win && Begin(state, me, key, leaf.Line) is { } won) return won;
            if (ranked.Count > ThreatLeaves) break;
            if (!seen.Add(Digest.Of(leaf.State))) continue;
            ranked.Add(leaf);
        }
        ranked.Sort((a, b) => b.Score.CompareTo(a.Score));

        // Playing the reply out costs a turn of simulation apiece, which is why
        // only the handful of leaves gathered above get one.
        var best = stand;
        double bestScore = double.NegativeInfinity;
        foreach (var leaf in ranked)
        {
            double total = Outlook(leaf.State, me, w, leaf.Score);
            if (total > bestScore + 1e-6)
            {
                bestScore = total;
                best = leaf;
            }
        }

        return Begin(state, me, key, best.Line) ?? pass;
    }
}
