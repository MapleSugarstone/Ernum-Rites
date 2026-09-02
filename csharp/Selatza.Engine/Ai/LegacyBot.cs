// TEMPORARY: the pre-search bot, kept only to measure the new one against.
namespace Selatza.Ai;

public sealed class LegacyBotWeights
{
    public double LeaderHp = 8;
    public double Debt = 12;
    /// <summary>Panic term once a player is within two debt of losing.</summary>
    public double DebtCliff = 40;
    public double Strength = 3;
    public double Hp = 2.5;
    public double Level = 2;
    public double Wound = 2;
    public double Hand = 1.5;
    /// <summary>Worth more than the card is in hand, so it always makes its land drop.</summary>
    public double Supporter = 2;
    public double Deck = 0.15;
    public double Stage = 3;

    public static readonly LegacyBotWeights Default = new();
}

/// <summary>
/// A one-ply bot, identical in shape to src/ai/bot.ts. It enumerates every legal
/// action, plays each one out on a copy of the state, scores the result and keeps
/// the best improvement, so a new card needs no bot support at all.
/// </summary>
public static class LegacyBot
{
    private const int DeckValueCap = 20;
    private const int MaxCombos = 48;
    /// <summary>Attacks the follow-up probe will simulate before it stops.</summary>
    private const int MaxStrikeSteps = 6;
    /// <summary>Bodies the follow-up probe will rebuild before it swings.</summary>
    private const int MaxDevelopSteps = 4;
    /// <summary>Actions deep the lethal search will look for a kill.</summary>
    private const int LethalDepth = 2;
    /// <summary>Damage a Power or spell might add on top of combat, for the gate.</summary>
    private const int LethalSlack = 4;

    public static double Evaluate(GameState state, int me, LegacyBotWeights? w = null)
    {
        w ??= LegacyBotWeights.Default;
        if (state.Winner == me) return 1e9;
        if (state.Winner >= 0) return -1e9;

        double score = 0;
        foreach (var side in new[] { me, GameState.Other(me) })
        {
            double sign = side == me ? 1 : -1;
            var p = state.Players[side];

            score += sign * w.LeaderHp * (p.Leader?.RemainingHp ?? 0);

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

            score += sign * w.Hand * p.Hand.Count;
            score += sign * w.Supporter * p.Supporters.Count;
            score += sign * w.Deck * Math.Min(p.Deck.Count, DeckValueCap);
            score += sign * (p.Stage is not null ? w.Stage : 0);

            // A one-ply search cannot see fatigue coming, so charge for the cards
            // the next two draw steps would be short by.
            int shortfall = Math.Max(0, Rules.DrawPerTurn * 2 - p.Deck.Count);
            score -= sign * w.Debt * shortfall;
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
    /// What the rest of this turn could still be worth: swing with everything,
    /// strongest body first, at the leader when it is exposed and at the
    /// cheapest kill otherwise.
    ///
    /// Scoring a play on the state right after it stops before the attack step,
    /// so every line that reads "use the Power, then hit them" was judged as if
    /// the second half never happened. Set Sail empties the board and the leader
    /// is only attackable once the slots in front of it are empty, so one ply
    /// saw a board wipe that bounced its own summons too and scored it as
    /// roughly nothing.
    /// </summary>
    /// <summary>
    /// Rebuild the board before swinging. Set Sail bounces the attacker's own
    /// bodies back to hand and saps the Ship, so a probe that only attacked
    /// found nothing left to attack with and scored the play as a loss. Bodies
    /// arrive able to swing unless they print otherwise, so replaying them and
    /// then hitting is the line the card is actually for.
    /// </summary>
    private static GameState Develop(GameState state, int me)
    {
        for (int step = 0; step < MaxDevelopSteps; step++)
        {
            if (state.IsOver || state.Active != me || state.Pending is not null) break;
            if (state.ChoiceQueue.Count > 0)
            {
                // A battlecry stopped to ask something; take the first offer so
                // the probe can carry on rather than stalling mid-play.
                var acts = CandidateActions(state, me);
                if (acts.Count == 0) break;
                var settled = Engine.Apply(state, me, acts[0]);
                if (!settled.Ok) break;
                state = settled.State!;
                continue;
            }
            // Built here rather than filtered out of CandidateActions: that
            // builds every spell target combo and attack pairing too, and this
            // runs once per candidate per probe.
            var p = state.Players[me];
            int slot = -1;
            for (int k = 0; k < p.Slots.Length; k++)
            {
                if (p.Slots[k] is null) { slot = k; break; }
            }
            if (slot < 0) break;
            int bestHand = -1, bestKey = -1;
            for (int h = 0; h < p.Hand.Count; h++)
            {
                var def = Registry.Card(p.Hand[h]);
                if (def.Type != CardType.Summon) continue;
                int key = def.Level * 100 + def.Strength;
                if (key <= bestKey) continue;
                bestKey = key;
                bestHand = h;
            }
            if (bestHand < 0) break;
            var combos = EnterCombos(state, me, Registry.Card(p.Hand[bestHand]));
            if (combos.Count == 0) break;
            var pick = GameAction.PlaySummon(bestHand, slot, combos[0]);
            var res = Engine.Apply(state, me, pick);
            if (!res.Ok) break;
            state = Settle(res.State!);
        }
        return state;
    }

    private static GameState AlphaStrike(GameState state, int me, LegacyBotWeights w)
    {
        state = Develop(state, me);
        for (int step = 0; step < MaxStrikeSteps; step++)
        {
            if (state.IsOver || state.Active != me || state.Pending is not null) break;
            GameAction? pick = null;
            int bestStrength = -1;
            foreach (var atkRef in Engine.ReadyAttackers(state, me))
            {
                var atk = state.Find(atkRef);
                if (atk is null) continue;
                int str = Effects.EffectiveStrength(state, atk);
                if (str <= bestStrength) continue;
                var targets = Engine.LegalAttackTargets(state, atkRef);
                if (targets.Count == 0) continue;
                var aim = targets[0];
                int softest = int.MaxValue;
                foreach (var t in targets)
                {
                    if (t.Kind == TargetKind.Leader) { aim = t; break; }
                    var body = state.Find(t);
                    if (body is not null && body.RemainingHp < softest)
                    {
                        softest = body.RemainingHp;
                        aim = t;
                    }
                }
                bestStrength = str;
                pick = GameAction.DeclareAttack(atkRef, aim);
            }
            if (pick is null) break;
            var res = Engine.Apply(state, me, pick);
            if (!res.Ok) break;
            state = Settle(res.State!);
        }
        return state;
    }

    /// <summary>
    /// Whether a kill is close enough to be worth searching for. Combat reach is
    /// an overestimate, since the leader is only attackable once the slots in
    /// front of it are empty, but this only has to be permissive: it is a filter
    /// that keeps the search off the great majority of turns, not a judgement.
    /// </summary>
    private static bool LethalPlausible(GameState state, int me)
    {
        var foe = state.Players[GameState.Other(me)];
        if (foe.Leader is null) return false;
        // Combat cannot touch the leader while anything stands in front of it,
        // so attack strength only counts toward reach on an empty board. With
        // bodies up, only a Power or spell can finish, which is the slack.
        foreach (var s in foe.Slots)
        {
            if (s is not null) return foe.Leader.RemainingHp <= LethalSlack;
        }
        int reach = 0;
        foreach (var r in Engine.ReadyAttackers(state, me))
        {
            var body = state.Find(r);
            if (body is not null) reach += Effects.EffectiveStrength(state, body);
        }
        return foe.Leader.RemainingHp <= reach + LethalSlack;
    }

    /// <summary>
    /// Depth-first search for a line that ends the game this turn, returning the
    /// action that starts it.
    ///
    /// The evaluator scores leader HP at a flat rate per point, so a play that
    /// converts a body into exactly enough face damage reads as a small gain
    /// rather than as a win. Nothing else in the bot can see lethal: the
    /// follow-up probe only replays bodies and swings, so any kill needing a
    /// Power was invisible. Helemy could fire Alchemize with the mana and a body
    /// to spend and declined in 99.8% of those turns.
    ///
    /// Only damage-carrying actions are searched, which keeps the branching
    /// small, and the gate above keeps it off turns where no kill is near.
    /// </summary>
    private static GameAction? FindLethal(GameState state, int me, int depth)
    {
        if (depth <= 0 || state.IsOver || state.Active != me || state.Pending is not null) return null;
        foreach (var action in CandidateActions(state, me))
        {
            if (action.Type is not (ActionType.ActivatePower or ActionType.DeclareAttack
                or ActionType.CastSpell)) continue;
            var res = Engine.Apply(state, me, action);
            if (!res.Ok) continue;
            var after = Settle(res.State!);
            if (after.Winner == me) return action;
            if (FindLethal(after, me, depth - 1) is not null) return action;
        }
        return null;
    }

    /// <summary>The better of a play judged now and judged after the swing it sets up.</summary>
    private static double WithFollowUp(GameState after, int me, LegacyBotWeights w, double flat)
    {
        double swung = Evaluate(AlphaStrike(after, me, w), me, w);
        return swung > flat ? swung : flat;
    }

    public static GameAction ChooseAction(GameState state, int me, LegacyBotWeights? w = null)
    {
        w ??= LegacyBotWeights.Default;
        var pass = PassAction(state);

        // In a response window, standing still means letting the attack resolve,
        // so that outcome is the bar a trap has to beat.
        double baseline;
        bool openTurn = state.Pending is null;
        if (!openTurn)
        {
            var passed = Engine.Apply(state, me, pass);
            baseline = Evaluate(passed.Ok ? passed.State! : state, me, w);
        }
        else
        {
            // Standing still, as before. Crediting the baseline with the swing
            // too would price attacking out of its own comparison and the bot
            // would pass instead of hitting: it doubled game length when tried.
            baseline = Evaluate(state, me, w);
        }

        // A kill this turn beats anything the evaluator can score, and it is the
        // one thing the evaluator cannot see.
        if (openTurn && LethalPlausible(state, me)
            && FindLethal(state, me, LethalDepth) is { } kill)
        {
            return kill;
        }

        var best = pass;
        double bestScore = baseline;

        // One pass. Every playable action gets the same look: score it where it
        // lands, then score the turn it could still finish, and keep the better.
        // Probing only some action types would credit those with a whole turn
        // and the rest with a single action, which is not a comparison.
        foreach (var action in CandidateActions(state, me))
        {
            var res = Engine.Apply(state, me, action);
            if (!res.Ok) continue;
            var after = Settle(res.State!);
            double score = Evaluate(after, me, w);
            if (openTurn) score = WithFollowUp(after, me, w, score);
            if (score > bestScore + 1e-6)
            {
                bestScore = score;
                best = action;
            }
        }
        return best;
    }
}
