namespace Selatza.Learn;

/// <summary>
/// Turns a position into the three planes the network reads, from one player's
/// side of the table and no further. Anything the viewer is not entitled to,
/// their opponent's hand and both decks and every face-down HP card, is absent
/// unless <see cref="Intel"/> paid for it.
///
/// Card plane: one column per registered card, ordered so neighbours are cards
/// that compete for the same deck slot, which is what a kernel of three reads.
/// Entity plane: one body per leader and summon slot on each side.
/// Scalars: the clocks, the pools, and the handful of reads that are easier to
/// state outright than to make a convolution rediscover.
///
/// One encoder belongs to one player for one game and is not thread safe: it
/// keeps scratch buffers so a search can encode a dozen candidate positions
/// without allocating.
/// </summary>
public sealed class Encoder
{
    public const int CardChannels = 23;
    /// <summary>Leader plus the summon slots, one side of the table.</summary>
    public const int PerSide = 1 + Rules.SummonSlots;
    public const int Entities = 2 * PerSide;
    // The per-colour one-hot writes one channel per entry of Colors.All, so
    // this grew with the sixth colour.
    public const int EntityChannels = 27 + 2 * Rules.SummonSlots;
    // Four scalar rows write one value per entry of Colors.All (both mana
    // pools and both identities), so this grew by four with the sixth colour.
    public const int ScalarCount = 88;

    private readonly int _me;
    private readonly int _enemy;
    private readonly Intel _intel;
    private readonly int _cards;

    private readonly float[] _template;
    private readonly int[] _enemyPool;
    private readonly byte _myIdentity;
    private readonly byte _enemyIdentity;

    private readonly int[] _myMana = new int[Rules.ManaKinds];
    private readonly int[] _enemyMana = new int[Rules.ManaKinds];
    private readonly SummonInstance?[] _ent = new SummonInstance?[Entities];
    private readonly int[] _entStrength = new int[Entities];
    private readonly int[] _entHp = new int[Entities];

    public Encoder(int me, Intel intel, GameState state)
    {
        CardIndex.EnsureBuilt();
        _me = me;
        _enemy = GameState.Other(me);
        _intel = intel;
        _cards = CardIndex.Count;
        _template = new float[CardChannels * _cards];

        _myIdentity = CardIndex.IdentityOf(state.Players[_me].LeaderCardId);
        _enemyIdentity = CardIndex.IdentityOf(state.Players[_enemy].LeaderCardId);

        var pool = new List<int>();
        for (int c = 0; c < _cards; c++)
        {
            if (CardIndex.LegalUnder(c, _myIdentity)) _template[7 * _cards + c] = 1;
            if (CardIndex.LegalUnder(c, _enemyIdentity))
            {
                _template[16 * _cards + c] = 1;
                pool.Add(c);
            }
        }
        _enemyPool = pool.ToArray();
    }

    public int CardPlaneSize => CardChannels * _cards;
    public int EntityPlaneSize => EntityChannels * Entities;
    public int Size => CardPlaneSize + EntityPlaneSize + ScalarCount;
    public int Cards => _cards;

    /// <summary>Cards the enemy leader's colours allow, which is the pool they built from.</summary>
    public ReadOnlySpan<int> EnemyPool => _enemyPool;

    public float[] EncodeNew(GameState state)
    {
        var buf = new float[Size];
        Encode(state, buf, 0);
        return buf;
    }

    public void Encode(GameState state, float[] dest, int offset)
    {
        FillMana(state.Players[_me], _myMana);
        FillMana(state.Players[_enemy], _enemyMana);
        FillEntities(state);
        EncodeCards(state, dest, offset);
        EncodeEntities(state, dest, offset + CardPlaneSize);
        EncodeScalars(state, dest, offset + CardPlaneSize + EntityPlaneSize);
    }

    /// <summary>Pool plus unsapped supporters, which is what either side can pay with.</summary>
    private static void FillMana(PlayerState p, int[] dest)
    {
        for (int i = 0; i < Rules.ManaKinds; i++) dest[i] = p.Mana[i];
        foreach (var s in p.Supporters)
        {
            if (!s.Sapped) dest[Engine.ManaIndexFor(p, Registry.Card(s.CardId))]++;
        }
    }

    private void FillEntities(GameState state)
    {
        _ent[0] = state.Players[_me].Leader;
        _ent[PerSide] = state.Players[_enemy].Leader;
        for (int i = 0; i < Rules.SummonSlots; i++)
        {
            _ent[1 + i] = state.Players[_me].Slots[i];
            _ent[PerSide + 1 + i] = state.Players[_enemy].Slots[i];
        }
        for (int e = 0; e < Entities; e++)
        {
            var s = _ent[e];
            _entStrength[e] = s is null ? 0 : Effects.EffectiveStrength(state, s);
            _entHp[e] = s?.RemainingHp ?? 0;
        }
    }

    private static bool Affordable(Cost cost, int[] mana)
    {
        int spare = mana[Rules.Colorless];
        foreach (var c in Colors.All)
        {
            if (cost[c] > mana[(int)c]) return false;
            spare += mana[(int)c] - cost[c];
        }
        return cost.C <= spare;
    }

    // --- card plane ----------------------------------------------------------

    private void EncodeCards(GameState state, float[] dest, int off)
    {
        Array.Copy(_template, 0, dest, off, _template.Length);
        var me = state.Players[_me];
        var enemy = state.Players[_enemy];

        void Add(int channel, string cardId, float amount)
        {
            int c = CardIndex.Of(cardId);
            if (c >= 0) dest[off + channel * _cards + c] += amount;
        }

        foreach (var id in me.Hand) Add(0, id, 0.25f);
        foreach (var id in me.Deck) Add(1, id, 0.25f);
        foreach (var s in me.Slots)
        {
            if (s is not null) Add(2, s.CardId, 0.5f);
        }
        foreach (var s in me.Supporters) Add(3, s.CardId, 0.25f);
        foreach (var id in me.DebtZone) Add(4, id, 0.25f);
        foreach (var id in me.Discard) Add(21, id, 0.25f);
        if (me.Stage is not null) Add(5, me.Stage, 1f);
        Add(6, me.LeaderCardId, 1f);

        foreach (var s in enemy.Slots)
        {
            if (s is not null) Add(8, s.CardId, 0.5f);
        }
        foreach (var s in enemy.Supporters) Add(9, s.CardId, 0.25f);
        foreach (var id in enemy.DebtZone) Add(10, id, 0.25f);
        foreach (var id in enemy.Discard) Add(22, id, 0.25f);
        if (enemy.Stage is not null) Add(11, enemy.Stage, 1f);
        Add(12, enemy.LeaderCardId, 1f);

        var accounted = _intel.Accounted;
        var knownHand = _intel.KnownHand;
        var knownDeck = _intel.KnownDeck;
        var playedNow = _intel.PlayedThisTurn;

        foreach (int c in _enemyPool)
        {
            if (accounted[c] > 0) dest[off + 13 * _cards + c] = accounted[c] * 0.25f;
            if (knownHand[c] > 0) dest[off + 14 * _cards + c] = knownHand[c] * 0.25f;
            if (knownDeck[c] > 0) dest[off + 15 * _cards + c] = knownDeck[c] * 0.25f;
            if (playedNow[c] > 0) dest[off + 18 * _cards + c] = playedNow[c] * 0.5f;

            int left = _intel.PlausibleRemaining(c);
            if (left == 0) continue;
            dest[off + 17 * _cards + c] = left * 0.25f;
            // What they could pay for right now, which is the part that decides
            // whether an attack is worth declaring.
            if (Affordable(CardIndex.Def(c).Cost, _enemyMana)) dest[off + 20 * _cards + c] = 1f;
        }

        foreach (var id in me.Hand)
        {
            int c = CardIndex.Of(id);
            if (c >= 0 && Affordable(CardIndex.Def(c).Cost, _myMana)) dest[off + 19 * _cards + c] = 1f;
        }
    }

    // --- entity plane --------------------------------------------------------

    /// <summary>
    /// The same test <see cref="Engine.LegalAttackTargets"/> makes, without
    /// building the list of targets, because this runs once per entity per position.
    /// </summary>
    private static bool CanAttackNow(GameState state, SummonInstance s, int owner)
    {
        if (state.Winner >= 0 || state.Pending is not null || state.ReplaceQueue.Count > 0) return false;
        if (state.Active != owner || state.Phase != Phase.Main) return false;
        if (state.Players[owner].TurnsTaken <= 1 || s.Sapped) return false;
        if (Registry.Card(s.CardId).Stationary) return false;
        var foe = state.Players[GameState.Other(owner)];
        return foe.HasFieldSummon || foe.Leader is not null;
    }

    private void EncodeEntities(GameState state, float[] dest, int off)
    {
        for (int e = 0; e < Entities; e++)
        {
            var s = _ent[e];
            int c = 0;
            void Put(float v) => dest[off + c++ * Entities + e] = v;

            if (s is null)
            {
                for (int i = 0; i < EntityChannels; i++) dest[off + i * Entities + e] = 0;
                continue;
            }

            var def = Registry.Card(s.CardId);
            bool mine = e < PerSide;
            int owner = mine ? _me : _enemy;
            int strength = _entStrength[e];
            int remaining = _entHp[e];
            int total = s.Hp.Count;
            // My slots face the enemy slots, and the leader behind them.
            int foeBase = mine ? PerSide : 0;

            Put(1);
            Put(s.IsLeader ? 1 : 0);
            Put(mine ? 1 : 0);
            Put(strength / 6f);
            Put(remaining / 8f);
            Put((total - remaining) / 8f);
            Put(total / 10f);
            Put(total > 0 ? remaining / (float)total : 0);
            Put(s.Wounds / 2f);
            Put(s.Sapped ? 1 : 0);
            Put(s.EnteredTurn == state.Turn ? 1 : 0);
            Put(GameState.LevelOf(s, def) / 3f);

            var col = GameState.ColorOf(s, def);
            foreach (var cc in Colors.All) Put(col == cc ? 1 : 0);

            var powers = GameState.PowersOf(s, def);
            Put(powers.Length / 3f);
            bool affordable = false;
            var mana = mine ? _myMana : _enemyMana;
            foreach (var p in powers)
            {
                if (Affordable(p.Cost, mana)) affordable = true;
            }
            Put(affordable ? 1 : 0);
            Put(def.Triggers?.OnAttack is not null ? 1 : 0);
            Put(def.Triggers?.OnDeath is not null ? 1 : 0);
            Put(def.Triggers?.StrengthBonus is not null ? 1 : 0);
            Put(CanAttackNow(state, s, owner) ? 1 : 0);

            bool foeHasBoard = false;
            for (int i = 1; i <= Rules.SummonSlots; i++)
            {
                if (_ent[foeBase + i] is not null) foeHasBoard = true;
            }
            for (int i = 1; i <= Rules.SummonSlots; i++) Put(Kills(strength, foeBase + i));
            Put(foeHasBoard ? 0 : Kills(strength, foeBase));
            for (int i = 1; i <= Rules.SummonSlots; i++) Put(DiesTo(remaining, foeBase + i));
            Put(s.Override is not null ? 1 : 0);
            Put(Math.Min(3, s.StrengthMods.Count) / 3f);

            if (c != EntityChannels)
            {
                throw new InvalidOperationException($"entity channel count is {c}, declared {EntityChannels}");
            }
        }
    }

    private float Kills(int strength, int entity) =>
        _ent[entity] is not null && strength >= _entHp[entity] ? 1 : 0;

    private float DiesTo(int remaining, int entity) =>
        _ent[entity] is not null && _entStrength[entity] >= remaining ? 1 : 0;

    // --- scalars -------------------------------------------------------------

    private void EncodeScalars(GameState state, float[] dest, int off)
    {
        var me = state.Players[_me];
        var enemy = state.Players[_enemy];
        int c = 0;
        void Put(float v) => dest[off + c++] = v;

        Put(Math.Min(state.Turn, 60) / 30f);
        Put(Math.Min(me.TurnsTaken, 30) / 20f);
        Put(Math.Min(enemy.TurnsTaken, 30) / 20f);
        Put(state.Phase == Phase.Awake ? 1 : 0);
        Put(state.Phase == Phase.Draw ? 1 : 0);
        Put(state.Phase == Phase.Main ? 1 : 0);
        Put(state.Phase == Phase.End ? 1 : 0);
        Put(state.Active == _me ? 1 : 0);
        Put(state.Pending is not null ? 1 : 0);
        Put(state.Pending is not null && state.Pending.Player == _me ? 1 : 0);
        Put(state.FlipQueue.Count > 0 ? 1 : 0);
        Put(state.ReplaceQueue.Count > 0 ? 1 : 0);

        // Scaled by the rule rather than by a constant, so moving the debt limit
        // does not quietly change what the network is reading.
        float debtScale = Rules.DebtLimit;
        Put(me.DebtCount / debtScale);
        Put(enemy.DebtCount / debtScale);
        Put((me.DebtCount - enemy.DebtCount) / debtScale);
        Put(me.DebtCount >= Rules.DebtLimit - 2 ? 1 : 0);
        Put(enemy.DebtCount >= Rules.DebtLimit - 2 ? 1 : 0);

        Put(Math.Min(me.Hand.Count, 12) / 10f);
        Put(Math.Min(enemy.Hand.Count, 12) / 10f);
        Put((me.Hand.Count - enemy.Hand.Count) / 10f);
        Put(Math.Min(me.Deck.Count, 60) / 48f);
        Put(Math.Min(enemy.Deck.Count, 60) / 48f);
        Put((me.Deck.Count - enemy.Deck.Count) / 48f);
        Put(Math.Min(me.Deck.Count / 2, 20) / 10f);
        Put(Math.Min(enemy.Deck.Count / 2, 20) / 10f);

        foreach (var col in Colors.All) Put(Math.Min(_myMana[(int)col], 6) / 3f);
        foreach (var col in Colors.All) Put(Math.Min(_enemyMana[(int)col], 6) / 3f);

        int mySapped = 0, enemySapped = 0;
        foreach (var s in me.Supporters)
        {
            if (s.Sapped) mySapped++;
        }
        foreach (var s in enemy.Supporters)
        {
            if (s.Sapped) enemySapped++;
        }
        Put(Math.Min(me.Supporters.Count, 12) / 8f);
        Put(Math.Min(enemy.Supporters.Count, 12) / 8f);
        Put(Math.Min(mySapped, 12) / 8f);
        Put(Math.Min(enemySapped, 12) / 8f);

        int myStrength = 0, enemyStrength = 0, myReady = 0, myBoardHp = 0, enemyBoardHp = 0;
        for (int i = 1; i <= Rules.SummonSlots; i++)
        {
            myStrength += _entStrength[i];
            enemyStrength += _entStrength[PerSide + i];
            myReady += ReadyStrength(i);
            myBoardHp += _entHp[i];
            enemyBoardHp += _entHp[PerSide + i];
        }
        Put(myStrength / 12f);
        Put(enemyStrength / 12f);
        Put((myStrength - enemyStrength) / 12f);
        Put(myBoardHp / 16f);
        Put(enemyBoardHp / 16f);

        int myLeader = _entHp[0], enemyLeader = _entHp[PerSide];
        Put(myLeader / 12f);
        Put(enemyLeader / 12f);
        Put((myLeader - enemyLeader) / 12f);
        Put(me.HasFieldSummon ? 0 : 1);
        Put(enemy.HasFieldSummon ? 0 : 1);
        Put(me.Stage is not null ? 1 : 0);
        Put(enemy.Stage is not null ? 1 : 0);
        Put(FreeSlots(me) / (float)Rules.SummonSlots);
        Put(FreeSlots(enemy) / (float)Rules.SummonSlots);

        double trapRisk = _intel.TrapRisk(state);
        Put((float)trapRisk);
        Put(trapRisk >= 1 ? 1 : 0);
        Put(enemy.Hand.Count > 0 ? Math.Min(1f, Total(_intel.KnownHand) / (float)enemy.Hand.Count) : 0);
        Put(enemy.Deck.Count > 0 ? Math.Min(1f, Total(_intel.KnownDeck) / (float)enemy.Deck.Count) : 0);
        Put(AccountedFraction());

        foreach (var col in Colors.All) Put((_myIdentity & (1 << (int)col)) != 0 ? 1 : 0);
        foreach (var col in Colors.All) Put((_enemyIdentity & (1 << (int)col)) != 0 ? 1 : 0);

        Put(!enemy.HasFieldSummon && myReady >= enemyLeader && enemyLeader > 0 ? 1 : 0);
        Put(!me.HasFieldSummon && enemyStrength >= myLeader && myLeader > 0 ? 1 : 0);
        Put(Math.Min(1f, _intel.PlausibleTagged(CardTag.Reach) / 12f));
        Put(Math.Min(1f, _intel.PlausibleTagged(CardTag.Steal) / 12f));

        int playable = 0, summons = 0, traps = 0;
        foreach (var id in me.Hand)
        {
            var def = Registry.Card(id);
            if (Affordable(def.Cost, _myMana)) playable++;
            if (def.Type == CardType.Summon) summons++;
            else if (def.Type == CardType.Trap) traps++;
        }
        Put(Math.Min(6, playable) / 6f);
        Put(Math.Min(6, summons) / 6f);
        Put(Math.Min(3, traps) / 3f);
        Put(KnownHandThreat());

        int myWounds = Wounds(0), enemyWounds = Wounds(PerSide);
        for (int i = 1; i <= Rules.SummonSlots; i++)
        {
            myWounds += Wounds(i);
            enemyWounds += Wounds(PerSide + i);
        }
        Put(Math.Min(4, myWounds) / 4f);
        Put(Math.Min(4, enemyWounds) / 4f);
        Put(Math.Min(3, ReadyAttackers(state)) / 3f);
        Put(me.SupportersLeft > 0 ? 1 : 0);
        Put(me.LeaderPlayed ? 1 : 0);
        Put(state.Battle is not null ? 1 : 0);
        Put(state.StartingPlayer == _me ? 1 : 0);
        Put(Math.Min(1f, _intel.ScoutRollsTaken / 60f));

        // Declared a little long on purpose: the tail stays zero until a feature
        // is added, which keeps saved networks loadable across small additions.
        while (c < ScalarCount) Put(0);
        if (c != ScalarCount)
        {
            throw new InvalidOperationException($"scalar count is {c}, declared {ScalarCount}");
        }
    }

    private int ReadyStrength(int entity) =>
        _ent[entity] is { Sapped: false } ? _entStrength[entity] : 0;

    private int Wounds(int entity) => _ent[entity]?.Wounds ?? 0;

    private int ReadyAttackers(GameState state)
    {
        int n = 0;
        for (int e = 1; e <= Rules.SummonSlots; e++)
        {
            if (_ent[e] is { } s && CanAttackNow(state, s, _me)) n++;
        }
        return n;
    }

    private static int FreeSlots(PlayerState p)
    {
        int n = 0;
        foreach (var s in p.Slots)
        {
            if (s is null) n++;
        }
        return n;
    }

    private static int Total(ReadOnlySpan<int> counts)
    {
        int n = 0;
        for (int i = 0; i < counts.Length; i++) n += counts[i];
        return n;
    }

    private float AccountedFraction()
    {
        int seen = 0, pool = 0;
        var accounted = _intel.Accounted;
        foreach (int c in _enemyPool)
        {
            seen += accounted[c];
            pool += CardIndex.CopyLimit(c);
        }
        return pool > 0 ? Math.Min(1f, seen / (float)pool * 4f) : 0;
    }

    /// <summary>Weight of the cards actually named in their hand, damage counted double.</summary>
    private float KnownHandThreat()
    {
        float n = 0;
        var known = _intel.KnownHand;
        for (int c = 0; c < _cards; c++)
        {
            if (known[c] == 0) continue;
            var tags = CardIndex.Tags(c);
            float w = 0.5f;
            if (tags.HasFlag(CardTag.Damage)) w += 1f;
            if (tags.HasFlag(CardTag.Steal)) w += 0.75f;
            if (CardIndex.Def(c).Type == CardType.Trap) w += 1f;
            n += known[c] * w;
        }
        return Math.Min(1f, n / 6f);
    }
}
