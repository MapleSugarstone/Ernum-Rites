namespace Selatza.Learn;

/// <summary>
/// The dials on the read a bot gets that a person at the table would not.
/// Everything here is meant to be turned down if it proves too strong.
/// </summary>
public sealed class IntelConfig
{
    /// <summary>Chance per roll to name a card sitting in the enemy deck.</summary>
    public double DeckScoutChance { get; set; } = 0.15;

    /// <summary>Rolls taken each time the enemy plays a card.</summary>
    public int DeckScoutRolls { get; set; } = 3;

    /// <summary>Chance per roll to name a card sitting in the enemy hand.</summary>
    public double HandScoutChance { get; set; } = 0.05;

    public int HandScoutRolls { get; set; } = 1;

    /// <summary>
    /// Chance per enemy turn that a card the bot named in hand slips its mind.
    /// Zero is perfect recall; raise it to blunt the hand read without touching
    /// the roll itself.
    /// </summary>
    public double HandForgetPerTurn { get; set; } = 0.0;

    /// <summary>Counting copies is the one part a person really can do, so it defaults on.</summary>
    public bool CountPlayedCopies { get; set; } = true;

    public IntelConfig Clone() => (IntelConfig)MemberwiseClone();

    public static IntelConfig Default => new();

    /// <summary>No read at all: public zones and card counting only.</summary>
    public static IntelConfig Blind => new()
    {
        DeckScoutChance = 0,
        DeckScoutRolls = 0,
        HandScoutChance = 0,
        HandScoutRolls = 0,
    };

    public override string ToString() =>
        $"deck {DeckScoutChance:0.###}x{DeckScoutRolls} hand {HandScoutChance:0.###}x{HandScoutRolls}"
        + (CountPlayedCopies ? "" : " (no counting)")
        + (HandForgetPerTurn > 0 ? $" forget {HandForgetPerTurn:0.##}" : "");
}

/// <summary>
/// One player's memory of the other side of the table, kept honest by
/// construction: every count here is clamped against the real zone after each
/// action, so the tracker can be short of the truth but never invents a card
/// that is not there.
///
/// Three things live in here, in rising order of how unfair they are:
/// public zones (anyone can see them), copies played (a person can count, and
/// good ones do), and the scouted reads the config above pays for.
/// </summary>
public sealed class Intel
{
    private readonly int _me;
    private readonly int _enemy;
    private readonly IntelConfig _cfg;
    private readonly Rng _rng;
    private readonly int _n;

    private readonly int[] _knownHand;
    private readonly int[] _knownDeck;
    private readonly int[] _accounted;
    private readonly int[] _playedTotal;
    private readonly int[] _playedThisTurn;
    private readonly int[] _visible;

    private int _enemyTurnsSeen;

    public Intel(int me, IntelConfig cfg, int seed)
    {
        CardIndex.EnsureBuilt();
        _me = me;
        _enemy = GameState.Other(me);
        _cfg = cfg;
        _rng = new Rng(seed);
        _n = CardIndex.Count;
        _knownHand = new int[_n];
        _knownDeck = new int[_n];
        _accounted = new int[_n];
        _playedTotal = new int[_n];
        _playedThisTurn = new int[_n];
        _visible = new int[_n];
    }

    public int Me => _me;
    public int Enemy => _enemy;
    public IntelConfig Config => _cfg;

    /// <summary>Copies of each card the bot can name in the enemy hand right now.</summary>
    public ReadOnlySpan<int> KnownHand => _knownHand;

    /// <summary>Copies of each card the bot can name still in the enemy deck.</summary>
    public ReadOnlySpan<int> KnownDeck => _knownDeck;

    /// <summary>Copies known to have left the enemy deck and hand, by any route.</summary>
    public ReadOnlySpan<int> Accounted => _accounted;

    /// <summary>Copies the enemy has actually played, counted as they were played.</summary>
    public ReadOnlySpan<int> PlayedTotal => _playedTotal;

    public ReadOnlySpan<int> PlayedThisTurn => _playedThisTurn;

    /// <summary>Colour identity the enemy leader brings, and so the pool they may run.</summary>
    public byte EnemyIdentity { get; private set; }

    public int ScoutRollsTaken { get; private set; }
    public int DeckCardsNamed { get; private set; }
    public int HandCardsNamed { get; private set; }

    /// <summary>Upper bound on copies of a card that could still be in the enemy deck or hand.</summary>
    public int PlausibleRemaining(int card)
    {
        if (!_cfg.CountPlayedCopies) return CardIndex.LegalUnder(card, EnemyIdentity) ? CardIndex.CopyLimit(card) : 0;
        if (!CardIndex.LegalUnder(card, EnemyIdentity)) return 0;
        return Math.Max(0, CardIndex.CopyLimit(card) - _accounted[card]);
    }

    /// <summary>Reads the leader off the board, which both players can do from turn one.</summary>
    public void Begin(GameState state)
    {
        EnemyIdentity = CardIndex.IdentityOf(state.Players[_enemy].LeaderCardId);
        Sync(state);
    }

    private static bool IsPlay(ActionType t) => t switch
    {
        ActionType.PlaySupporter => true,
        ActionType.PlaySummon => true,
        ActionType.ReplaceSummon => true,
        ActionType.CastSpell => true,
        ActionType.PlayStage => true,
        ActionType.CastTrap => true,
        _ => false,
    };

    /// <summary>
    /// Feeds one applied action to the tracker. <paramref name="before"/> is the
    /// state the action was chosen against, which is where the card that was
    /// played is still readable in the actor's hand.
    /// </summary>
    public void Observe(GameState before, int actor, GameAction action, GameState after)
    {
        if (EnemyIdentity == 0) EnemyIdentity = CardIndex.IdentityOf(after.Players[_enemy].LeaderCardId);

        if (actor == _enemy && IsPlay(action.Type))
        {
            int played = PlayedCardOf(before, action);
            if (played >= 0)
            {
                _playedTotal[played]++;
                _playedThisTurn[played]++;
                // A card you watched them play is a card you no longer have to guess at.
                if (_knownHand[played] > 0) _knownHand[played]--;
            }
            Scout(after);
        }

        if (actor == _enemy && action.Type == ActionType.EndTurn)
        {
            Array.Clear(_playedThisTurn);
            _enemyTurnsSeen++;
            Forget();
        }

        Sync(after);
    }

    private int PlayedCardOf(GameState before, GameAction action)
    {
        var hand = before.Players[_enemy].Hand;
        int i = action.HandIndex;
        if (i < 0 || i >= hand.Count) return -1;
        return CardIndex.Of(hand[i]);
    }

    private void Scout(GameState state)
    {
        var enemy = state.Players[_enemy];

        for (int r = 0; r < _cfg.DeckScoutRolls; r++)
        {
            ScoutRollsTaken++;
            if (_rng.Next() >= _cfg.DeckScoutChance) continue;
            if (enemy.Deck.Count == 0) continue;
            int card = CardIndex.Of(enemy.Deck[_rng.NextInt(enemy.Deck.Count)]);
            if (card < 0) continue;
            if (_knownDeck[card] >= CountIn(enemy.Deck, card)) continue;
            _knownDeck[card]++;
            DeckCardsNamed++;
        }

        for (int r = 0; r < _cfg.HandScoutRolls; r++)
        {
            ScoutRollsTaken++;
            if (_rng.Next() >= _cfg.HandScoutChance) continue;
            if (enemy.Hand.Count == 0) continue;
            int card = CardIndex.Of(enemy.Hand[_rng.NextInt(enemy.Hand.Count)]);
            if (card < 0) continue;
            if (_knownHand[card] >= CountIn(enemy.Hand, card)) continue;
            _knownHand[card]++;
            HandCardsNamed++;
        }
    }

    private void Forget()
    {
        if (_cfg.HandForgetPerTurn <= 0) return;
        for (int c = 0; c < _n; c++)
        {
            while (_knownHand[c] > 0 && _rng.Next() < _cfg.HandForgetPerTurn) _knownHand[c]--;
        }
    }

    private int CountIn(List<string> zone, int card)
    {
        int n = 0;
        foreach (var id in zone)
        {
            if (CardIndex.Of(id) == card) n++;
        }
        return n;
    }

    /// <summary>
    /// Re-reads the public zones and clamps every remembered count against what
    /// is really there. This is the invariant the whole tracker rests on: it may
    /// know less than the truth, never more.
    /// </summary>
    private void Sync(GameState state)
    {
        var enemy = state.Players[_enemy];
        Array.Clear(_visible);

        foreach (var s in enemy.Supporters) Bump(_visible, s.CardId);
        foreach (var s in enemy.Slots)
        {
            if (s is null) continue;
            Bump(_visible, s.CardId);
            foreach (var h in s.Hp)
            {
                if (h.Flipped) Bump(_visible, h.CardId);
            }
        }
        if (enemy.Leader is not null)
        {
            foreach (var h in enemy.Leader.Hp)
            {
                if (h.Flipped) Bump(_visible, h.CardId);
            }
        }
        foreach (var id in enemy.DebtZone) Bump(_visible, id);
        foreach (var id in enemy.Discard) Bump(_visible, id);
        if (enemy.Stage is not null) Bump(_visible, enemy.Stage);

        for (int c = 0; c < _n; c++)
        {
            int seen = Math.Max(_visible[c], _playedTotal[c]);
            if (seen > _accounted[c]) _accounted[c] = seen;
        }

        Clamp(_knownHand, enemy.Hand);
        Clamp(_knownDeck, enemy.Deck);
    }

    private static void Bump(int[] counts, string cardId)
    {
        int c = CardIndex.Of(cardId);
        if (c >= 0) counts[c]++;
    }

    private void Clamp(int[] known, List<string> zone)
    {
        bool any = false;
        for (int c = 0; c < _n; c++)
        {
            if (known[c] > 0)
            {
                any = true;
                break;
            }
        }
        if (!any) return;

        Span<int> actual = new int[_n];
        foreach (var id in zone)
        {
            int c = CardIndex.Of(id);
            if (c >= 0) actual[c]++;
        }
        for (int c = 0; c < _n; c++)
        {
            if (known[c] > actual[c]) known[c] = actual[c];
        }
    }

    /// <summary>
    /// How likely the enemy is holding a trap, which is the one read that
    /// changes whether an attack is worth declaring. Certainty when a trap has
    /// been named in hand, otherwise the chance that at least one of the cards
    /// they hold is drawn from the traps their colours still allow.
    /// </summary>
    public double TrapRisk(GameState state)
    {
        var enemy = state.Players[_enemy];
        int handSize = enemy.Hand.Count;
        if (handSize == 0) return 0;

        int known = 0, namedTotal = 0;
        for (int c = 0; c < _n; c++)
        {
            if (_knownHand[c] == 0) continue;
            namedTotal += _knownHand[c];
            if (CardIndex.Def(c).Type == CardType.Trap) known += _knownHand[c];
        }
        if (known > 0) return 1.0;

        int unknown = Math.Max(0, handSize - namedTotal);
        if (unknown == 0) return 0;

        int trapsLeft = 0, poolLeft = 0;
        for (int c = 0; c < _n; c++)
        {
            int left = PlausibleRemaining(c);
            if (left == 0) continue;
            poolLeft += left;
            if (CardIndex.Def(c).Type == CardType.Trap) trapsLeft += left;
        }
        if (poolLeft == 0) return 0;

        double density = trapsLeft / (double)poolLeft;
        return 1.0 - Math.Pow(1.0 - density, unknown);
    }

    /// <summary>Copies carrying a tag that the enemy could still draw into.</summary>
    public int PlausibleTagged(CardTag tag)
    {
        int total = 0;
        for (int c = 0; c < _n; c++)
        {
            if ((CardIndex.Tags(c) & tag) == 0) continue;
            total += PlausibleRemaining(c);
        }
        return total;
    }
}
