namespace Selatza;

/// <summary>
/// Everything a card is allowed to do to the game. Mirrors the TypeScript
/// EffectCtx one method at a time, so a card ported across reads the same.
/// </summary>
public sealed class EffectCtx
{
    public required GameState State { get; init; }
    public required int Me { get; init; }
    public int Opp => GameState.Other(Me);
    public SummonInstance? Source { get; init; }
    public required CardDef Card { get; init; }
    public TargetRef[] Targets { get; init; } = Array.Empty<TargetRef>();

    public TargetRef Target(int i) => Targets[i];
    public TargetRef? TargetOrNull(int i) => i < Targets.Length ? Targets[i] : null;

    public void Log(string message) => Effects.Log(State, Me, message);

    /// <summary>Damage from a card, so Effect Damage applies.</summary>
    public void Damage(TargetRef t, int amount) =>
        Effects.DealDamage(State, t, amount + Effects.EffectDamageOf(State, Me));

    /// <summary>Damage that skips Effect Damage, for a cost a card charges itself.</summary>
    public void RawDamage(TargetRef t, int amount) => Effects.DealDamage(State, t, amount);

    public void Wound(TargetRef t, int amount) => Effects.AddWounds(State, t, amount);
    public void Draw(int player, int count) => Effects.DrawCards(State, player, count);
    public void Mill(int player, int count) => Effects.Mill(State, player, count);
    public void Reinforce(TargetRef t, int count) => Effects.Reinforce(State, t, count);
    public void GrantEffectDamage(TargetRef t, int amount) =>
        Effects.GrantEffectDamage(State, t, amount);

    /// <summary>
    /// Solar's ramp: the top card of the deck goes straight into the supporter
    /// row rather than into hand. Sapped, so it pays nothing this turn and
    /// becomes a permanent mana source from the next one. The card itself is
    /// spent doing it, which is the price.
    /// </summary>
    public string? SupporterFromDeck(int player, bool sapped = true)
    {
        var p = State.Players[player];
        if (p.Deck.Count == 0)
        {
            Effects.Log(State, player, $"{p.Name} has nothing left to feed the row.");
            return null;
        }
        var id = p.Deck[0];
        p.Deck.RemoveAt(0);
        p.Supporters.Add(new Supporter { CardId = id, Sapped = sapped });
        Effects.Log(State, player,
            $"{Registry.Card(id).Name} is spent straight into the supporter row.");
        return id;
    }

    /// <summary>Power Shields, each stopping one instance of damage outright.</summary>
    public void Shield(TargetRef t, int count)
    {
        var s = State.Find(t);
        if (s is null || count <= 0) return;
        s.Shields += count;
        Effects.Log(State, Me, $"{Registry.Card(s.CardId).Name} raises {count} Power Shield(s).");
    }

    /// <summary>
    /// From a Deathrattle: this body goes back to its owner's hand rather than
    /// into the debt zone. The debt its level costs is still charged.
    /// </summary>
    public void ReturnToHand() => Effects.MarkReturnToHand();

    /// <summary>Fish: flipped HP cards come back to their owner's hand.</summary>
    public int Catch(TargetRef t, int count) => Effects.CatchHp(State, t, count);

    /// <summary>Oil: junk shuffled into a deck, each copy a bad flip waiting to happen.</summary>
    public int Curse(int player, string cardId, int count) =>
        Effects.CurseDeck(State, player, cardId, count);

    /// <summary>Put a named card straight into a supporter row, from nowhere.</summary>
    public void GiveSupporter(int player, string cardId, bool sapped = true)
    {
        State.Players[player].Supporters.Add(new Supporter { CardId = cardId, Sapped = sapped });
        Effects.Log(State, Me,
            $"{State.Players[player].Name} gains {Registry.Card(cardId).Name} as a supporter.");
    }

    /// <summary>Send a supporter to its owner's debt zone. The row closes up behind it.</summary>
    public bool DestroySupporter(TargetRef t)
    {
        if (t.Kind != TargetKind.Supporter) return false;
        var p = State.Players[t.Player];
        if (t.Index < 0 || t.Index >= p.Supporters.Count) return false;
        var s = p.Supporters[t.Index];
        p.Supporters.RemoveAt(t.Index);
        p.DebtZone.Add(s.CardId);
        Effects.Log(State, Me, $"{Registry.Card(s.CardId).Name} stops supporting.");
        return true;
    }

    /// <summary>Take a supporter back out of the row and into its owner's hand.</summary>
    public bool ReturnSupporter(TargetRef t)
    {
        if (t.Kind != TargetKind.Supporter) return false;
        var p = State.Players[t.Player];
        if (t.Index < 0 || t.Index >= p.Supporters.Count) return false;
        var s = p.Supporters[t.Index];
        p.Supporters.RemoveAt(t.Index);
        if (Effects.ToHand(State, t.Player, s.CardId))
        {
            Effects.Log(State, Me, $"{Registry.Card(s.CardId).Name} comes back off the supporter row.");
        }
        return true;
    }

    /// <summary>Reveal the top `count` of another player's deck for this one to take from.</summary>
    public void RaidDeck(int victim, int chooser, int count, string effect) =>
        Effects.RaidDeck(State, victim, chooser, count, effect, Card.Id);

    /// <summary>Oil: the hole a dead summon left stays open, and the leader behind it exposed.</summary>
    public void LockReplace(int player, int turns = 1)
    {
        var p = State.Players[player];
        p.ReplaceLocked = Math.Max(p.ReplaceLocked, turns);
        State.ReplaceQueue.RemoveAll(r => r.Player == player);
        Effects.Log(State, Me, $"{p.Name} cannot fill that slot yet.");
    }

    /// <summary>
    /// Robot at its least ethical: a card is pulled out of the other side's
    /// debt zone, rebuilt in Robot, and handed to you. It costs its old total
    /// in Robot and pays in Robot as a supporter, whatever it was printed as.
    /// </summary>
    public CardDef? Hack(int fromPlayer, Func<CardDef, bool> match)
    {
        var got = TakeFromDebt(fromPlayer, match);
        if (got is null) return null;
        // The taken card is swapped for a freshly minted Robot copy.
        var hand = State.Players[Me].Hand;
        hand[hand.LastIndexOf(got.Id)] = Generated.RobotCopy(got.Id);
        Effects.Log(State, Me, $"{got.Name} is rebuilt in Robot.");
        return got;
    }

    /// <summary>Oil and Robot: everything they cast costs this much more, from now on.</summary>
    public void TaxSpells(int player, int amount)
    {
        var p = State.Players[player];
        p.SpellTax = Math.Max(0, p.SpellTax + amount);
        Effects.Log(State, Me, amount > 0
            ? $"{p.Name}'s spells cost {amount} more."
            : $"{p.Name}'s spells get cheaper.");
    }

    /// <summary>Robot: take something out of a debt zone and put it in your hand.</summary>
    public CardDef? TakeFromDebt(int fromPlayer, Func<CardDef, bool> match)
    {
        var zone = State.Players[fromPlayer].DebtZone;
        for (int i = 0; i < zone.Count; i++)
        {
            var def = Registry.TryCard(zone[i]);
            if (def is null || !match(def)) continue;
            Effects.RemoveFromDebt(State, fromPlayer, i);
            if (Effects.ToHand(State, Me, def.Id))
            {
                Effects.Log(State, Me, $"{def.Name} is pulled out of the scrap.");
            }
            return def;
        }
        return null;
    }

    public void BuffStrength(TargetRef t, int amount, ModDuration d) =>
        Effects.BuffStrength(State, t, amount, d);
    public void Sap(TargetRef t) { var s = State.Find(t); if (s is not null) s.Sapped = true; }
    public void Unsap(TargetRef t) { var s = State.Find(t); if (s is not null) s.Sapped = false; }
    public void Dig(int player, int count, Func<CardDef, bool> match,
        string effect = "scry", string prompt = "Take a card", TargetRef? at = null) =>
        Effects.DigForCard(State, player, count, match, Card.Id, effect, prompt, at);

    /// <summary>Defer a board pick to this effect's controller, resolved by a registered key.</summary>
    // Default the anchor to the body asking. The client draws the targeting
    // arrow from here, and without it the arrow springs from nowhere.
    public void Choose(string effect, TargetRef[] refs, string prompt,
        bool optional = false, TargetRef? at = null, int? player = null) =>
        Effects.ChooseBoard(State, player ?? Me, Card.Id, effect, refs, prompt, optional,
            at ?? Self);

    public TargetRef[] DebtSummons(int player) => Effects.DebtSummonRefs(State, player);
    public TargetRef[] DiscardSpells(int player) => Effects.DiscardSpellRefs(State, player);
    public void ScryDiscard(int player, int count, Func<CardDef, bool> match) =>
        Effects.ScryDiscardPile(State, player, count, match, Card.Id);
    public void RecycleDiscard(int player, int count) => Effects.RecycleDiscard(State, player, count);
    public bool RecycleTopDiscard(int player) => Effects.RecycleTopDiscard(State, player);
    public SummonInstance? SummonAt(TargetRef t) => State.Find(t);
    public void Destroy(TargetRef t)
    {
        var s = State.Find(t);
        if (s is not null) Effects.DestroySummon(State, s);
    }

    /// <summary>Removes a body from play for good: no debt zone, no coming back.</summary>
    public void Annihilate(TargetRef t)
    {
        var s = State.Find(t);
        if (s is not null) Effects.Annihilate(State, s);
    }

    /// <summary>Strips cards off a discard pile for good, newest first.</summary>
    public int AnnihilateDiscard(int player, int count) =>
        Effects.AnnihilateDiscard(State, player, count);

    /// <summary>Adds Effect Damage to this player's next spell this turn.</summary>
    public void GrantSpellBonus(int amount) =>
        State.Players[Me].SpellBonus += amount;

    /// <summary>
    /// Destroys a body and takes its card as face-down HP on the summon running
    /// this effect. No debt is charged: the card never reaches the debt zone.
    /// </summary>
    public bool Devour(TargetRef t) => Effects.Devour(State, Source, t);
    public CardDef? ReviveFromDebt(int player, Func<CardDef, bool> match) =>
        Effects.ReviveFromDebt(State, player, match);

    /// <summary>The most recent matching card in a discard pile comes back to your hand.</summary>
    public CardDef? ReviveFromDiscard(int player, Func<CardDef, bool>? match = null)
    {
        var pile = State.Players[player].Discard;
        int idx = pile.Count - 1;
        while (idx >= 0 && match is not null && !match(Registry.Card(pile[idx]))) idx--;
        if (idx < 0) return null;
        var id = pile[idx];
        pile.RemoveAt(idx);
        if (Effects.ToHand(State, Me, id))
        {
            Effects.Log(State, Me, $"{Registry.Card(id).Name} comes back from the discard pile.");
        }
        return Registry.Card(id);
    }

    /// <summary>A targeted discard-pile card comes back to your hand.</summary>
    public CardDef? Reclaim(TargetRef target)
    {
        if (target.Kind != TargetKind.Discard) return null;
        var pile = State.Players[target.Player].Discard;
        if (target.Index < 0 || target.Index >= pile.Count) return null;
        var id = pile[target.Index];
        pile.RemoveAt(target.Index);
        if (Effects.ToHand(State, Me, id))
        {
            Effects.Log(State, Me, $"{Registry.Card(id).Name} comes back from the discard pile.");
        }
        return Registry.Card(id);
    }

    /// <summary>A random card out of a discard pile, into your hand.</summary>
    public CardDef? DrawRandomFromDiscard(int player)
    {
        var pile = State.Players[player].Discard;
        if (pile.Count == 0) return null;
        var rng = new Rng(State.RngState);
        int at = rng.NextInt(pile.Count);
        State.RngState = rng.State;
        var id = pile[at];
        pile.RemoveAt(at);
        if (Effects.ToHand(State, Me, id))
        {
            Effects.Log(State, Me, $"{Registry.Card(id).Name} is fished out of the discard pile.");
        }
        return Registry.Card(id);
    }

    /// <summary>Takes the card at a debt-pile index, healing its level off the debt counter.</summary>
    public string? RemoveFromDebt(int player, int index) => Effects.RemoveFromDebt(State, player, index);

    public int? EmptySlot(int player)
    {
        var slots = State.Players[player].Slots;
        for (int i = 0; i < slots.Length; i++) if (slots[i] is null) return i;
        return null;
    }

    public string? TakeFromHand(int player, int index)
    {
        var hand = State.Players[player].Hand;
        if (index < 0 || index >= hand.Count) return null;
        var id = hand[index];
        hand.RemoveAt(index);
        return id;
    }

    public SummonInstance? PutSummon(int player, string cardId, int slot, int strength, Color color,
        int hp, int level = 1, bool asPrinted = false) =>
        Effects.PutSummonDirect(State, player, cardId, slot, strength, color, hp, level, asPrinted);

    // --- structural verbs -----------------------------------------------------

    public bool StackHp(TargetRef t, int handIndex)
    {
        var s = State.Find(t);
        var hand = State.Players[Me].Hand;
        if (s is null || handIndex < 0 || handIndex >= hand.Count) return false;
        var id = hand[handIndex];
        hand.RemoveAt(handIndex);
        s.Hp.Add(new HpCard { CardId = id, Flipped = false });
        Log($"A card from hand slides under {Registry.Card(s.CardId).Name} as HP.");
        return true;
    }

    public int MoveHp(TargetRef from, TargetRef to, int count) =>
        Effects.MoveHpCards(State, from, to, count);
    public int Unflip(TargetRef t, int count) => Effects.UnflipHp(State, t, count);
    public bool Bounce(TargetRef t) => Effects.BounceSummon(State, t);

    /// <summary>A body in play goes back into its owner's deck, charging no debt.</summary>
    public bool ShuffleIntoDeck(TargetRef t) => Effects.ShuffleSummonIntoDeck(State, t);

    /// <summary>A player's whole hand goes back into their deck. Returns how many.</summary>
    public int ShuffleHandIntoDeck(int player) => Effects.ShuffleHandIntoDeck(State, player);
    public bool Transform(TargetRef t, string cardId) => Effects.TransformSummon(State, t, cardId);
    public bool TakeControl(TargetRef t) => Effects.TakeControlOf(State, t, Me);

    public void AddDebt(int player, int amount, string? reason = null) =>
        Effects.AddDebt(State, player, amount,
            reason ?? $"{State.Players[player].Name} takes {amount} debt.");
    public void ClearDebt(int player, int amount) => Effects.ClearDebt(State, player, amount);

    public bool DebtToHp(TargetRef t, int debtIndex)
    {
        var s = State.Find(t);
        var debt = State.Players[Me].DebtZone;
        if (s is null || debtIndex < 0 || debtIndex >= debt.Count) return false;
        var id = Effects.RemoveFromDebt(State, Me, debtIndex)!;
        s.Hp.Add(new HpCard { CardId = id, Flipped = false });
        Log($"{Registry.Card(id).Name} climbs out of debt as HP.");
        return true;
    }

    public int CountFaction(int player, Faction f) => Effects.CountFaction(State, player, f);
    public TargetRef[] SummonsOf(int player, bool includeLeader = false) =>
        Effects.SummonRefsOf(State, player, includeLeader);
    public void ToHand(int player, string cardId) => Effects.ToHand(State, player, cardId);

    public string? Discard(int player, int index)
    {
        var hand = State.Players[player].Hand;
        if (index < 0 || index >= hand.Count) return null;
        var id = hand[index];
        hand.RemoveAt(index);
        Effects.ToDiscard(State, player, id);
        return id;
    }

    /// <summary>The board position of the summon whose power or trigger is running.</summary>
    public TargetRef? Self => Source is null ? null : Effects.RefFor(State, Source);
}

/// <summary>What a card can do when it is flipped face up as damage.</summary>
public sealed class FlipCtx
{
    public required GameState State { get; init; }
    public required int Me { get; init; }
    public int Opp => GameState.Other(Me);
    public required SummonInstance Holder { get; init; }
    public required CardDef Card { get; init; }

    /// <summary>Defer a board pick to the flip's owner, resolved by a registered key.</summary>
    public void Choose(string effect, TargetRef[] refs, string prompt,
        bool optional = false, TargetRef? at = null, int? player = null) =>
        Effects.ChooseBoard(State, player ?? Me, Card.Id, effect, refs, prompt, optional, at);

    public TargetRef[] DebtSummons(int player) => Effects.DebtSummonRefs(State, player);
    public TargetRef[] SupportersOf(int player) => Effects.SupporterRefsOf(State, player);

    /// <summary>Empties a player's floating mana pool. Returns how many pips were lost.</summary>
    public int ClearMana(int player)
    {
        var pool = State.Players[player].Mana;
        int lost = 0;
        foreach (int n in pool) lost += n;
        Array.Clear(pool);
        return lost;
    }

    public TargetRef[] DiscardSpells(int player) => Effects.DiscardSpellRefs(State, player);
    public void RecycleDiscard(int player, int count) => Effects.RecycleDiscard(State, player, count);
    public SummonInstance? SummonAt(TargetRef t) => State.Find(t);

    /// <summary>Flip nesting level: this ctx's damage and wounds carry it, so a
    /// chain of damage-flips and heal-flips cannot recurse without limit.</summary>
    public int Depth { get; init; }

    public void Log(string message) => Effects.Log(State, Me, message);
    public void Damage(TargetRef t, int amount) =>
        Effects.DealDamage(State, t, amount + Effects.EffectDamageOf(State, Me), Depth);
    public void Wound(TargetRef t, int amount) => Effects.AddWounds(State, t, amount, Depth);
    public void Draw(int player, int count) => Effects.DrawCards(State, player, count);
    public void Mill(int player, int count) => Effects.Mill(State, player, count);
    public void Reinforce(TargetRef t, int count) => Effects.Reinforce(State, t, count);
    public void GrantEffectDamage(TargetRef t, int amount) =>
        Effects.GrantEffectDamage(State, t, amount);
    public void Shield(TargetRef t, int count)
    {
        var s = State.Find(t);
        if (s is not null && count > 0) s.Shields += count;
    }
    /// <summary>
    /// Sends the summon this card was protecting to the debt zone. Free when the
    /// body was going to fall anyway, a real decision when it was not.
    /// </summary>
    public void DestroyHolder() => Effects.DestroySummon(State, Holder);

    /// <summary>This flipped card leaves the body it was protecting for the discard pile.</summary>
    public bool DiscardThis()
    {
        int at = Holder.Hp.FindIndex(h => h.Flipped && h.CardId == Card.Id);
        if (at < 0) return false;
        var gone = Holder.Hp[at];
        Holder.Hp.RemoveAt(at);
        Effects.ToDiscard(State, Holder.Owner, gone.CardId);
        return true;
    }

    public string? SupporterFromDeck(int player, bool sapped = true)
    {
        var p = State.Players[player];
        if (p.Deck.Count == 0) return null;
        var id = p.Deck[0];
        p.Deck.RemoveAt(0);
        p.Supporters.Add(new Supporter { CardId = id, Sapped = sapped });
        Effects.Log(State, player,
            $"{Registry.Card(id).Name} is spent straight into the supporter row.");
        return id;
    }
    public int Catch(TargetRef t, int count) => Effects.CatchHp(State, t, count);
    public int Curse(int player, string cardId, int count) =>
        Effects.CurseDeck(State, player, cardId, count);
    public void LockReplace(int player, int turns = 1)
    {
        var p = State.Players[player];
        p.ReplaceLocked = Math.Max(p.ReplaceLocked, turns);
        State.ReplaceQueue.RemoveAll(r => r.Player == player);
        Effects.Log(State, Me, $"{p.Name} cannot fill that slot yet.");
    }
    public void BuffStrength(TargetRef t, int amount, ModDuration d) =>
        Effects.BuffStrength(State, t, amount, d);
    public CardDef? ReviveFromDebt(int player, Func<CardDef, bool> match) =>
        Effects.ReviveFromDebt(State, player, match);
    public int Unflip(TargetRef t, int count) => Effects.UnflipHp(State, t, count);
    public void AddDebt(int player, int amount, string? reason = null) =>
        Effects.AddDebt(State, player, amount,
            reason ?? $"{State.Players[player].Name} takes {amount} debt.");
    public void ClearDebt(int player, int amount) => Effects.ClearDebt(State, player, amount);
    public TargetRef[] SummonsOf(int player, bool includeLeader = false) =>
        Effects.SummonRefsOf(State, player, includeLeader);
    public void ToHand(int player, string cardId) => Effects.ToHand(State, player, cardId);

    /// <summary>The board position of the summon this card was protecting.</summary>
    public TargetRef HolderRef => Effects.RefFor(State, Holder);
}

public enum TriggerName
{
    OnEnter, OnDeath, OnAttack, OnDefend, OnAwake, OnEndTurn, OnOtherDeath,
    OnSpellCast, OnEnemySpellCast, OnEnemyPower, OnSummonPlayed, OnSurvive,
}

public static class Effects
{
    /// <summary>Guards against a flip effect that damages something whose flip damages back.</summary>
    private const int MaxFlipDepth = 8;

    /// <summary>
    /// The same guard for triggers that fire other triggers. Slime replaces
    /// itself when it dies, and a replacement drawn against an empty deck
    /// arrives with no HP and dies again immediately. The debt a death costs is
    /// added only after the trigger has fired, which is deliberate, so the debt
    /// limit cannot be what ends it. Nothing in the set legitimately nests this
    /// far, and an unbounded chain takes the process down with it.
    /// </summary>
    private const int MaxTriggerDepth = 8;

    /// <summary>Trigger nesting, per thread because simulations run in parallel.</summary>
    [ThreadStatic]
    private static int _triggerDepth;

    /// <summary>
    /// Set by a Deathrattle that sends its own body back to hand. A dying summon
    /// is in flight when its trigger runs, in neither the slot nor the debt zone,
    /// so the trigger cannot move the card itself: it raises this instead and the
    /// destroy routes the body to the hand rather than into debt. Minting a fresh
    /// copy would let one card become two and break the deckbuilding limit.
    /// </summary>
    [ThreadStatic]
    private static bool _returnToHand;

    /// <summary>
    /// The body eating this one. Set for the length of a single destroy: the eaten
    /// card goes face down under the eater instead of into the debt zone, and no
    /// debt is charged, because the card never reaches the zone the counter counts.
    /// </summary>
    /// ThreadStatic like the flag above it: the trainer plays many games in
    /// parallel over this one class, and a shared eater would route a dying card
    /// onto a summon belonging to somebody else's game.
    [ThreadStatic]
    private static SummonInstance? _eater;

    /// <summary>
    /// Annihilation: the body is silenced, then removed from play instead of
    /// going anywhere. None of its own text runs, so no Deathrattle fires and
    /// nothing it was granted fires either, and it never reaches the debt zone,
    /// so its owner is never charged for it. Other cards still see the death.
    /// ThreadStatic for the same reason as the two above.
    /// </summary>
    [ThreadStatic]
    private static bool _annihilate;

    /// <summary>Effect Damage lent to the spell currently resolving.</summary>
    [ThreadStatic]
    private static int _spellBonus;

    public static void Log(GameState state, int player, string text) =>
        state.Log.Add(new LogEntry(state.Turn, player, text));

    /// <summary>A body the player owes for. This is what the debt counter counts.</summary>
    public static void ToDebt(GameState state, int player, string cardId) =>
        state.Players[player].DebtZone.Add(cardId);

    /// <summary>Anything else that has been spent. Costs nothing by itself.</summary>
    /// <summary>True while that side holds a body whose aura voids its discard pile.</summary>
    public static bool VoidsDiscard(GameState state, int player)
    {
        var p = state.Players[player];
        foreach (var s in p.Slots)
        {
            if (s is not null && Registry.Card(s.CardId).VoidsDiscard) return true;
        }
        if (p.Leader is not null && Registry.Card(p.Leader.CardId).VoidsDiscard) return true;
        return p.Stage is not null && (Registry.TryCard(p.Stage)?.VoidsDiscard ?? false);
    }

    public static void ToDiscard(GameState state, int player, string cardId)
    {
        if (VoidsDiscard(state, player)) return;
        state.Players[player].Discard.Add(cardId);
    }

    /// <summary>
    /// The only way a card reaches a hand. A hand that is already full sends
    /// whatever arrives next to the discard pile instead, so cards drawn past the
    /// limit are spent rather than stored. False when the card was turned away.
    /// </summary>
    public static bool ToHand(GameState state, int player, string cardId)
    {
        var p = state.Players[player];
        if (p.Hand.Count >= Rules.HandLimit)
        {
            Log(state, player,
                $"{Registry.Card(cardId).Name} is discarded. Hand is full at {Rules.HandLimit}.");
            ToDiscard(state, player, cardId);
            return false;
        }
        p.Hand.Add(cardId);
        return true;
    }

    /// <summary>Debt charged for running the deck out and turning the discard over.</summary>
    public const int ReshuffleDebt = 3;

    /// <summary>
    /// Added to the bill on every deck-out after the first, so the second costs
    /// 6, the third 9, and a deck that survives on cycling eventually cannot.
    /// </summary>
    public const int ReshuffleDebtStep = 3;

    /// <summary>What the next deck-out will cost this player, before it happens.</summary>
    public static int ReshuffleCost(GameState state, int player) =>
        ReshuffleDebt + state.Players[player].DeckOuts * ReshuffleDebtStep;

    /// <summary>Debt charged per card a mill cannot take, because there is none.</summary>
    public const int MillDebt = 1;

    /// <summary>
    /// Drawing off an empty deck turns the discard pile over rather than ending
    /// the game: you pay the debt and keep playing. The debt is the clock, and it
    /// climbs each time round, so a deck that survives on cycling runs out of rope.
    /// </summary>
    public static int DrawCards(GameState state, int player, int count)
    {
        var p = state.Players[player];
        int drawn = 0;
        for (int i = 0; i < count; i++)
        {
            if (p.Deck.Count == 0)
            {
                // Charged whether or not there is a pile to turn over. With nothing
                // left anywhere the debt is the only thing still moving, and without
                // it two empty decks sit across from each other forever.
                int owed = ReshuffleCost(state, player);
                p.DeckOuts += 1;
                AddDebt(state, player, owed,
                    $"{p.Name} runs out of cards for {owed} debt.");
                if (state.Winner >= 0) break;
                if (p.Discard.Count == 0) break;
                var pile = new List<string>(p.Discard);
                p.Discard.Clear();
                var rng = new Rng(state.RngState);
                rng.Shuffle(pile);
                state.RngState = rng.State;
                p.Deck.AddRange(pile);
            }
            var id = p.Deck[0];
            p.Deck.RemoveAt(0);
            ToHand(state, player, id);
            drawn++;
        }
        return drawn;
    }

    /// <summary>The only place debt is added, so the loss check can never be skipped.</summary>
    public static void AddDebt(GameState state, int player, int amount, string reason)
    {
        // Charged even once the match has been decided. The action that decided
        // it is still resolving, and a second bill falling due inside that
        // action is what a tie looks like; EndGame settles who the tie belongs to.
        if (amount <= 0) return;
        var p = state.Players[player];
        p.DebtCount += amount;
        Log(state, player, $"{reason} Debt is now {p.DebtCount}/{Rules.DebtLimit}.");
        if (p.DebtCount >= Rules.DebtLimit)
        {
            EndGame(state, GameState.Other(player), $"{p.Name} reached {Rules.DebtLimit} debt.");
        }
    }

    public static void ClearDebt(GameState state, int player, int amount)
    {
        if (amount <= 0) return;
        var p = state.Players[player];
        int paid = Math.Min(amount, p.DebtCount);
        if (paid == 0) return;
        p.DebtCount -= paid;
        Log(state, player, $"{p.Name} pays off {paid} debt, down to {p.DebtCount}/{Rules.DebtLimit}.");
    }

    /// <summary>
    /// Milling an empty deck charges debt instead. There is nothing left to put
    /// in the discard pile, so the effect lands on the only thing it still can,
    /// and mill keeps meaning something against a player already run out.
    /// </summary>
    public static void Mill(GameState state, int player, int count)
    {
        var p = state.Players[player];
        int dry = 0;
        for (int i = 0; i < count; i++)
        {
            if (p.Deck.Count == 0)
            {
                dry++;
                continue;
            }
            var id = p.Deck[0];
            p.Deck.RemoveAt(0);
            ToDiscard(state, player, id);
        }
        if (dry > 0)
        {
            int owed = dry * MillDebt;
            AddDebt(state, player, owed, $"{p.Name} has nothing left to mill and takes {owed} debt.");
        }
    }

    public static int AssignHp(GameState state, SummonInstance summon, int count)
    {
        var p = state.Players[summon.Owner];
        int added = 0;
        int scavenged = 0;
        for (int i = 0; i < count; i++)
        {
            string? id = null;
            if (p.Deck.Count > 0)
            {
                id = p.Deck[0];
                p.Deck.RemoveAt(0);
            }
            else if (p.Discard.Count > 0)
            {
                // An empty deck is not the end: HP comes out of the discard pile at random.
                var rng = new Rng(state.RngState);
                int at = rng.NextInt(p.Discard.Count);
                state.RngState = rng.State;
                id = p.Discard[at];
                p.Discard.RemoveAt(at);
                scavenged++;
            }
            if (id is null) break;
            summon.Hp.Add(new HpCard { CardId = id, Flipped = false });
            added++;
        }
        if (scavenged > 0)
        {
            Log(state, summon.Owner, $"{scavenged} HP card(s) scavenged from the discard pile.");
        }
        return added;
    }

    public static void Reinforce(GameState state, TargetRef t, int count)
    {
        var s = state.Find(t);
        if (s is not null) AssignHp(state, s, count);
    }

    /// <summary>Effect Damage added to this body for as long as it stays in play.</summary>
    public static void GrantEffectDamage(GameState state, TargetRef t, int amount)
    {
        var s = state.Find(t);
        if (s is not null) s.EffectDamageMod += amount;
    }

    public static void BuffStrength(GameState state, TargetRef t, int amount, ModDuration d)
    {
        var s = state.Find(t);
        s?.StrengthMods.Add(new StrengthMod(amount, d));
    }

    public static SummonInstance NewSummon(GameState state, string cardId, int owner,
        bool isLeader = false, SummonOverride? over = null)
    {
        var s = new SummonInstance
        {
            Uid = "s" + state.NextUid++,
            CardId = cardId,
            Owner = owner,
            IsLeader = isLeader,
            EnteredTurn = state.Turn,
            Override = over,
        };
        return s;
    }

    public static TargetRef RefFor(GameState state, SummonInstance summon)
    {
        if (summon.IsLeader) return TargetRef.Leader(summon.Owner);
        var slots = state.Players[summon.Owner].Slots;
        int slot = Array.IndexOf(slots, summon);
        return TargetRef.Summon(summon.Owner, slot);
    }

    public static TargetRef[] SummonRefsOf(GameState state, int player, bool includeLeader = false)
    {
        var list = new List<TargetRef>(3);
        var slots = state.Players[player].Slots;
        for (int i = 0; i < slots.Length; i++) if (slots[i] is not null) list.Add(TargetRef.Summon(player, i));
        if (includeLeader && state.Players[player].Leader is not null) list.Add(TargetRef.Leader(player));
        return list.ToArray();
    }

    /// <summary>Refs for every supporter in a player's row, sapped or not.</summary>
    public static TargetRef[] SupporterRefsOf(GameState state, int player)
    {
        var row = state.Players[player].Supporters;
        var list = new List<TargetRef>(row.Count);
        for (int i = 0; i < row.Count; i++) list.Add(TargetRef.Supporter(player, i));
        return list.ToArray();
    }

    public static int CountFaction(GameState state, int player, Faction f)
    {
        int n = 0;
        foreach (var r in SummonRefsOf(state, player, true))
        {
            var s = state.Find(r);
            if (s is null) continue;
            var def = Registry.TryCard(s.CardId);
            if (def is not null && def.HasFaction(f)) n++;
        }
        return n;
    }

    public static void FireTrigger(GameState state, SummonInstance? summon, TriggerName name,
        TargetRef[]? targets = null)
    {
        if (summon is null || state.Winner >= 0) return;
        var def = Registry.TryCard(summon.CardId);
        var t = def?.Triggers;
        if (def is null || t is null) return;
        var fn = name switch
        {
            TriggerName.OnEnter => t.OnEnter,
            TriggerName.OnDeath => t.OnDeath,
            TriggerName.OnAttack => t.OnAttack,
            TriggerName.OnDefend => t.OnDefend,
            TriggerName.OnEndTurn => t.OnEndTurn,
            TriggerName.OnOtherDeath => t.OnOtherDeath,
            TriggerName.OnSpellCast => t.OnSpellCast,
            TriggerName.OnEnemySpellCast => t.OnEnemySpellCast,
            TriggerName.OnEnemyPower => t.OnEnemyPower,
            TriggerName.OnSurvive => t.OnSurvive,
            TriggerName.OnSummonPlayed => t.OnSummonPlayed,
            _ => t.OnAwake,
        };
        if (fn is null || _triggerDepth >= MaxTriggerDepth) return;
        _triggerDepth++;
        // A trigger that wrote nothing to the log did nothing worth announcing,
        // which is the difference between a card that reacted and a card that
        // merely could have. Read before and after rather than asked of the
        // effect, so no card has to remember to say it fired.
        int quiet = state.Log.Count;
        var at = RefFor(state, summon);
        try
        {
            fn(new EffectCtx
            {
                State = state,
                Me = summon.Owner,
                Source = summon,
                Card = def,
                Targets = targets ?? Array.Empty<TargetRef>(),
            });
        }
        finally
        {
            _triggerDepth--;
        }
        if (state.Log.Count > quiet)
        {
            state.Fx.Add(new EffectFx { CardId = summon.CardId, Player = summon.Owner, At = at });
        }
    }

    /// <summary>
    /// Flip face-down HP cards one at a time, resolving each flip effect before
    /// the next, then send the summon to debt if nothing face-down remains.
    /// </summary>
    public static int DealDamage(GameState state, TargetRef r, int amount, int depth = 0,
        bool muffle = false)
    {
        var summon = state.Find(r);
        // Not stopped by a game that has just been won. A blow aimed at every
        // character lands on every character, so one that reaches both leaders
        // takes both, and the match is settled once all of it has resolved.
        if (summon is null || amount <= 0) return 0;
        var def = Registry.Card(summon.CardId);
        // A Power Shield stops the whole instance, however big, and is spent.
        if (summon.Shields > 0)
        {
            summon.Shields--;
            Log(state, summon.Owner, $"A Power Shield on {def.Name} takes all {amount} of it.");
            return 0;
        }
        return TurnCards(state, summon, amount, depth, muffle);
    }

    /// <summary>
    /// Turn HP cards over one at a time, and stop dead at a costed flip.
    ///
    /// A costed flip is a question for its owner, and the rest of the blow waits
    /// on the answer. Damage used to carry straight past it: the body ran out of
    /// cards, died, and its owner was then asked to pay for something protecting
    /// a body already in the debt pile. A flip that heals what it was covering
    /// has to fire while there is still something to heal, and that is true of
    /// the last card as much as the first.
    /// </summary>
    private static int TurnCards(GameState state, SummonInstance summon, int amount,
        int depth, bool muffle)
    {
        var def = Registry.Card(summon.CardId);
        int muted = 0;
        for (int i = 0; i < amount; i++)
        {
            HpCard? next = null;
            foreach (var h in summon.Hp) if (!h.Flipped) { next = h; break; }
            if (next is null) break;
            next.Flipped = true;
            var flipped = Registry.Card(next.CardId);
            Log(state, summon.Owner,
                $"{def.Name} flips {flipped.Name} ({summon.RemainingHp} HP left).");
            if (flipped.Flip is not null && depth < MaxFlipDepth)
            {
                if (muffle)
                {
                    // The attacker mutes the flip: it turns over and does nothing.
                    muted++;
                    Log(state, summon.Owner, $"{flipped.Name}'s FLIP is muted.");
                }
                else if (flipped.FlipCost is not null)
                {
                    // The blow stops here. What is left of it is parked on the
                    // offer, and the body is not settled until the offer is
                    // answered, even at 0 HP.
                    state.FlipQueue.Add(new FlipOffer(
                        summon.Owner, RefFor(state, summon), next.CardId, amount - i - 1, depth));
                    return muted;
                }
                else
                {
                    flipped.Flip(new FlipCtx
                    {
                        State = state,
                        Me = summon.Owner,
                        Holder = summon,
                        Card = flipped,
                        Depth = depth + 1,
                    });
                }
            }
            if (summon.RemainingHp > 0 && def.Frenzy && !summon.FrenzyUsed
                && def.Triggers?.OnSurvive is not null && depth < MaxFlipDepth)
            {
                summon.FrenzyUsed = true;
                Log(state, summon.Owner, $"{def.Name} frenzies.");
                FireTrigger(state, summon, TriggerName.OnSurvive);
            }
        }
        SettleBody(state, summon);
        return muted;
    }

    /// <summary>Send a body to debt once it has nothing face down left to lose.</summary>
    private static void SettleBody(GameState state, SummonInstance summon)
    {
        if (summon.RemainingHp == 0) DestroySummon(state, summon);
    }

    /// <summary>
    /// Land whatever the answered flip was holding up, then settle the body.
    ///
    /// Called from both sides of the question, because declining is an answer
    /// too: the points still owed arrive either way and only the flip's own
    /// effect turns on whether it was paid for.
    /// </summary>
    public static void ResumeDamage(GameState state, FlipOffer offer)
    {
        var holder = state.Find(offer.Holder);
        if (holder is null) return;
        if (offer.Pending > 0)
        {
            TurnCards(state, holder, offer.Pending, offer.Depth, false);
            return;
        }
        SettleBody(state, holder);
    }

    /// <summary>Whether the other side fields anything forbidding this player supporters.</summary>
    public static bool SupporterLocked(GameState state, int owner)
    {
        var foe = state.Players[owner == 0 ? 1 : 0];
        foreach (var s in foe.Slots)
            if (s is not null && Registry.Card(s.CardId).SupporterLock) return true;
        if (foe.Leader is not null && Registry.Card(foe.Leader.CardId).SupporterLock) return true;
        return foe.Stage is not null && Registry.Card(foe.Stage).SupporterLock;
    }

    /// <summary>Wounds convert at 2 per damage, or 1 while the other side fields an amplifier.</summary>
    private static int WoundRate(GameState state, int owner)
    {
        var foe = state.Players[GameState.Other(owner)];
        foreach (var s in foe.Slots)
        {
            if (s is not null && Registry.Card(s.CardId).WoundAmplify) return 1;
        }
        if (foe.Leader is not null && Registry.Card(foe.Leader.CardId).WoundAmplify) return 1;
        if (foe.Stage is not null && Registry.Card(foe.Stage).WoundAmplify) return 1;
        return 2;
    }

    public static void AddWounds(GameState state, TargetRef r, int amount, int depth = 0)
    {
        var summon = state.Find(r);
        if (summon is null || amount <= 0) return;
        summon.Wounds += amount;
        var def = Registry.Card(summon.CardId);
        Log(state, summon.Owner, $"{def.Name} takes {amount} wound(s).");
        int rate = WoundRate(state, summon.Owner);
        while (summon.Wounds >= rate)
        {
            summon.Wounds -= rate;
            DealDamage(state, RefFor(state, summon), 1, depth);
            if (summon.RemainingHp == 0) return;
        }
    }

    public static bool Devour(GameState state, SummonInstance? source, TargetRef t)
    {
        var victim = state.Find(t);
        if (source is null || victim is null || ReferenceEquals(victim, source)) return false;
        var outer = _eater;
        _eater = source;
        try { DestroySummon(state, victim); }
        finally { _eater = outer; }
        return true;
    }

    public static void DestroySummon(GameState state, SummonInstance summon)
    {
        // Consumed by this destroy alone: a Deathrattle that kills something
        // else must not annihilate it as a side effect.
        bool annihilated = _annihilate;
        _annihilate = false;
        var p = state.Players[summon.Owner];
        var def = Registry.Card(summon.CardId);
        // Reborn answers before anything else a death does: no zone, no debt,
        // no Deathrattle, so nothing that punishes dying gets to punish this.
        if (def.Reborn && !summon.RebornUsed && !annihilated && !summon.IsLeader)
        {
            summon.RebornUsed = true;
            summon.Hp.Clear();
            summon.Hp.Add(new HpCard { CardId = summon.CardId });
            summon.Wounds = 0;
            summon.Shields = 0;
            Log(state, summon.Owner, $"{def.Name} is reborn.");
            return;
        }
        if (summon.IsLeader)
        {
            p.Leader = null;
            Log(state, summon.Owner, $"{def.Name} has died.");
            EndGame(state, GameState.Other(summon.Owner), $"{p.Name} lost their leader.");
            return;
        }
        int slot = Array.IndexOf(p.Slots, summon);
        if (slot < 0) return;
        p.Slots[slot] = null;

        // Fires while the debt is still unpaid, so a card can discount its own death.
        // Annihilation silences the body first, so none of its own text runs.
        bool outer = _returnToHand;
        _returnToHand = false;
        if (!annihilated) FireTrigger(state, summon, TriggerName.OnDeath);
        // A Deathrattle bestowed by another card fires after the body's own.
        var bestowed = annihilated || summon.Bestowed is null
            ? null : Registry.TryCard(summon.Bestowed);
        var bfn = bestowed?.Triggers?.OnDeath;
        if (bfn is not null && bestowed is not null && _triggerDepth < MaxTriggerDepth)
        {
            _triggerDepth++;
            try
            {
                bfn(new EffectCtx
                {
                    State = state,
                    Me = summon.Owner,
                    Source = summon,
                    Card = bestowed,
                    Targets = Array.Empty<TargetRef>(),
                });
            }
            finally
            {
                _triggerDepth--;
            }
        }
        bool handBack = _returnToHand;
        _returnToHand = outer;

        var eatenBy = _eater;
        if (annihilated)
        {
            Log(state, summon.Owner, $"{def.Name} is annihilated.");
        }
        else if (handBack)
        {
            if (ToHand(state, summon.Owner, summon.CardId))
            {
                Log(state, summon.Owner, $"{def.Name} goes back to hand instead of into debt.");
            }
        }
        else if (eatenBy is not null)
        {
            eatenBy.Hp.Add(new HpCard { CardId = summon.CardId });
            Log(state, summon.Owner, $"{Registry.Card(eatenBy.CardId).Name} eats {def.Name}.");
        }
        else
        {
            ToDebt(state, summon.Owner, summon.CardId);
        }
        foreach (var h in summon.Hp) ToDiscard(state, summon.Owner, h.CardId);
        if (eatenBy is null && !annihilated)
        {
            int level = GameState.LevelOf(summon, def);
            AddDebt(state, summon.Owner, level, $"{def.Name} dies for {level} debt.");
        }
        if (state.Winner >= 0) return;

        // Every other body in play sees the death, whichever side it was on.
        state.DyingOwner = summon.Owner;
        state.DyingCardId = summon.CardId;
        foreach (var pl in state.Players)
        {
            foreach (var other in pl.Slots)
            {
                if (other is not null && !ReferenceEquals(other, summon))
                {
                    FireTrigger(state, other, TriggerName.OnOtherDeath);
                }
            }
            if (pl.Leader is not null && !ReferenceEquals(pl.Leader, summon))
            {
                FireTrigger(state, pl.Leader, TriggerName.OnOtherDeath);
            }
        }
        state.DyingOwner = null;
        state.DyingCardId = null;
        if (state.Winner >= 0) return;

        // On the owner's own turn the main phase already lets them refill, so
        // the immediate-replacement prompt is only for the side not on the play.
        if (summon.Owner == state.Active) return;
        // And only while the hole is still there. A Deathrattle that refills the
        // slot it just left closed it before this ran: Slime stands a smaller
        // Slime up in the first empty slot, which is its own, and the offer went
        // out anyway. The player was asked to fill a slot with a Slime already
        // standing in it, and a chain of them asked once a link.
        if (p.Slots[slot] is not null) return;
        foreach (var id in p.Hand)
        {
            if (Registry.Card(id).Type == CardType.Summon)
            {
                state.ReplaceQueue.Add(new ReplaceSlot(summon.Owner, slot));
                break;
            }
        }
    }

    /// <summary>
    /// Drop replace offers nobody can answer any more.
    ///
    /// An offer is made the moment a body falls, and the board moves on before
    /// it is put to its owner: two bodies dying together queue two offers,
    /// answering the first can empty the hand, and the second is then a question
    /// with no answer. Something else refilling the slot has the same effect.
    /// Checked after every action rather than only when the offer is made,
    /// because that is when it stops being true.
    /// </summary>
    public static void SweepReplaceQueue(GameState state)
    {
        if (state.ReplaceQueue.Count == 0) return;
        state.ReplaceQueue.RemoveAll(offer =>
        {
            var p = state.Players[offer.Player];
            if (p.Slots[offer.Slot] is not null) return true;
            foreach (var id in p.Hand)
            {
                if (Registry.TryCard(id)?.Type == CardType.Summon) return false;
            }
            return true;
        });
    }

    public static void EndGame(GameState state, int winner, string reason)
    {
        if (state.Winner >= 0)
        {
            // The player the first loss handed the match to has now lost as well.
            // Nothing calls this outside an action, so both losses came out of
            // one, and neither player is owed the win. The recorded winner is
            // left standing for the rest of the action, because it is what stops
            // anything else resolving; ApplyAction takes it away at the end.
            if (state.Winner != winner && !state.Drawn)
            {
                // A clash has an aggressor. Both bodies dying and both bills
                // falling due is a trade the swing forced, so the attacker takes
                // the match rather than levelling it. A leader going down in the
                // same breath is not a trade anybody won, and draws instead.
                var swing = state.Battle?.Attacker;
                var leadersStanding =
                    state.Players[0].Leader is not null && state.Players[1].Leader is not null;
                if (swing is not null && leadersStanding)
                {
                    state.Winner = swing.Value.Player;
                    state.WinReason = $"{state.WinReason} {reason} The attacker takes the trade.".Trim();
                    state.Log.Add(new LogEntry(state.Turn, -1,
                        $"Both players lost at once: {state.Players[state.Winner].Name} attacked and takes it."));
                    return;
                }
                state.Drawn = true;
                state.WinReason = $"{state.WinReason} {reason}".Trim();
                state.Log.Add(new LogEntry(state.Turn, -1, "Both players lost at once: the match is a draw."));
            }
            return;
        }
        state.Winner = winner;
        state.WinReason = reason;
        state.Pending = null;
        state.ReplaceQueue.Clear();
        state.FlipQueue.Clear();
        state.Log.Add(new LogEntry(state.Turn, -1, $"{state.Players[winner].Name} wins: {reason}"));
    }

    static Effects()
    {
        // The generic halves of scrying, shared by every card that reveals cards.
        Choices.Register("scry", (state, choice, pick) =>
        {
            var cards = new List<string>(choice.Cards ?? Array.Empty<string>());
            var p = state.Players[choice.Player];
            if (pick.Index is { } i)
            {
                var id = cards[i];
                cards.RemoveAt(i);
                if (ToHand(state, choice.Player, id))
                {
                    Log(state, choice.Player, $"{Registry.Card(id).Name} goes to hand.");
                }
            }
            p.Deck.AddRange(cards);
        });
        Choices.Register("scry-discard", (state, choice, pick) =>
        {
            var cards = new List<string>(choice.Cards ?? Array.Empty<string>());
            if (pick.Index is { } i)
            {
                var id = cards[i];
                cards.RemoveAt(i);
                if (ToHand(state, choice.Player, id))
                {
                    Log(state, choice.Player, $"{Registry.Card(id).Name} goes to hand.");
                }
            }
            foreach (var rest in cards) ToDiscard(state, choice.Player, rest);
        });
    }

    /// <summary>
    /// Scry: the top cards come off the deck into a face-up row held by a
    /// pending choice, and the player picks a legal one. The unpicked cards go
    /// to the bottom of the deck when the generic "scry" resolver runs.
    /// </summary>
    public static void DigForCard(GameState state, int player, int count,
        Func<CardDef, bool> match, string source, string effect = "scry",
        string prompt = "Take a card", TargetRef? at = null)
    {
        var p = state.Players[player];
        int take = Math.Min(count, p.Deck.Count);
        if (take == 0) return;
        var looked = p.Deck.GetRange(0, take);
        p.Deck.RemoveRange(0, take);
        var legal = new List<int>();
        for (int i = 0; i < looked.Count; i++)
        {
            if (match(Registry.Card(looked[i]))) legal.Add(i);
        }
        var choice = new PendingChoice
        {
            Player = player,
            Source = source,
            Effect = effect,
            Prompt = prompt,
            Cards = looked.ToArray(),
            Legal = legal.ToArray(),
            Optional = true,
            At = at,
        };
        // A scry with nothing legal still shows its owner what was there; they
        // acknowledge it rather than having it resolve out of sight.
        if (legal.Count == 0) Log(state, player, "The scry turns up nothing.");
        state.ChoiceQueue.Add(choice);
    }

    /// <summary>
    /// A scry across the table: the cards come off the victim's deck but the
    /// other player picks. Every resolver for one of these reads the victim back
    /// off the choice as the player who is not choosing, so the leftovers go home.
    /// </summary>
    public static void RaidDeck(GameState state, int victim, int chooser, int count,
        string effect, string source)
    {
        var p = state.Players[victim];
        int take = Math.Min(count, p.Deck.Count);
        if (take == 0)
        {
            Log(state, chooser, "There is nothing left to take.");
            return;
        }
        var looked = p.Deck.GetRange(0, take);
        p.Deck.RemoveRange(0, take);
        var legal = new int[looked.Count];
        for (int i = 0; i < looked.Count; i++) legal[i] = i;
        state.ChoiceQueue.Add(new PendingChoice
        {
            Player = chooser,
            Source = source,
            Effect = effect,
            Prompt = "Take a card",
            Cards = looked.ToArray(),
            Legal = legal,
            Optional = true,
        });
    }

    /// <summary>
    /// A board decision an effect defers to its controller. One legal answer is
    /// picked on the spot; none runs the resolver pickless so it can tidy up.
    /// </summary>
    public static void ChooseBoard(GameState state, int player, string source, string effect,
        TargetRef[] refs, string prompt, bool optional = false, TargetRef? at = null)
    {
        var choice = new PendingChoice
        {
            Player = player,
            Source = source,
            Effect = effect,
            Prompt = prompt,
            Refs = refs,
            Optional = optional,
            At = at,
        };
        if (refs.Length == 0)
        {
            Choices.Run(state, choice, new ChoicePick());
            return;
        }
        if (refs.Length == 1 && !optional)
        {
            Choices.Run(state, choice, new ChoicePick(Ref: refs[0]));
            return;
        }
        state.ChoiceQueue.Add(choice);
    }

    /// <summary>Put a summon into a slot from anywhere, for effects and resolvers alike.</summary>
    public static SummonInstance? PutSummonDirect(GameState state, int player, string cardId,
        int slot, int strength, Color color, int hp, int level = 1, bool asPrinted = false)
    {
        var p = state.Players[player];
        if (slot < 0 || slot >= p.Slots.Length || p.Slots[slot] is not null) return null;
        var s = NewSummon(state, cardId, player,
            over: asPrinted
                ? null
                : new SummonOverride { Strength = strength, Color = color, Level = level });
        p.Slots[slot] = s;
        AssignHp(state, s, hp);
        Log(state, player, $"{Registry.Card(cardId).Name} enters play with {s.Hp.Count} HP.");
        if (s.Hp.Count == 0)
        {
            DestroySummon(state, s);
            return s;
        }
        FireTrigger(state, s, TriggerName.OnEnter);
        return s;
    }

    /// <summary>Refs for every summon sitting in a player's debt zone.</summary>
    public static TargetRef[] DebtSummonRefs(GameState state, int player)
    {
        var outList = new List<TargetRef>();
        var zone = state.Players[player].DebtZone;
        for (int i = 0; i < zone.Count; i++)
        {
            if (Registry.Card(zone[i]).Type == CardType.Summon)
            {
                outList.Add(TargetRef.Debt(player, i));
            }
        }
        return outList.ToArray();
    }

    /// <summary>Refs for every spell sitting in a player's discard pile.</summary>
    public static TargetRef[] DiscardSpellRefs(GameState state, int player)
    {
        var outList = new List<TargetRef>();
        var pile = state.Players[player].Discard;
        for (int i = 0; i < pile.Count; i++)
        {
            if (Registry.Card(pile[i]).Type == CardType.Spell)
            {
                outList.Add(TargetRef.Discard(player, i));
            }
        }
        return outList.ToArray();
    }

    /// <summary>Shuffle the discard pile, then reveal its top cards as a scry.</summary>
    public static void ScryDiscardPile(GameState state, int player, int count,
        Func<CardDef, bool> match, string source)
    {
        var p = state.Players[player];
        if (p.Discard.Count == 0)
        {
            Log(state, player, "The discard pile is empty.");
            return;
        }
        var rng = new Rng(state.RngState);
        rng.Shuffle(p.Discard);
        state.RngState = rng.State;
        int take = Math.Min(count, p.Discard.Count);
        var looked = p.Discard.GetRange(0, take);
        p.Discard.RemoveRange(0, take);
        var legal = new List<int>();
        for (int i = 0; i < looked.Count; i++)
        {
            if (match(Registry.Card(looked[i]))) legal.Add(i);
        }
        var choice = new PendingChoice
        {
            Player = player,
            Source = source,
            Effect = "scry-discard",
            Prompt = "Take a card from the discard pile",
            Cards = looked.ToArray(),
            Legal = legal.ToArray(),
            Optional = true,
        };
        if (legal.Count == 0) Log(state, player, "The scry turns up nothing.");
        state.ChoiceQueue.Add(choice);
    }

    /// <summary>Shuffle `count` random discard cards back into the deck at random spots.</summary>
    /// <summary>The most recent card in a discard pile goes back into its owner's deck.</summary>
    public static bool RecycleTopDiscard(GameState state, int player)
    {
        var p = state.Players[player];
        if (p.Discard.Count == 0) return false;
        var id = p.Discard[^1];
        p.Discard.RemoveAt(p.Discard.Count - 1);
        var rng = new Rng(state.RngState);
        int into = p.Deck.Count == 0 ? 0 : rng.NextInt(p.Deck.Count + 1);
        state.RngState = rng.State;
        p.Deck.Insert(into, id);
        Log(state, player, $"{Registry.Card(id).Name} shuffles back into {p.Name}'s deck.");
        return true;
    }

    public static void RecycleDiscard(GameState state, int player, int count)
    {
        var p = state.Players[player];
        var rng = new Rng(state.RngState);
        int moved = 0;
        for (int i = 0; i < count && p.Discard.Count > 0; i++)
        {
            int at = rng.NextInt(p.Discard.Count);
            var id = p.Discard[at];
            p.Discard.RemoveAt(at);
            int into = p.Deck.Count == 0 ? 0 : rng.NextInt(p.Deck.Count + 1);
            p.Deck.Insert(into, id);
            moved++;
        }
        state.RngState = rng.State;
        Log(state, player, $"{moved} card(s) shuffled back into {p.Name}'s deck.");
    }

    /// <summary>
    /// Removes the card at `index` from a player's debt pile. The pile only ever
    /// holds summons, and a summon leaving it is no longer owed for, so its
    /// level is healed off the debt counter.
    /// </summary>
    public static string? RemoveFromDebt(GameState state, int player, int index)
    {
        var p = state.Players[player];
        if (index < 0 || index >= p.DebtZone.Count) return null;
        var cardId = p.DebtZone[index];
        p.DebtZone.RemoveAt(index);
        ClearDebt(state, player, Registry.Card(cardId).Level);
        return cardId;
    }

    public static CardDef? ReviveFromDebt(GameState state, int player, Func<CardDef, bool> match)
    {
        var p = state.Players[player];
        int idx = p.DebtZone.FindIndex(id => match(Registry.Card(id)));
        if (idx < 0) return null;
        var cardId = RemoveFromDebt(state, player, idx)!;
        ToHand(state, player, cardId);
        return Registry.Card(cardId);
    }

    /// <summary>
    /// Effect Damage a player has in play: the sum over their summons and stage.
    /// It lifts damage dealt by cards, never damage dealt by a clash.
    /// </summary>
    public static int EffectDamageOf(GameState state, int player)
    {
        int total = 0;
        var p = state.Players[player];
        var args = new EffectDamageArgs { State = state, Controller = player };
        int From(CardDef def) =>
            def.EffectDamage + (def.Triggers?.EffectDamageBonus?.Invoke(args) ?? 0);
        foreach (var s in p.Slots)
        {
            if (s is not null) total += From(Registry.Card(s.CardId)) + s.EffectDamageMod;
        }
        if (p.Leader is not null)
            total += From(Registry.Card(p.Leader.CardId)) + p.Leader.EffectDamageMod;
        if (p.Stage is not null) total += Registry.TryCard(p.Stage)?.EffectDamage ?? 0;
        return total + _spellBonus;
    }

    /// <summary>
    /// Silences a body and removes it from play for good. Its own Deathrattle
    /// never fires, it reaches no zone, and nothing can raise it, recycle it or
    /// charge debt for it. Other cards still see that a summon died.
    /// </summary>
    public static void Annihilate(GameState state, SummonInstance summon)
    {
        bool outer = _annihilate;
        _annihilate = true;
        try { DestroySummon(state, summon); }
        finally { _annihilate = outer; }
    }

    /// <summary>
    /// Strips cards off the top of a discard pile for good, most recently
    /// discarded first. Deterministic so both engines annihilate the same cards.
    /// </summary>
    public static int AnnihilateDiscard(GameState state, int player, int count)
    {
        var pile = state.Players[player].Discard;
        int took = Math.Min(count, pile.Count);
        if (took <= 0) return 0;
        pile.RemoveRange(pile.Count - took, took);
        Log(state, player, $"{took} card(s) are annihilated from {state.Players[player].Name}'s discard pile.");
        return took;
    }

    /// <summary>Lends Effect Damage to a spell for the length of its resolution.</summary>
    public static int TakeSpellBonus(GameState state, int caster)
    {
        var p = state.Players[caster];
        int had = p.SpellBonus;
        p.SpellBonus = 0;
        _spellBonus = had;
        return had;
    }

    public static void ClearSpellBonus() => _spellBonus = 0;

    /// <summary>
    /// Fish catches flipped HP cards: they leave the board and go back to their
    /// owner's hand. The summon gets smaller, which is the price, and a card
    /// that was spent comes back, which is the point.
    /// </summary>
    /// <summary>Raised by a Deathrattle so the destroy sends the body to hand.</summary>
    public static void MarkReturnToHand() => _returnToHand = true;

    public static int CatchHp(GameState state, TargetRef r, int count)
    {
        var summon = state.Find(r);
        if (summon is null || count <= 0) return 0;
        int taken = 0;
        // The oldest spent card comes back first. Damage turns cards over from
        // the front, so that is the one that has been face up longest. Healing
        // goes the other way and undoes the newest damage first, which is
        // deliberate: healing reverses the blow that just landed, and catching
        // reaches past it for what was spent earliest.
        //
        // No increment after a removal: the next card shifts down into this index.
        for (int i = 0; i < summon.Hp.Count && taken < count;)
        {
            if (!summon.Hp[i].Flipped)
            {
                i++;
                continue;
            }
            ToHand(state, summon.Owner, summon.Hp[i].CardId);
            summon.Hp.RemoveAt(i);
            taken++;
        }
        if (taken > 0)
        {
            Log(state, summon.Owner,
                $"{taken} spent HP card(s) are caught back off {Registry.Card(summon.CardId).Name}.");
        }
        if (summon.Hp.Count == 0) DestroySummon(state, summon);
        return taken;
    }

    /// <summary>
    /// Oil curses a deck: copies of a junk card go in at spread-out depths, so
    /// they turn up as draws and as face-down HP for the rest of the game.
    /// </summary>
    public static int CurseDeck(GameState state, int player, string cardId, int count)
    {
        if (Registry.TryCard(cardId) is null || count <= 0) return 0;
        var deck = state.Players[player].Deck;
        var rng = new Rng(state.RngState);
        int placed = 0;
        for (int i = 0; i < count; i++)
        {
            int at = deck.Count == 0 ? 0 : rng.NextInt(deck.Count + 1);
            deck.Insert(at, cardId);
            placed++;
        }
        state.RngState = rng.State;
        Log(state, player,
            $"{placed} {Registry.Card(cardId).Name} are worked into {state.Players[player].Name}'s deck.");
        return placed;
    }

    public static int UnflipHp(GameState state, TargetRef r, int count)
    {
        var s = state.Find(r);
        if (s is null || count <= 0) return 0;
        int healed = 0;
        // Newest damage heals first, so a card just flipped can be undone.
        for (int i = s.Hp.Count - 1; i >= 0 && healed < count; i--)
        {
            if (s.Hp[i].Flipped)
            {
                s.Hp[i].Flipped = false;
                healed++;
            }
        }
        if (healed > 0)
        {
            Log(state, s.Owner, $"{Registry.Card(s.CardId).Name} turns {healed} HP card(s) back down.");
        }
        return healed;
    }

    public static int MoveHpCards(GameState state, TargetRef from, TargetRef to, int count)
    {
        var a = state.Find(from);
        var b = state.Find(to);
        if (a is null || b is null || ReferenceEquals(a, b) || count <= 0) return 0;
        int moved = 0;
        while (moved < count)
        {
            int idx = a.Hp.FindIndex(h => !h.Flipped);
            if (idx < 0) break;
            var hp = a.Hp[idx];
            a.Hp.RemoveAt(idx);
            b.Hp.Add(hp);
            moved++;
        }
        if (moved > 0)
        {
            Log(state, b.Owner,
                $"{moved} HP card(s) move from {Registry.Card(a.CardId).Name} to {Registry.Card(b.CardId).Name}.");
        }
        // Stripped to nothing, the donor falls.
        if (a.RemainingHp == 0) DestroySummon(state, a);
        return moved;
    }

    public static bool BounceSummon(GameState state, TargetRef r)
    {
        var s = state.Find(r);
        if (s is null || s.IsLeader) return false;
        var p = state.Players[s.Owner];
        int slot = Array.IndexOf(p.Slots, s);
        if (slot < 0) return false;
        p.Slots[slot] = null;
        bool kept = ToHand(state, s.Owner, s.CardId);
        foreach (var h in s.Hp) ToDiscard(state, s.Owner, h.CardId);
        if (kept) Log(state, s.Owner, $"{Registry.Card(s.CardId).Name} returns to hand.");
        return true;
    }

    /// <summary>
    /// A body leaves play and goes back into its owner's deck at a random spot.
    /// Unlike a bounce it is not replayable this turn, and unlike a destroy it
    /// charges no debt: the card is neither in play nor in the debt zone. What
    /// was spent protecting it is discarded, the same as a bounce.
    /// </summary>
    public static bool ShuffleSummonIntoDeck(GameState state, TargetRef r)
    {
        var summon = state.Find(r);
        if (summon is null || summon.IsLeader) return false;
        var p = state.Players[summon.Owner];
        int slot = Array.IndexOf(p.Slots, summon);
        if (slot < 0) return false;
        p.Slots[slot] = null;
        var rng = new Rng(state.RngState);
        int into = p.Deck.Count == 0 ? 0 : rng.NextInt(p.Deck.Count + 1);
        state.RngState = rng.State;
        p.Deck.Insert(into, summon.CardId);
        foreach (var h in summon.Hp) ToDiscard(state, summon.Owner, h.CardId);
        Log(state, summon.Owner,
            $"{Registry.Card(summon.CardId).Name} shuffles into {p.Name}'s deck.");
        return true;
    }

    /// <summary>Every card in hand goes back into the deck. Returns how many moved.</summary>
    public static int ShuffleHandIntoDeck(GameState state, int player)
    {
        var p = state.Players[player];
        int moved = p.Hand.Count;
        if (moved == 0) return 0;
        var rng = new Rng(state.RngState);
        foreach (var id in p.Hand)
        {
            int into = p.Deck.Count == 0 ? 0 : rng.NextInt(p.Deck.Count + 1);
            p.Deck.Insert(into, id);
        }
        state.RngState = rng.State;
        p.Hand.Clear();
        Log(state, player, $"{p.Name} shuffles {moved} card(s) back into their deck.");
        return moved;
    }

    public static bool TransformSummon(GameState state, TargetRef r, string cardId)
    {
        var s = state.Find(r);
        var def = Registry.TryCard(cardId);
        if (s is null || def is null) return false;
        var was = Registry.Card(s.CardId).Name;
        s.CardId = cardId;
        s.Override = null;
        s.PowerUses.Clear();
        Log(state, s.Owner, $"{was} becomes {def.Name}.");
        return true;
    }

    public static bool TakeControlOf(GameState state, TargetRef r, int to)
    {
        var s = state.Find(r);
        if (s is null || s.IsLeader) return false;
        var from = state.Players[s.Owner];
        var dest = state.Players[to];
        int open = Array.IndexOf(dest.Slots, null);
        if (open < 0) return false;
        int slot = Array.IndexOf(from.Slots, s);
        if (slot < 0) return false;
        from.Slots[slot] = null;
        dest.Slots[open] = s;
        s.Owner = to;
        s.Sapped = true;
        Log(state, to, $"{dest.Name} seizes {Registry.Card(s.CardId).Name}.");
        return true;
    }

    /// <summary>Printed strength plus modifiers plus every aura currently in play.</summary>
    public static int EffectiveStrength(GameState state, SummonInstance summon)
    {
        var def = Registry.Card(summon.CardId);
        int total = GameState.StrengthOf(summon, def);
        for (int controller = 0; controller < 2; controller++)
        {
            var stageId = state.Players[controller].Stage;
            if (stageId is not null)
            {
                var bonus = Registry.TryCard(stageId)?.StageHooks?.StrengthBonus;
                if (bonus is not null)
                {
                    total += bonus(new StrengthBonusArgs
                    { State = state, Controller = controller, Summon = summon, Def = def });
                }
            }
            foreach (var r in SummonRefsOf(state, controller, true))
            {
                var other = state.Find(r);
                if (other is null) continue;
                var bonus2 = Registry.TryCard(other.CardId)?.Triggers?.StrengthBonus;
                if (bonus2 is not null)
                {
                    total += bonus2(new StrengthBonusArgs
                    { State = state, Controller = controller, Summon = summon, Def = def, Source = other });
                }
            }
        }
        return Math.Max(0, total);
    }

    /// <summary>
    /// Both sides of a clash hit each other, attacker's HP flipped first. A leader
    /// that is attacked deals nothing back, which is what makes attacking with
    /// your own leader a gamble: it takes the counter-hit and never gives one.
    /// </summary>
    public static void ResolveClash(GameState state, TargetRef attackerRef, TargetRef defenderRef)
    {
        var attacker = state.Find(attackerRef);
        var defender = state.Find(defenderRef);
        if (attacker is null || defender is null)
        {
            state.Battle = null;
            return;
        }

        FireTrigger(state, defender, TriggerName.OnDefend);
        if (state.Winner >= 0 || state.Find(attackerRef) is null || state.Find(defenderRef) is null)
        {
            state.Battle = null;
            return;
        }

        int atk = EffectiveStrength(state, attacker);
        int def2 = defender.IsLeader ? 0 : EffectiveStrength(state, defender);

        Log(state, attacker.Owner,
            $"{Registry.Card(attacker.CardId).Name} ({atk}) clashes with {Registry.Card(defender.CardId).Name} ({def2}).");

        DealDamage(state, attackerRef, def2);
        bool muffle = Registry.Card(attacker.CardId).MuffleFlips;
        int muted = DealDamage(state, defenderRef, atk, 0, muffle);
        if (muted > 0 && state.Find(attackerRef) is not null)
        {
            UnflipHp(state, attackerRef, muted);
        }
        state.Battle = null;
    }
}
