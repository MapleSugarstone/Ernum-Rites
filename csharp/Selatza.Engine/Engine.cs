namespace Selatza;

public enum ActionType
{
    PlaySupporter,
    SapSupporter,
    PlaySummon,
    CastSpell,
    PlayStage,
    ActivatePower,
    DeclareAttack,
    CastTrap,
    PassResponse,
    ResolveChoice,
    ReplaceSummon,
    DeclineReplace,
    PayFlip,
    DeclineFlip,
    UseStore,
    EndTurn,
    Concede,
    // Appended rather than filed beside UseStore: a game log stores the action
    // type as its ordinal, so renumbering EndTurn would misread every log
    // written before this.
    OpenStore,
    StoreOffer,
    StoreCounter,
    StoreAccept,
    StoreReject,
}

/// <summary>
/// Flat and serialisable on purpose: a replay is nothing but a seed, two deck
/// lists and an ordered run of these.
/// </summary>
public sealed record GameAction
{
    public ActionType Type { get; init; }
    public int HandIndex { get; init; }
    public int Index { get; init; }
    public int Slot { get; init; }
    public TargetRef Source { get; init; }
    public int PowerIndex { get; init; }
    public TargetRef Target { get; init; }
    public TargetRef[] Targets { get; init; } = Array.Empty<TargetRef>();
    /// <summary>ResolveChoice board pick; null when picking a revealed card or skipping.</summary>
    public TargetRef? Pick { get; init; }
    /// <summary>ResolveChoice revealed-card index; null for board picks and skips.</summary>
    public int? ChoiceIndex { get; init; }
    /// <summary>The debt a StoreOffer or StoreCounter puts on the table.</summary>
    public int Price { get; init; }
    /// <summary>StoreOffer only: the seller declares this price the last one.</summary>
    public bool Final { get; init; }

    public static GameAction PlaySupporter(int handIndex) =>
        new() { Type = ActionType.PlaySupporter, HandIndex = handIndex };
    public static GameAction SapSupporter(int index) =>
        new() { Type = ActionType.SapSupporter, Index = index };
    public static GameAction PlaySummon(int handIndex, int slot, params TargetRef[] targets) =>
        new() { Type = ActionType.PlaySummon, HandIndex = handIndex, Slot = slot, Targets = targets };
    public static GameAction CastSpell(int handIndex, params TargetRef[] targets) =>
        new() { Type = ActionType.CastSpell, HandIndex = handIndex, Targets = targets };
    public static GameAction PlayStage(int handIndex) =>
        new() { Type = ActionType.PlayStage, HandIndex = handIndex };
    public static GameAction ActivatePower(TargetRef source, int powerIndex, params TargetRef[] targets) =>
        new() { Type = ActionType.ActivatePower, Source = source, PowerIndex = powerIndex, Targets = targets };
    public static GameAction DeclareAttack(TargetRef source, TargetRef target) =>
        new() { Type = ActionType.DeclareAttack, Source = source, Target = target };
    public static GameAction CastTrap(int handIndex, params TargetRef[] targets) =>
        new() { Type = ActionType.CastTrap, HandIndex = handIndex, Targets = targets };
    public static GameAction PassResponse() => new() { Type = ActionType.PassResponse };

    public static GameAction ResolveChoice(TargetRef? pick = null, int? index = null) => new()
    { Type = ActionType.ResolveChoice, Pick = pick, ChoiceIndex = index };
    public static GameAction ReplaceSummon(int handIndex, params TargetRef[] targets) =>
        new() { Type = ActionType.ReplaceSummon, HandIndex = handIndex, Targets = targets };
    public static GameAction DeclineReplace() => new() { Type = ActionType.DeclineReplace };
    /// <summary>HandIndex is -1 unless the flip's cost includes a discard.</summary>
    public static GameAction PayFlip(int handIndex = -1) =>
        new() { Type = ActionType.PayFlip, HandIndex = handIndex };
    public static GameAction DeclineFlip() => new() { Type = ActionType.DeclineFlip };
    public static GameAction UseStore(TargetRef source) =>
        new() { Type = ActionType.UseStore, Source = source };
    public static GameAction OpenStore(TargetRef source) =>
        new() { Type = ActionType.OpenStore, Source = source };
    public static GameAction StoreOffer(int price, bool final = false) =>
        new() { Type = ActionType.StoreOffer, Price = price, Final = final };
    public static GameAction StoreCounter(int price) =>
        new() { Type = ActionType.StoreCounter, Price = price };
    public static GameAction StoreAccept() => new() { Type = ActionType.StoreAccept };
    public static GameAction StoreReject() => new() { Type = ActionType.StoreReject };
    public static GameAction EndTurn() => new() { Type = ActionType.EndTurn };
    public static GameAction Concede() => new() { Type = ActionType.Concede };
}

public readonly record struct ApplyResult(bool Ok, GameState? State, string? Error)
{
    public static ApplyResult Fail(string reason) => new(false, null, reason);
    public static ApplyResult Pass(GameState s) => new(true, s, null);
}

public sealed class DeckList
{
    public required string Name { get; init; }
    public required string LeaderId { get; init; }
    public required IReadOnlyList<string> Cards { get; init; }
}

public static class Engine
{
    // --- setup ---------------------------------------------------------------

    public static GameState CreateGame(DeckList a, DeckList b, int seed, int startingPlayer = 0)
    {
        var state = new GameState
        {
            Seed = seed,
            RngState = seed,
            Players = new[] { NewPlayer(a), NewPlayer(b) },
            StartingPlayer = startingPlayer,
            Active = startingPlayer,
        };

        var rng = new Rng(state.RngState);
        for (int idx = 0; idx < 2; idx++)
        {
            var p = state.Players[idx];
            rng.Shuffle(p.Deck);
            // The player going second opens a card up on the one going first.
            int size = Rules.OpeningHand + (idx == startingPlayer ? 0 : Rules.OpeningHandBonus);
            for (int i = 0; i < size && p.Deck.Count > 0; i++)
            {
                Effects.ToHand(state, idx, p.Deck[0]);
                p.Deck.RemoveAt(0);
            }
        }
        state.RngState = rng.State;

        StartTurn(state, startingPlayer);
        return state;
    }

    private static PlayerState NewPlayer(DeckList list) => new()
    {
        Name = list.Name,
        LeaderCardId = list.LeaderId,
        Deck = new List<string>(list.Cards),
    };

    // --- mana ----------------------------------------------------------------

    /// <summary>What a card costs the player holding it.</summary>
    public static Cost CostFor(PlayerState p, CardDef def)
    {
        var cost = def.Cost;
        bool cast = def.Type == CardType.Spell || def.Type == CardType.Trap;
        if (cast && FreeSpellsFor(p)) return default;
        // A tax only bites on what you cast, never on a body you place.
        if (p.SpellTax > 0 && cast)
        {
            cost = cost with { C = cost.C + p.SpellTax };
        }
        return cost;
    }

    /// <summary>Overknower: an empty board and a body that says so make spells cost nothing.</summary>
    private static bool FreeSpellsFor(PlayerState p)
    {
        foreach (var s in p.Slots)
        {
            if (s is not null) return false;
        }
        return p.Leader is not null && Registry.Card(p.Leader.CardId).FreeSpells;
    }

    /// <summary>Which mana bucket a supporter fills. Neutral cards pay colourless.</summary>
    public static int ManaIndexFor(PlayerState p, CardDef def) =>
        def.Color == Color.N || def.Neutral ? Rules.Colorless : (int)def.Color;

    public static int[] AvailableMana(PlayerState p)
    {
        var avail = (int[])p.Mana.Clone();
        foreach (var s in p.Supporters)
        {
            if (!s.Sapped) avail[ManaIndexFor(p, Registry.Card(s.CardId))]++;
        }
        return avail;
    }

    /// <summary>
    /// Coloured pips have to come from their own colour, or from Ernum mana,
    /// which covers a pip of any kind. A colourless pip takes whatever is left
    /// over, colourless mana first and then any colour, which is why it is
    /// checked against the surplus rather than against a bucket.
    /// </summary>
    public static bool CanPay(PlayerState p, Cost cost)
    {
        if (cost.IsFree) return true;
        var avail = AvailableMana(p);
        int spare = avail[Rules.Colorless];
        int wild = avail[Rules.Ernum];
        foreach (var c in Colors.All)
        {
            if (cost[c] > avail[(int)c])
            {
                int short_ = cost[c] - avail[(int)c];
                if (short_ > wild) return false;
                wild -= short_;
            }
            else spare += avail[(int)c] - cost[c];
        }
        return cost.C <= spare + wild;
    }

    /// <summary>
    /// Spends the pool first, then saps matching supporters. Ernum mana pays for
    /// anything, so it is always spent last: every pip takes what only it can
    /// take before the wildcard is touched.
    /// </summary>
    private static bool PayCost(GameState state, int player, Cost cost)
    {
        var p = state.Players[player];
        if (!CanPay(p, cost)) return false;
        if (cost.IsFree) return true;

        // Ernum mana, and then Ernum supporters, for a pip nothing else can pay.
        int SpendWild(int need)
        {
            while (need > 0 && p.Mana[Rules.Ernum] > 0)
            {
                p.Mana[Rules.Ernum]--;
                need--;
            }
            while (need > 0)
            {
                var s = p.Supporters.Find(x =>
                    !x.Sapped && ManaIndexFor(p, Registry.Card(x.CardId)) == Rules.Ernum);
                if (s is null) break;
                s.Sapped = true;
                need--;
            }
            return need;
        }

        foreach (var c in Colors.All)
        {
            int need = cost[c];
            while (need > 0 && p.Mana[(int)c] > 0)
            {
                p.Mana[(int)c]--;
                need--;
            }
            while (need > 0)
            {
                var s = p.Supporters.Find(x =>
                    !x.Sapped && ManaIndexFor(p, Registry.Card(x.CardId)) == (int)c);
                if (s is null) break;
                s.Sapped = true;
                need--;
            }
            if (SpendWild(need) > 0) return false;
        }

        // Colourless takes whatever is spare: the colourless pool first, so
        // coloured mana is kept back for the pips that actually need it.
        int generic = cost.C;
        while (generic > 0 && p.Mana[Rules.Colorless] > 0)
        {
            p.Mana[Rules.Colorless]--;
            generic--;
        }
        while (generic > 0)
        {
            var s = p.Supporters.Find(x =>
                !x.Sapped && ManaIndexFor(p, Registry.Card(x.CardId)) == Rules.Colorless);
            if (s is null) break;
            s.Sapped = true;
            generic--;
        }
        foreach (var c in Colors.All)
        {
            while (generic > 0 && p.Mana[(int)c] > 0)
            {
                p.Mana[(int)c]--;
                generic--;
            }
        }
        while (generic > 0)
        {
            var s = p.Supporters.Find(x =>
                !x.Sapped && ManaIndexFor(p, Registry.Card(x.CardId)) != Rules.Ernum);
            if (s is null) break;
            s.Sapped = true;
            generic--;
        }
        if (SpendWild(generic) > 0) return false;
        return true;
    }

    // --- turn structure ------------------------------------------------------

    private static void StartTurn(GameState state, int player)
    {
        state.Active = player;
        state.Turn++;
        state.Phase = Phase.Awake;
        var p = state.Players[player];
        p.TurnsTaken++;
        p.SupportersLeft = 1;
        if (p.ReplaceLocked > 0) p.ReplaceLocked--;
        Array.Clear(p.Mana);
        p.PlaysThisTurn = 0;
        // Every shop restocks at the start of every turn, whoever's turn it is:
        // the stock is the once-per-buyer rule made visible, and the buyer
        // changes with the turn. Self-use resets on the same clock.
        foreach (var pl in state.Players)
        {
            foreach (var s in pl.Slots.Append(pl.Leader))
            {
                if (s is null || StoreOf(s, Registry.Card(s.CardId)) is null) continue;
                s.StoreStock = StoreBoosted(state, s.Owner) ? 2 : 1;
                s.StoreUsed = false;
            }
        }
        Effects.Log(state, player, $"{p.Name} begins turn {p.TurnsTaken}.");

        if (!p.LeaderPlayed)
        {
            var def = Registry.Card(p.LeaderCardId);
            var leader = Effects.NewSummon(state, p.LeaderCardId, player, isLeader: true);
            p.Leader = leader;
            // Doubled, then two more: a leader has to survive long enough to be
            // played around rather than raced down before the game starts.
            Effects.AssignHp(state, leader, def.Hp * 2 + 2);
            p.LeaderPlayed = true;
            Effects.Log(state, player, $"{def.Name} takes the field with {leader.Hp.Count} HP.");
            Effects.FireTrigger(state, leader, TriggerName.OnEnter);
        }

        if (p.Stage is not null)
        {
            var def = Registry.Card(p.Stage);
            def.StageHooks?.OnAwake?.Invoke(new EffectCtx { State = state, Me = player, Card = def });
        }
        foreach (var s in p.Slots) Effects.FireTrigger(state, s, TriggerName.OnAwake);
        Effects.FireTrigger(state, p.Leader, TriggerName.OnAwake);
        if (state.Winner >= 0) return;

        foreach (var s in p.Supporters) s.Sapped = false;
        foreach (var s in p.Slots) Unsap(state, player, s);
        Unsap(state, player, p.Leader);

        state.Phase = Phase.Draw;
        bool goesFirst = p.TurnsTaken == 1 && player == state.StartingPlayer;
        if (!goesFirst) Effects.DrawCards(state, player, Rules.DrawPerTurn);

        state.Phase = Phase.Main;

        static void Unsap(GameState state, int player, SummonInstance? s)
        {
            if (s is null) return;
            if (s.SapLock && s.Sapped)
            {
                s.SapLock = false;
                Effects.Log(state, player, $"{Registry.Card(s.CardId).Name} stays sapped.");
            }
            else
            {
                s.Sapped = false;
            }
            s.PowerUses.Clear();
        }
    }

    private static void FinishTurn(GameState state)
    {
        state.Phase = Phase.End;
        for (int pl = 0; pl < 2; pl++)
        {
            foreach (var r in Effects.SummonRefsOf(state, pl, true))
            {
                var s = state.Find(r);
                s?.StrengthMods.RemoveAll(m => m.Duration == ModDuration.Turn);
            }
        }
        // Only the player ending the turn: "at the end of your turn" is their step.
        // Slots snapshot first, so a body that dies to one of these does not fire.
        var ending = state.Players[state.Active];
        // "This turn" runs out here whether or not a spell ever spent it.
        ending.SpellBonus = 0;
        foreach (var s2 in ending.Slots.Append(ending.Leader).ToArray())
        {
            if (s2 is not null) Effects.FireTrigger(state, s2, TriggerName.OnEndTurn);
        }
        if (state.Winner >= 0) return;

        Array.Clear(state.Players[state.Active].Mana);
        if (state.Winner >= 0) return;
        StartTurn(state, GameState.Other(state.Active));
    }

    // --- targeting -----------------------------------------------------------

    private static int[] SidesFor(TargetSpec spec, int me) => spec.Side switch
    {
        Side.Ally => new[] { me },
        Side.Enemy => new[] { GameState.Other(me) },
        _ => new[] { me, GameState.Other(me) },
    };

    /// <summary>
    /// Everything a target spec may legally choose. <paramref name="source"/> is
    /// the card doing the asking, which decides two things: a spell, trap or
    /// field cannot choose a Spell Immune body, and nothing may choose past a
    /// Redirection body on the far side of the table.
    /// </summary>
    public static List<TargetRef> TargetCandidates(GameState state, int me, TargetSpec spec,
        CardDef? source = null)
    {
        var outList = new List<TargetRef>();
        bool byCast = source is not null
            && source.Type is CardType.Spell or CardType.Trap or CardType.Stage;

        void Push(TargetRef r, CardDef? def, SummonInstance? summon)
        {
            if (r.IsBody && byCast && summon is not null
                && Registry.Card(summon.CardId).SpellImmune) return;
            if (r.IsBody && r.Player != me)
            {
                var forced = RedirectTargets(state, r.Player);
                if (forced.Count > 0 && !forced.Contains(r)) return;
            }
            if (spec.Filter is not null &&
                !spec.Filter(new TargetFilterArgs { State = state, Me = me, Ref = r, Card = def, Summon = summon }))
            {
                return;
            }
            outList.Add(r);
        }

        if (spec.Kind == TargetKind.ColorPick)
        {
            foreach (var c in Colors.All) Push(new TargetRef(TargetKind.ColorPick, 0, (int)c), null, null);
            return outList;
        }

        foreach (var player in SidesFor(spec, me))
        {
            var p = state.Players[player];
            switch (spec.Kind)
            {
                case TargetKind.Summon:
                    for (int i = 0; i < p.Slots.Length; i++)
                    {
                        var s = p.Slots[i];
                        if (s is not null) Push(TargetRef.Summon(player, i), Registry.Card(s.CardId), s);
                    }
                    if (spec.IncludeLeader && p.Leader is not null)
                    {
                        Push(TargetRef.Leader(player), Registry.Card(p.Leader.CardId), p.Leader);
                    }
                    break;
                case TargetKind.Hand:
                    for (int i = 0; i < p.Hand.Count; i++)
                    {
                        Push(TargetRef.Hand(player, i), Registry.Card(p.Hand[i]), null);
                    }
                    break;
                case TargetKind.Supporter:
                    for (int i = 0; i < p.Supporters.Count; i++)
                    {
                        Push(TargetRef.Supporter(player, i), Registry.Card(p.Supporters[i].CardId), null);
                    }
                    break;
                case TargetKind.Debt:
                    for (int i = 0; i < p.DebtZone.Count; i++)
                    {
                        Push(TargetRef.Debt(player, i), Registry.Card(p.DebtZone[i]), null);
                    }
                    break;
                case TargetKind.Discard:
                    for (int i = 0; i < p.Discard.Count; i++)
                    {
                        Push(TargetRef.Discard(player, i), Registry.Card(p.Discard[i]), null);
                    }
                    break;
            }
        }
        return outList;
    }

    private static string? ValidateTargets(GameState state, int me, TargetSpec[]? specs, TargetRef[] refs,
        CardDef? source = null)
    {
        var list = specs ?? Array.Empty<TargetSpec>();
        if (refs.Length > list.Length) return "Too many targets.";
        for (int i = 0; i < list.Length; i++)
        {
            var spec = list[i];
            if (i >= refs.Length)
            {
                if (!spec.Optional) return $"Missing target: {spec.Label}.";
                continue;
            }
            var r = refs[i];
            if (!TargetCandidates(state, me, spec, source).Contains(r))
            {
                return $"Illegal target for {spec.Label}.";
            }
            // No card reads the same body twice, so a repeated pick is always a misclick.
            if (r.IsBody)
            {
                for (int j = 0; j < i; j++)
                {
                    if (refs[j].Equals(r)) return "The same target cannot be picked twice.";
                }
            }
        }
        return null;
    }

    // --- legality ------------------------------------------------------------

    public static bool CanAttackThisTurn(GameState state, int player) =>
        state.Players[player].TurnsTaken > 1;

    /// <summary>
    /// Everything a given attacker may swing at. The leader is allowed to attack:
    /// it takes the counter-hit like anyone else, and since a defending leader
    /// deals nothing back, swinging with yours spends HP you cannot easily regain.
    /// </summary>
    public static List<TargetRef> LegalAttackTargets(GameState state, TargetRef source)
    {
        var result = new List<TargetRef>();
        int player = source.Player;
        if (state.Winner >= 0 || state.Pending is not null || state.ReplaceQueue.Count > 0) return result;
        if (state.Active != player || state.Phase != Phase.Main) return result;
        if (!CanAttackThisTurn(state, player)) return result;
        var attacker = state.Find(source);
        if (attacker is null || attacker.Sapped) return result;
        // Stationary bodies never declare attacks; they still hit back as defenders.
        if (Registry.Card(attacker.CardId).Stationary || attacker.Rooted) return result;

        int opp = GameState.Other(player);
        var enemy = state.Players[opp];

        // Redirection overrides everything else about who may be hit, the leader
        // rule included: a leader that redirects is attackable with its slots full.
        var forced = RedirectTargets(state, opp);
        if (forced.Count > 0) return forced;

        for (int i = 0; i < enemy.Slots.Length; i++)
        {
            if (enemy.Slots[i] is not null) result.Add(TargetRef.Summon(opp, i));
        }
        // The leader is only exposed once the slots in front of it are empty.
        if (result.Count == 0 && enemy.Leader is not null) result.Add(TargetRef.Leader(opp));
        return result;
    }

    /// <summary>Bodies a player controls that pull everything onto themselves.</summary>
    public static List<TargetRef> RedirectTargets(GameState state, int player)
    {
        var outList = new List<TargetRef>();
        var p = state.Players[player];
        for (int i = 0; i < p.Slots.Length; i++)
        {
            var s = p.Slots[i];
            if (s is not null && Registry.Card(s.CardId).Redirect) outList.Add(TargetRef.Summon(player, i));
        }
        if (p.Leader is not null && Registry.Card(p.Leader.CardId).Redirect)
        {
            outList.Add(TargetRef.Leader(player));
        }
        return outList;
    }

    public static List<TargetRef> ReadyAttackers(GameState state, int player)
    {
        var outList = new List<TargetRef>();
        var slots = state.Players[player].Slots;
        for (int i = 0; i < slots.Length; i++)
        {
            var r = TargetRef.Summon(player, i);
            if (slots[i] is not null && LegalAttackTargets(state, r).Count > 0) outList.Add(r);
        }
        var leader = TargetRef.Leader(player);
        if (state.Players[player].Leader is not null && LegalAttackTargets(state, leader).Count > 0)
        {
            outList.Add(leader);
        }
        return outList;
    }

    public static string? PowerBlockers(GameState state, int player, TargetRef source, int powerIndex)
    {
        var summon = state.Find(source);
        if (summon is null) return "No summon there.";
        if (summon.Owner != player) return "Not your summon.";
        if (summon.Sapped) return "That summon is sapped.";
        var powers = GameState.PowersOf(summon, Registry.Card(summon.CardId));
        if (powerIndex < 0 || powerIndex >= powers.Length) return "No such power.";
        var power = powers[powerIndex];
        if (power.OncePerTurn && summon.PowerUses.GetValueOrDefault(power.Name) > 0)
        {
            return "Already used this turn.";
        }
        if (power.NeedsLove && state.Players[player].Love <= 0) return "No Love to spend.";
        if (!CanPay(state.Players[player], power.Cost)) return "Not enough mana.";
        return null;
    }

    // --- stores --------------------------------------------------------------

    /// <summary>The Store a body's card prints, or null when it was played as something else.</summary>
    public static StoreDef? StoreOf(SummonInstance s, CardDef def) =>
        s.Override is null ? def.Store : null;

    /// <summary>Whether this player's stage doubles their shops and discounts their prices.</summary>
    public static bool StoreBoosted(GameState state, int player)
    {
        var id = state.Players[player].Stage;
        return id is not null && (Registry.TryCard(id)?.StoreBoost ?? false);
    }

    /// <summary>What running your own Store costs. Clearance Sale takes 1 off, floor 1.</summary>
    public static int StoreSelfPrice(GameState state, int owner, StoreDef store) =>
        Math.Max(1, 2 + store.Surcharge - (StoreBoosted(state, owner) ? 1 : 0));

    /// <summary>The slider a negotiation runs on: 1 to 4 plus the Store's surcharge.</summary>
    public static (int Min, int Max) StorePriceBounds(StoreDef store) =>
        (1 + store.Surcharge, 4 + store.Surcharge);

    /// <summary>
    /// Why this player cannot use or open the Store on this body right now, or
    /// null when they can. Shared by self-use, opening and the bot.
    /// </summary>
    public static string? StoreBlockers(GameState state, int user, TargetRef source)
    {
        var summon = state.Find(source);
        if (summon is null) return "No summon there.";
        var def = Registry.Card(summon.CardId);
        var store = StoreOf(summon, def);
        if (store is null) return $"{def.Name} is not a Store.";
        if (summon.Owner == user)
        {
            if (summon.EnteredTurn >= state.Turn) return "A Store cannot be run the turn it opens.";
            if (summon.StoreUsed) return "Already used this turn.";
        }
        else
        {
            if (summon.StoreStock <= 0) return "That Store is closed this turn.";
        }
        if (store.Useful is not null && !store.Useful(state, user)) return "That Store has nothing for you.";
        return null;
    }

    /// <summary>
    /// A Store's effect always resolves for its user, with any target asked of
    /// them through the choice queue once the price is settled. One candidate
    /// collapses to an instant pick, none runs the resolver empty-handed.
    /// </summary>
    private static void ResolveStoreEffect(GameState state, int user, SummonInstance summon,
        CardDef def, StoreDef store)
    {
        var spec = store.Targets is { Length: > 0 } t ? t[0] : null;
        if (spec is null)
        {
            store.Effect(new EffectCtx { State = state, Me = user, Source = summon, Card = def });
            return;
        }
        var refs = TargetCandidates(state, user, spec, def).ToArray();
        var choice = new PendingChoice
        {
            Player = user,
            Source = def.Id,
            Effect = "store-effect",
            Prompt = $"Choose {spec.Label}.",
            Refs = refs,
            At = Effects.RefFor(state, summon),
        };
        if (refs.Length == 0)
        {
            Choices.Run(state, choice, new ChoicePick());
            return;
        }
        if (refs.Length == 1)
        {
            Choices.Run(state, choice, new ChoicePick(Ref: refs[0]));
            return;
        }
        state.ChoiceQueue.Add(choice);
    }

    /// <summary>Registered by CardSets.RegisterAll, mirrored in the TypeScript engine.</summary>
    public static void RegisterStoreResolver() =>
        Choices.Register("store-effect", (state, choice, pick) =>
        {
            var def = Registry.Card(choice.Source);
            if (def.Store is null) return;
            var src = choice.At is { } at ? state.Find(at) : null;
            def.Store.Effect(new EffectCtx
            {
                State = state,
                Me = choice.Player,
                Source = src,
                Card = def,
                Targets = pick.Ref is { } r ? new[] { r } : Array.Empty<TargetRef>(),
            });
        });

    /// <summary>Close the window, charge the buyer, pay the seller, run the effect.</summary>
    private static void ResolveStorePurchase(GameState state, PendingStoreWindow w)
    {
        state.Pending = null;
        var summon = state.Find(w.Source);
        if (summon is null) return;
        var def = Registry.Card(summon.CardId);
        var store = StoreOf(summon, def);
        if (store is null) return;
        summon.StoreStock = Math.Max(0, summon.StoreStock - 1);
        int paid = Math.Max(1, (w.Price < 0 ? 1 : w.Price) - (StoreBoosted(state, w.Seller) ? 1 : 0));
        Effects.AddDebt(state, w.Buyer, paid,
            $"{state.Players[w.Buyer].Name} buys from {def.Name}'s Store for {paid} debt.");
        if (state.Winner >= 0) return;
        Effects.GainLove(state, w.Seller, 1);
        ResolveStoreEffect(state, w.Buyer, summon, def, store);
        if (state.Winner >= 0) return;
        var seller = state.Players[w.Seller];
        foreach (var s in seller.Slots.Append(seller.Leader))
        {
            if (s is not null) Effects.FireTrigger(state, s, TriggerName.OnStoreSold);
        }
        var stageDef = seller.Stage is not null ? Registry.TryCard(seller.Stage) : null;
        if (stageDef?.StageHooks?.OnStoreSold is { } hook)
        {
            hook(new EffectCtx { State = state, Me = w.Seller, Card = stageDef });
        }
        if (state.Winner >= 0) return;
        var buyer = state.Players[w.Buyer];
        foreach (var s in buyer.Slots.Append(buyer.Leader))
        {
            if (s is not null) Effects.FireTrigger(state, s, TriggerName.OnStoreBought);
        }
    }

    // --- reducer -------------------------------------------------------------

    private static string? MainPhaseBlocker(GameState state)
    {
        if (state.Pending is not null) return "A battle response is pending.";
        if (state.ChoiceQueue.Count > 0) return "Settle the pending choice first.";
        if (state.FlipQueue.Count > 0) return "Settle the flipped card first.";
        if (state.ReplaceQueue.Count > 0) return "Resolve the dead summon first.";
        if (state.Phase != Phase.Main) return "Not in the main phase.";
        return null;
    }

    private static void ResolvePendingBattle(GameState state)
    {
        var pending = state.Pending;
        if (pending?.Battle is null) return;
        state.Pending = null;
        Effects.ResolveClash(state, pending.Battle.Attacker, pending.Battle.Defender);
    }

    /// <summary>
    /// A spell's effect, echoes and cast triggers, run once its response
    /// window closes without a counter, or immediately when no window opened.
    /// </summary>
    private static void ResolveSpell(GameState state, int caster, string id, TargetRef[] targets)
    {
        var def = Registry.Card(id);
        // The leader seat counts. Any summon with HP can be chosen to lead, so a
        // card whose text is a standing board effect has to keep working from up
        // there, the way FreeSpellsFor already reads it.
        bool echo = false;
        foreach (var s in state.Players[caster].Slots)
        {
            if (s is not null && Registry.Card(s.CardId).SpellEcho) echo = true;
        }
        if (state.Players[caster].Leader is { } lead && Registry.Card(lead.CardId).SpellEcho)
        {
            echo = true;
        }
        int times = echo ? 2 : 1;
        // A held bonus is spent by whichever spell resolves next, echo included.
        Effects.TakeSpellBonus(state, caster);
        try
        {
            for (int i = 0; i < times && state.Winner < 0; i++)
            {
                if (i > 0) Effects.Log(state, caster, $"{def.Name} echoes.");
                var aim = i == 0 ? targets : EchoTargets(state, caster, def, targets);
                def.Effect?.Invoke(new EffectCtx
                { State = state, Me = caster, Card = def, Targets = aim });
            }
        }
        finally { Effects.ClearSpellBonus(); }
        var p = state.Players[caster];
        int before = p.Discard.Count;
        if (def.AnnihilateAfterCast)
        {
            Effects.Log(state, caster, $"{def.Name} is annihilated.");
        }
        else
        {
            Effects.ToDiscard(state, caster, id);
        }
        if (state.Winner >= 0) return;
        // The spell's discard index is how the other side's triggers get told
        // which one was cast. A spell that never landed there (annihilated after
        // cast, or voided by an aura) offers no ref rather than the old top.
        var foe = state.Players[GameState.Other(caster)];
        var one = p.Discard.Count > before
            ? new[]
            {
                new TargetRef
                {
                    Kind = TargetKind.Discard,
                    Player = caster,
                    Index = p.Discard.Count - 1,
                },
            }
            : Array.Empty<TargetRef>();
        // One round of answers per cast. An echo is a second cast rather than a
        // louder first one, so a card that answers a cast answers both, and the
        // rounds run after the discard because that is what names the spell.
        for (int i = 0; i < times && state.Winner < 0; i++)
        {
            foreach (var s in p.Slots)
            {
                if (s is not null) Effects.FireTrigger(state, s, TriggerName.OnSpellCast);
            }
            if (p.Leader is not null) Effects.FireTrigger(state, p.Leader, TriggerName.OnSpellCast);
            foreach (var s in foe.Slots)
            {
                if (s is not null) Effects.FireTrigger(state, s, TriggerName.OnEnemySpellCast, one);
            }
            if (foe.Leader is not null)
                Effects.FireTrigger(state, foe.Leader, TriggerName.OnEnemySpellCast, one);
        }
    }

    /// <summary>
    /// Tells the other side that a Power just resolved. The body that used it is
    /// passed as the one target, so a watcher can answer the thing that acted.
    /// </summary>
    private static void FireEnemyPower(GameState state, int actor, TargetRef user)
    {
        var foe = state.Players[GameState.Other(actor)];
        var one = new[] { user };
        foreach (var s in foe.Slots)
        {
            if (s is not null) Effects.FireTrigger(state, s, TriggerName.OnEnemyPower, one);
        }
        if (foe.Leader is not null)
            Effects.FireTrigger(state, foe.Leader, TriggerName.OnEnemyPower, one);
    }

    public static ApplyResult Apply(GameState state, int actor, GameAction action)
    {
        if (state.IsOver) return ApplyResult.Fail("The game is already over.");
        var next = state.Clone();
        // What the last action announced belongs to the last action.
        next.Fx.Clear();
        var error = Reduce(next, actor, action);
        if (error is not null) return ApplyResult.Fail(error);
        Effects.SweepReplaceQueue(next);
        next.Version++;
        next.Actions++;
        // A blow that took both leaders leaves nobody to hand the match to. The
        // winner it recorded first stood only so the rest of the action would
        // stop resolving; with the action over, the match is level.
        if (next.Drawn) next.Winner = -1;
        // Checked after the action resolves, so nothing is left half-applied.
        if (next.Winner < 0 && !next.Drawn && (next.Turn >= Rules.MaxTurns || next.Actions >= Rules.MaxActions))
        {
            next.Drawn = true;
            next.WinReason = next.Turn >= Rules.MaxTurns
                ? $"The match reached {Rules.MaxTurns} turns and ends in a draw."
                : $"The match reached {Rules.MaxActions} actions and ends in a draw.";
            Effects.Log(next, -1, next.WinReason);
        }
        return ApplyResult.Pass(next);
    }

    /// <summary>
    /// Where an echo points when what it pointed at is gone.
    ///
    /// A spell that consumes its targets leaves refs naming bodies that are no
    /// longer on the board, and the echo then resolves against nothing:
    /// Recompiler fuses two summons off the board and its second cast found both
    /// slots empty. Any ref that has gone is swapped for another legal one,
    /// preferring the side it was originally aimed at, and refs that are still
    /// there are left alone so an echo hits what it was aimed at wherever it
    /// still can.
    /// </summary>
    private static TargetRef[] EchoTargets(GameState state, int caster, CardDef def,
        TargetRef[] targets)
    {
        var specs = def.Targets;
        if (specs is null || specs.Length == 0) return targets;
        var outRefs = new List<TargetRef>();
        for (int i = 0; i < targets.Length; i++)
        {
            var r = targets[i];
            if (!r.IsBody || state.Find(r) is not null)
            {
                outRefs.Add(r);
                continue;
            }
            if (i >= specs.Length) return targets;
            var free = TargetCandidates(state, caster, specs[i], def)
                .Where(c => !outRefs.Contains(c)).ToList();
            TargetRef? fresh = null;
            foreach (var c in free)
            {
                if (c.IsBody && c.Player == r.Player) { fresh = c; break; }
            }
            fresh ??= free.Count > 0 ? free[0] : null;
            if (fresh is not { } pick) return targets;
            outRefs.Add(pick);
        }
        return outRefs.ToArray();
    }

    private static string? Reduce(GameState state, int actor, GameAction action)
    {
        if (action.Type == ActionType.Concede)
        {
            Effects.EndGame(state, GameState.Other(actor), $"{state.Players[actor].Name} conceded.");
            return null;
        }
        if (actor != state.CurrentActor) return "It is not your turn to act.";

        var me = state.Players[actor];
        int opp = GameState.Other(actor);

        switch (action.Type)
        {
            case ActionType.PlaySupporter:
            {
                var blocked = MainPhaseBlocker(state);
                if (blocked is not null) return blocked;
                // Checked before the allowance, because forbidding beats allowing:
                // an extra supporter granted this turn is spent on nothing while
                // a lock is on the table.
                if (Effects.SupporterLocked(state, actor))
                    return "The enemy is stopping you playing supporters.";
                if (me.SupportersLeft <= 0) return "You already played a supporter this turn.";
                if (action.HandIndex < 0 || action.HandIndex >= me.Hand.Count) return "No card at that hand index.";
                var id = me.Hand[action.HandIndex];
                me.Hand.RemoveAt(action.HandIndex);
                me.PlaysThisTurn += 1;
                me.Supporters.Add(new Supporter { CardId = id });
                // The hack rides along: a hacked supporter pays in Robot.
                me.SupportersLeft -= 1;
                Effects.Log(state, actor, $"{me.Name} faces {Registry.Card(id).Name} as a supporter.");
                return null;
            }

            case ActionType.SapSupporter:
            {
                if (action.Index < 0 || action.Index >= me.Supporters.Count) return "No supporter there.";
                var s = me.Supporters[action.Index];
                if (s.Sapped) return "That supporter is already sapped.";
                s.Sapped = true;
                me.Mana[ManaIndexFor(me, Registry.Card(s.CardId))]++;
                return null;
            }

            case ActionType.PlaySummon:
            {
                var blocked = MainPhaseBlocker(state);
                if (blocked is not null) return blocked;
                return PlaceSummon(state, actor, action.HandIndex, action.Slot, action.Targets);
            }

            case ActionType.ReplaceSummon:
            {
                if (me.ReplaceLocked > 0) return "That slot is cursed shut.";
                if (state.ReplaceQueue.Count == 0 || state.ReplaceQueue[0].Player != actor)
                {
                    return "Nothing to replace.";
                }
                var slot = state.ReplaceQueue[0].Slot;
                // Claim the slot first: placing can end the game, and ending the
                // game clears the queue out from under us.
                state.ReplaceQueue.RemoveAt(0);
                return PlaceSummon(state, actor, action.HandIndex, slot, action.Targets);
            }

            case ActionType.PayFlip:
            {
                if (state.FlipQueue.Count == 0 || state.FlipQueue[0].Player != actor)
                {
                    return "No flip is waiting.";
                }
                var offer = state.FlipQueue[0];
                var fdef = Registry.Card(offer.CardId);
                var fcost = fdef.FlipCost;
                if (fdef.Flip is null || fcost is null) return "That card asks for nothing.";
                if (!fcost.Mana.IsFree && !CanPay(me, fcost.Mana)) return "Not enough mana.";
                if (fcost.Mill > 0 && me.Deck.Count < fcost.Mill) return "Not enough deck left to mill.";
                int discardIndex = -1;
                if (fcost.Discard > 0)
                {
                    discardIndex = action.HandIndex;
                    if (discardIndex < 0 || discardIndex >= me.Hand.Count)
                    {
                        return "Choose a card to discard.";
                    }
                }

                // Looked up before anything is spent. An offer can outlive the
                // body it was protecting, and paying for a card that has nothing
                // left to protect takes the cost and fires nothing.
                var holder = state.Find(offer.Holder);
                if (holder is null)
                {
                    state.FlipQueue.RemoveAt(0);
                    Effects.Log(state, actor, $"{fdef.Name} has nothing left to protect.");
                    Effects.ResumeDamage(state, offer);
                    return null;
                }
                // The same rule for a flip that would find nothing to work on.
                // The card says so itself, and a client hides the offer on the
                // strength of it, but a client is not the authority: a payment
                // that arrives anyway used to be taken and the effect fired into
                // an empty board. Let the card lie instead of billing for it.
                if (!Effects.FlipWouldFire(state, offer))
                {
                    state.FlipQueue.RemoveAt(0);
                    Effects.Log(state, actor, $"{fdef.Name}'s flip would do nothing.");
                    Effects.ResumeDamage(state, offer);
                    return null;
                }
                state.FlipQueue.RemoveAt(0);
                if (!fcost.Mana.IsFree) PayCost(state, actor, fcost.Mana);
                for (int i = 0; i < fcost.Mill; i++)
                {
                    if (me.Deck.Count == 0) break;
                    var id = me.Deck[0];
                    me.Deck.RemoveAt(0);
                    Effects.ToDiscard(state, actor, id);
                }
                if (fcost.Discard > 0 && discardIndex >= 0)
                {
                    var id = me.Hand[discardIndex];
                    me.Hand.RemoveAt(discardIndex);
                    Effects.ToDiscard(state, actor, id);
                }
                Effects.Log(state, actor, $"{me.Name} pays for {fdef.Name}'s flip.");
                fdef.Flip(new FlipCtx
                { State = state, Me = actor, Holder = holder, Card = fdef });
                // The blow that revealed this card stopped on it. Now that it
                // has fired, the rest of the damage lands and the body is
                // settled after it.
                Effects.ResumeDamage(state, offer);
                return null;
            }

            case ActionType.DeclineFlip:
            {
                if (state.FlipQueue.Count == 0 || state.FlipQueue[0].Player != actor)
                {
                    return "No flip is waiting.";
                }
                var offer = state.FlipQueue[0];
                state.FlipQueue.RemoveAt(0);
                // Deliberately unnamed: the card stays face down, and the log is public.
                Effects.Log(state, actor, $"{me.Name} lets the card lie.");
                // Declining is an answer too, so the rest of the blow lands
                // either way.
                Effects.ResumeDamage(state, offer);
                return null;
            }

            case ActionType.DeclineReplace:
            {
                if (state.ReplaceQueue.Count == 0 || state.ReplaceQueue[0].Player != actor)
                {
                    return "Nothing to replace.";
                }
                state.ReplaceQueue.RemoveAt(0);
                Effects.Log(state, actor, $"{me.Name} leaves the slot empty.");
                return null;
            }

            case ActionType.CastSpell:
            {
                var blocked = MainPhaseBlocker(state);
                if (blocked is not null) return blocked;
                if (action.HandIndex < 0 || action.HandIndex >= me.Hand.Count) return "No card at that hand index.";
                var id = me.Hand[action.HandIndex];
                var def = Registry.Card(id);
                if (def.Type != CardType.Spell) return $"{def.Name} is not a spell.";
                var bad = ValidateTargets(state, actor, def.Targets, action.Targets, def);
                if (bad is not null) return bad;
                var spellCost = CostFor(me, def);
                if (!CanPay(me, spellCost)) return "Not enough mana.";
                PayCost(state, actor, spellCost);
                me.Hand.RemoveAt(action.HandIndex);
                me.PlaysThisTurn += 1;
                Effects.Log(state, actor, $"{me.Name} casts {def.Name}.");
                int spellFoe = GameState.Other(actor);
                // The window opens only for a Spell Trap that could actually
                // answer this cast. The pending is staged before the question,
                // because a trap's printed gate (Sugar Crash's play count)
                // reads the spell it would be answering.
                state.Pending = new Pending
                {
                    Player = spellFoe,
                    Spell = new PendingSpell
                    { Caster = actor, CardId = id, Targets = action.Targets },
                };
                bool holdsSpellTrap = state.Players[spellFoe].Hand
                    .Exists(h => Registry.Card(h) is { Type: CardType.Trap, SpellTrap: true } trap
                        && Effects.TrapWouldFire(state, spellFoe, trap));
                if (!holdsSpellTrap)
                {
                    state.Pending = null;
                    ResolveSpell(state, actor, id, action.Targets);
                }
                return null;
            }

            case ActionType.PlayStage:
            {
                var blocked = MainPhaseBlocker(state);
                if (blocked is not null) return blocked;
                if (action.HandIndex < 0 || action.HandIndex >= me.Hand.Count) return "No card at that hand index.";
                var id = me.Hand[action.HandIndex];
                var def = Registry.Card(id);
                if (def.Type != CardType.Stage) return $"{def.Name} is not a stage.";
                var stageCost = CostFor(me, def);
                if (!CanPay(me, stageCost)) return "Not enough mana.";
                PayCost(state, actor, stageCost);
                me.Hand.RemoveAt(action.HandIndex);
                me.PlaysThisTurn += 1;
                if (me.Stage is not null) Effects.ToDiscard(state, actor, me.Stage);
                me.Stage = id;
                Effects.Log(state, actor, $"{me.Name} sets the stage: {def.Name}.");
                def.Effect?.Invoke(new EffectCtx { State = state, Me = actor, Card = def });
                return null;
            }

            case ActionType.ActivatePower:
            {
                var blocked = MainPhaseBlocker(state);
                if (blocked is not null) return blocked;
                var why = PowerBlockers(state, actor, action.Source, action.PowerIndex);
                if (why is not null) return why;
                var summon = state.Find(action.Source)!;
                var def = Registry.Card(summon.CardId);
                var power = GameState.PowersOf(summon, def)[action.PowerIndex];
                var bad = ValidateTargets(state, actor, power.Targets, action.Targets, def);
                if (bad is not null) return bad;
                PayCost(state, actor, power.Cost);
                // Sapping is part of the cost, paid before the effect resolves.
                if (power.SapSelf) summon.Sapped = true;
                summon.PowerUses[power.Name] = summon.PowerUses.GetValueOrDefault(power.Name) + 1;
                Effects.Log(state, actor, $"{def.Name} uses {power.Name}.");
                power.Effect(new EffectCtx
                { State = state, Me = actor, Source = summon, Card = def, Targets = action.Targets });
                if (state.Winner < 0) FireEnemyPower(state, actor, action.Source);
                return null;
            }

            case ActionType.DeclareAttack:
            {
                var blocked = MainPhaseBlocker(state);
                if (blocked is not null) return blocked;
                if (state.Active != actor) return "Not your turn.";
                if (action.Source.Player != actor) return "That is not yours to swing.";
                if (!CanAttackThisTurn(state, actor)) return "You cannot attack on your first turn.";
                var legal = LegalAttackTargets(state, action.Source);
                if (legal.Count == 0) return "That attacker cannot attack right now.";
                if (!legal.Contains(action.Target)) return "Illegal attack target.";

                var attacker = state.Find(action.Source)!;
                attacker.Sapped = true;
                var defender = state.Find(action.Target)!;
                Effects.Log(state, actor,
                    $"{Registry.Card(attacker.CardId).Name} declares an attack on {Registry.Card(defender.CardId).Name}.");
                state.Battle = new PendingBattle { Attacker = action.Source, Defender = action.Target };
                Effects.FireTrigger(state, attacker, TriggerName.OnAttack);
                if (state.Winner >= 0)
                {
                    state.Battle = null;
                    return null;
                }
                if (state.Find(action.Source) is null || state.Find(action.Target) is null)
                {
                    state.Battle = null;
                    return null;
                }

                bool holdsTrap = state.Players[opp].Hand
                    .Exists(id => Registry.Card(id).Type == CardType.Trap
                        && !Registry.Card(id).SpellTrap);
                if (holdsTrap)
                {
                    state.Pending = new Pending
                    {
                        Player = opp,
                        Battle = new PendingBattle { Attacker = action.Source, Defender = action.Target },
                    };
                }
                else
                {
                    Effects.ResolveClash(state, action.Source, action.Target);
                }
                return null;
            }

            case ActionType.CastTrap:
            {
                var pending = state.Pending;
                if (pending is null || pending.Player != actor) return "No response window is open.";
                if (pending.Store is not null) return "Settle the Store window first.";
                // Springing the trap resolves the clash, and a flip revealed on
                // the way in is owed its answer before that blow can land.
                if (state.FlipQueue.Count > 0) return "Settle the flipped card first.";
                if (action.HandIndex < 0 || action.HandIndex >= me.Hand.Count) return "No card at that hand index.";
                var id = me.Hand[action.HandIndex];
                var def = Registry.Card(id);
                if (def.Type != CardType.Trap) return $"{def.Name} is not a trap.";
                if (pending.Battle is not null)
                {
                    if (def.SpellTrap) return $"{def.Name} only answers spells.";
                    if (pending.Battle.TrapUsed) return "Only one trap per battle.";
                }
                else if (pending.Spell is not null && !def.SpellTrap)
                {
                    return $"{def.Name} only answers attacks.";
                }
                // Refused rather than spent. The card stays in hand and the
                // window stays open, because a trap that cannot touch what it
                // is being sprung at has not been used.
                if (!Effects.TrapWouldFire(state, actor, def))
                {
                    return $"{def.Name} cannot answer this.";
                }
                var bad = ValidateTargets(state, actor, def.Targets, action.Targets, def);
                if (bad is not null) return bad;
                var trapCost = CostFor(me, def);
                if (!CanPay(me, trapCost)) return "Not enough mana.";
                PayCost(state, actor, trapCost);
                me.Hand.RemoveAt(action.HandIndex);
                me.PlaysThisTurn += 1;
                Effects.Log(state, actor, $"{me.Name} springs {def.Name}.");
                if (pending.Battle is not null)
                {
                    pending.Battle.TrapUsed = true;
                    def.Effect?.Invoke(new EffectCtx
                    { State = state, Me = actor, Card = def, Targets = action.Targets });
                    Effects.ToDiscard(state, actor, id);
                    ResolvePendingBattle(state);
                }
                else if (pending.Spell is not null)
                {
                    // Springing a Spell Trap counters the spell: the trap's own
                    // effect runs while the pending spell is still readable,
                    // then the spell is discarded without resolving. A trap that
                    // lets the spell resolve still answers first, then hands the
                    // window back.
                    def.Effect?.Invoke(new EffectCtx
                    { State = state, Me = actor, Card = def, Targets = action.Targets });
                    Effects.ToDiscard(state, actor, id);
                    var sp = pending.Spell;
                    state.Pending = null;
                    if (def.LetSpellResolve)
                    {
                        ResolveSpell(state, sp.Caster, sp.CardId, sp.Targets);
                    }
                    else
                    {
                        Effects.Log(state, actor, $"{Registry.Card(sp.CardId).Name} is countered.");
                        Effects.ToDiscard(state, sp.Caster, sp.CardId);
                    }
                }
                return null;
            }

            case ActionType.ResolveChoice:
            {
                if (state.ChoiceQueue.Count == 0 || state.ChoiceQueue[0].Player != actor)
                {
                    return "No choice is waiting.";
                }
                var ch = state.ChoiceQueue[0];
                if (ch.Cards is not null)
                {
                    if (action.ChoiceIndex is not { } idx)
                    {
                        // A mandatory reveal with nothing legal in it has exactly
                        // one resolution, which is to resolve it with nothing.
                        // Refusing here left a choice on the board that no action
                        // could answer: picking was refused because no index was
                        // legal, and passing was refused because the choice was
                        // not optional. The board-pick branch below already reads
                        // this way and this one did not.
                        if (!ch.Optional && (ch.Legal?.Length ?? 0) > 0) return "Pick a card.";
                        state.ChoiceQueue.RemoveAt(0);
                        Choices.Run(state, ch, new ChoicePick());
                        return null;
                    }
                    if (ch.Legal is null || Array.IndexOf(ch.Legal, idx) < 0)
                    {
                        return "That card is not a legal pick.";
                    }
                    state.ChoiceQueue.RemoveAt(0);
                    Choices.Run(state, ch, new ChoicePick(Index: idx));
                    return null;
                }
                if (action.Pick is not { } pick)
                {
                    bool anyLeft = false;
                    foreach (var r in ch.Refs ?? Array.Empty<TargetRef>())
                    {
                        if (!state.RefIsGone(r)) { anyLeft = true; break; }
                    }
                    if (!ch.Optional && anyLeft) return "Pick a target.";
                    state.ChoiceQueue.RemoveAt(0);
                    Choices.Run(state, ch, new ChoicePick());
                    return null;
                }
                bool offered = false;
                foreach (var r in ch.Refs ?? Array.Empty<TargetRef>())
                {
                    if (r == pick) { offered = true; break; }
                }
                if (!offered) return "Not one of the offered targets.";
                if (state.RefIsGone(pick)) return "That target is gone.";
                state.ChoiceQueue.RemoveAt(0);
                Choices.Run(state, ch, new ChoicePick(Ref: pick));
                return null;
            }

            case ActionType.PassResponse:
            {
                if (state.Pending is null || state.Pending.Player != actor) return "No response window is open.";
                if (state.Pending.Store is not null) return "Settle the Store window first.";
                // Passing resolves the clash, so a flip still gating that blow
                // comes first.
                if (state.FlipQueue.Count > 0) return "Settle the flipped card first.";
                // A window only opens for a player already holding a trap that
                // answers it, so declining is a decision rather than an absence.
                Effects.Log(state, actor, $"{state.Players[actor].Name} holds their trap.");
                if (state.Pending.Spell is { } sp2)
                {
                    state.Pending = null;
                    ResolveSpell(state, sp2.Caster, sp2.CardId, sp2.Targets);
                }
                else
                {
                    ResolvePendingBattle(state);
                }
                return null;
            }

            case ActionType.UseStore:
            {
                var blocked = MainPhaseBlocker(state);
                if (blocked is not null) return blocked;
                var summon = state.Find(action.Source);
                if (summon is null) return "No summon there.";
                if (summon.Owner != actor) return "Not your Store: open it and haggle.";
                var why = StoreBlockers(state, actor, action.Source);
                if (why is not null) return why;
                var def = Registry.Card(summon.CardId);
                var store = StoreOf(summon, def)!;
                summon.StoreUsed = true;
                int price = StoreSelfPrice(state, actor, store);
                Effects.AddDebt(state, actor, price,
                    $"{me.Name} runs {def.Name}'s Store for {price} debt.");
                if (state.Winner >= 0) return null;
                ResolveStoreEffect(state, actor, summon, def, store);
                return null;
            }

            case ActionType.OpenStore:
            {
                var blocked = MainPhaseBlocker(state);
                if (blocked is not null) return blocked;
                if (state.Active != actor) return "Not your turn.";
                var summon = state.Find(action.Source);
                if (summon is null) return "No summon there.";
                if (summon.Owner == actor) return "Run your own Store instead of haggling with it.";
                var why = StoreBlockers(state, actor, action.Source);
                if (why is not null) return why;
                Effects.Log(state, actor,
                    $"{me.Name} opens {Registry.Card(summon.CardId).Name}'s Store.");
                state.Pending = new Pending
                {
                    Player = summon.Owner,
                    Store = new PendingStoreWindow
                    {
                        Seller = summon.Owner,
                        Buyer = actor,
                        Source = action.Source,
                    },
                };
                return null;
            }

            case ActionType.StoreOffer:
            {
                var pend = state.Pending;
                if (pend?.Store is null || pend.Player != actor) return "No Store window is open.";
                var w = pend.Store;
                if (actor != w.Seller) return "Only the seller sets prices.";
                if (w.Pass % 2 == 1) return "Your price is already on the table.";
                var summon = state.Find(w.Source);
                if (summon is null)
                {
                    state.Pending = null;
                    return null;
                }
                var def = Registry.Card(summon.CardId);
                var (min, max) = StorePriceBounds(StoreOf(summon, def)!);
                if (action.Price < min || action.Price > max) return $"The price must be {min} to {max}.";
                // An opening offer plus three counters, and after that the seller
                // may only declare the price final.
                if (w.Pass >= 4 && !action.Final) return "Only a final offer now.";
                w.Price = action.Price;
                w.Final = action.Final;
                w.Pass += 1;
                pend.Player = w.Buyer;
                Effects.Log(state, actor, $"{me.Name} offers {def.Name}'s Store for "
                    + $"{action.Price} debt{(w.Final ? ", final" : "")}.");
                return null;
            }

            case ActionType.StoreCounter:
            {
                var pend = state.Pending;
                if (pend?.Store is null || pend.Player != actor) return "No Store window is open.";
                var w = pend.Store;
                if (actor != w.Buyer) return "Only the buyer counters.";
                if (w.Pass % 2 == 0) return "Nothing to counter yet.";
                if (w.Final) return "That was a final offer: accept or reject.";
                if (w.Pass >= 4) return "No more counters: accept or reject.";
                var summon = state.Find(w.Source);
                if (summon is null)
                {
                    state.Pending = null;
                    return null;
                }
                var (min, max) = StorePriceBounds(StoreOf(summon, Registry.Card(summon.CardId))!);
                if (action.Price < min || action.Price > max) return $"The price must be {min} to {max}.";
                if (action.Price == w.Price) return "That is the price on the table: accept it.";
                w.Price = action.Price;
                w.Pass += 1;
                pend.Player = w.Seller;
                Effects.Log(state, actor, $"{me.Name} counters at {action.Price} debt.");
                return null;
            }

            case ActionType.StoreAccept:
            {
                var pend = state.Pending;
                if (pend?.Store is null || pend.Player != actor) return "No Store window is open.";
                var w = pend.Store;
                if (w.Price < 0) return "No price is on the table.";
                // You accept the other side's price: the buyer an offer, the
                // seller a counter. Odd passes are the seller's price.
                bool theirPrice = actor == w.Seller ? w.Pass % 2 == 0 : w.Pass % 2 == 1;
                if (!theirPrice) return "That is your own price.";
                Effects.Log(state, actor, $"{me.Name} accepts {w.Price} debt.");
                ResolveStorePurchase(state, w);
                return null;
            }

            case ActionType.StoreReject:
            {
                var pend = state.Pending;
                if (pend?.Store is null || pend.Player != actor) return "No Store window is open.";
                var w = pend.Store;
                // The seller must always name a price: a buyer can always buy at
                // the slider's top, so only the buyer may walk away.
                if (actor != w.Buyer) return "The seller must name a price.";
                var summon = state.Find(w.Source);
                if (summon is not null) summon.StoreStock = 0;
                state.Pending = null;
                Effects.Log(state, actor, $"{me.Name} walks away"
                    + (summon is not null ? $" from {Registry.Card(summon.CardId).Name}'s Store" : "")
                    + ".");
                return null;
            }

            case ActionType.EndTurn:
            {
                var blocked = MainPhaseBlocker(state);
                if (blocked is not null) return blocked;
                if (state.Active != actor) return "Not your turn.";
                FinishTurn(state);
                return null;
            }
        }
        return "Unknown action.";
    }

    /// <summary>
    /// Battlecry targets are validated against the board as it stands before the
    /// summon lands, so an entering card never targets itself. A spec with no
    /// legal candidate is skipped and the battlecry simply does less.
    /// </summary>
    private static string? ValidateEnterTargets(GameState state, int me, CardDef def, TargetRef[] refs)
    {
        var specs = def.Targets ?? Array.Empty<TargetSpec>();
        if (refs.Length > specs.Length) return "Too many targets.";
        for (int i = 0; i < specs.Length; i++)
        {
            var spec = specs[i];
            var cands = TargetCandidates(state, me, spec, def);
            if (i >= refs.Length)
            {
                if (cands.Count > 0) return $"Missing target: {spec.Label}.";
                continue;
            }
            if (!cands.Contains(refs[i])) return $"Illegal target for {spec.Label}.";
        }
        return null;
    }

    private static string? PlaceSummon(GameState state, int actor, int handIndex, int slot,
        TargetRef[]? targets = null)
    {
        var me = state.Players[actor];
        if (handIndex < 0 || handIndex >= me.Hand.Count) return "No card at that hand index.";
        var id = me.Hand[handIndex];
        var def = Registry.Card(id);
        if (def.Type != CardType.Summon) return $"{def.Name} cannot stand in a slot.";
        if (slot < 0 || slot >= me.Slots.Length) return "No such slot.";
        if (me.Slots[slot] is not null) return "That slot is occupied.";
        var enterTargets = targets ?? Array.Empty<TargetRef>();
        var badTarget = ValidateEnterTargets(state, actor, def, enterTargets);
        if (badTarget is not null) return badTarget;

        me.Hand.RemoveAt(handIndex);
        me.PlaysThisTurn += 1;
        var summon = Effects.NewSummon(state, id, actor);
        me.Slots[slot] = summon;
        int wanted = def.Hp;
        int got = Effects.AssignHp(state, summon, wanted);
        Effects.Log(state, actor, got < wanted
            ? $"{def.Name} arrives with only {got} HP (deck ran short)."
            : $"{def.Name} arrives with {got} HP.");
        if (got == 0)
        {
            Effects.DestroySummon(state, summon);
            return null;
        }
        Effects.FireTrigger(state, summon, TriggerName.OnEnter, enterTargets);
        var landed = new[] { TargetRef.Summon(actor, slot) };
        foreach (var pl in state.Players)
        {
            foreach (var other in pl.Slots)
                if (other is not null && !ReferenceEquals(other, summon))
                    Effects.FireTrigger(state, other, TriggerName.OnSummonPlayed, landed);
            if (pl.Leader is not null && !ReferenceEquals(pl.Leader, summon))
                Effects.FireTrigger(state, pl.Leader, TriggerName.OnSummonPlayed, landed);
        }
        for (int p = 0; p < state.Players.Length; p++)
        {
            if (state.Players[p].Stage is not { } stageId) continue;
            var stageDef = Registry.TryCard(stageId);
            if (stageDef?.StageHooks?.OnSummonPlayed is not { } hook) continue;
            hook(new EffectCtx { State = state, Me = p, Card = stageDef, Targets = landed });
        }
        return null;
    }
}
