using Selatza.Learn.Nn;

namespace Selatza.Learn;

/// <summary>Which bodies an agent may be handed as its leader.</summary>
public enum LeaderPool
{
    /// <summary>Anything with a body, level 1 to 3, which is what the rules allow.</summary>
    All,
    /// <summary>The five starter cards only.</summary>
    Starter,
    /// <summary>Level 2 and 3 bodies, so a leader is not a 2 HP accident.</summary>
    Sturdy,
    /// <summary>Dual-colour bodies only, which is how two-colour decks get built.</summary>
    Dual,
    /// <summary>
    /// Every summon that does not carry a flip. One agent per card gives each of
    /// them a deck built around it and a rating of its own.
    /// </summary>
    NonFlip,
}

/// <summary>How a generated deck is shaped before the tournament starts pulling it apart.</summary>
public sealed class DeckShape
{
    public int Size { get; init; } = 48;
    public int Summons { get; init; } = 24;
    public int Spells { get; init; } = 14;
    public int Traps { get; init; } = 3;
    public int Stages { get; init; } = 2;
    /// <summary>Relative weight of level 1, 2 and 3 summons.</summary>
    public double[] LevelMix { get; init; } = { 0.42, 0.35, 0.23 };
    /// <summary>Minimum cards of each colour the leader's powers demand.</summary>
    public int MinPerDemandedColor { get; init; } = 10;

    public static DeckShape Default => new();
}

/// <summary>
/// Builds legal decks out of nothing and edits them when their owner loses.
///
/// Legality here is the same rule the deckbuilder enforces for a person: every
/// colour on a card has to be a colour the leader already brings, and rarity caps
/// how many copies fit.
/// </summary>
public static class DeckGen
{
    /// <summary>Cards that ship with art, which is the real set. Test dummies are excluded.</summary>
    public static bool IsRealCard(CardDef d) => d.Art is not null && !d.Uncollectible;

    public static List<string> LeaderCandidates(LeaderPool pool)
    {
        CardIndex.EnsureBuilt();
        var outList = new List<string>();
        foreach (var d in CardIndex.Defs)
        {
            if (!IsRealCard(d)) continue;
            if (!Identity.CanBeLeader(d.Id)) continue;
            bool ok = pool switch
            {
                LeaderPool.Starter => d.Starter,
                LeaderPool.Sturdy => d.Starter || d.Level >= 2,
                LeaderPool.Dual => d.Color2 is not null,
                LeaderPool.NonFlip => d.Type == CardType.Summon && d.Flip is null,
                _ => true,
            };
            if (ok) outList.Add(d.Id);
        }
        return outList;
    }

    public static string RandomLeader(LeaderPool pool, Gauss rng)
    {
        var list = LeaderCandidates(pool);
        return list[rng.NextInt(list.Count)];
    }

    /// <summary>
    /// Leaders for a whole population, one colour identity at a time before any
    /// identity gets a second.
    ///
    /// Drawing each leader independently leaves gaps: Pepper and Fish has two
    /// eligible bodies of the twenty-five dual ones, so a field of 24 misses it
    /// about one run in seven, and when it does, all five Pepper-Fish cards go
    /// unplayed and read as dead. That is the instrument, not the cards.
    /// </summary>
    public static List<string> SpreadLeaders(LeaderPool pool, int count, Gauss rng)
    {
        var byIdentity = new Dictionary<byte, List<string>>();
        foreach (var id in LeaderCandidates(pool))
        {
            byte mask = CardIndex.IdentityOf(id);
            if (!byIdentity.TryGetValue(mask, out var list))
            {
                list = new List<string>();
                byIdentity[mask] = list;
            }
            list.Add(id);
        }

        var groups = byIdentity.Keys.OrderBy(m => m).ToList();
        // Shuffle the order so the same identity is not always served first.
        for (int i = groups.Count - 1; i > 0; i--)
        {
            int j = rng.NextInt(i + 1);
            (groups[i], groups[j]) = (groups[j], groups[i]);
        }

        var outList = new List<string>(count);
        for (int i = 0; i < count; i++)
        {
            var bodies = byIdentity[groups[i % groups.Count]];
            outList.Add(bodies[rng.NextInt(bodies.Count)]);
        }
        return outList;
    }

    /// <summary>Every card the leader's colours allow into the deck.</summary>
    public static List<int> PoolFor(string leaderId)
    {
        CardIndex.EnsureBuilt();
        byte identity = CardIndex.IdentityOf(leaderId);
        var outList = new List<int>();
        for (int c = 0; c < CardIndex.Count; c++)
        {
            var def = CardIndex.Def(c);
            if (!IsRealCard(def)) continue;
            if (!CardIndex.LegalUnder(c, identity)) continue;
            outList.Add(c);
        }
        return outList;
    }

    /// <summary>Colours the leader's own powers need paying in, which the deck has to supply.</summary>
    public static bool[] DemandedColors(string leaderId)
    {
        var demanded = new bool[5];
        var def = Registry.TryCard(leaderId);
        if (def is null) return demanded;
        foreach (var p in def.Powers ?? Array.Empty<Power>())
        {
            foreach (var c in Colors.All)
            {
                if (p.Cost[c] > 0) demanded[(int)c] = true;
            }
        }
        return demanded;
    }

    private static int Pick(List<int> pool, double[] weight, Gauss rng)
    {
        double total = 0;
        for (int i = 0; i < pool.Count; i++) total += weight[i];
        if (total <= 0) return pool[rng.NextInt(pool.Count)];
        double roll = rng.Uniform() * total;
        for (int i = 0; i < pool.Count; i++)
        {
            roll -= weight[i];
            if (roll <= 0) return pool[i];
        }
        return pool[^1];
    }

    public static List<string> Random(string leaderId, DeckShape shape, Gauss rng,
        IReadOnlyList<double>? prior = null)
    {
        var pool = PoolFor(leaderId);
        if (pool.Count == 0) throw new InvalidOperationException($"{leaderId} has no legal pool");
        var counts = new Dictionary<int, int>();
        int total = 0;

        void Take(Func<CardDef, bool> want, int howMany, Func<CardDef, double> bias)
        {
            var subset = new List<int>();
            foreach (int c in pool)
            {
                if (want(CardIndex.Def(c))) subset.Add(c);
            }
            if (subset.Count == 0) return;
            var weights = new double[subset.Count];
            for (int i = 0; i < subset.Count; i++)
            {
                double p = prior is null ? 1 : Math.Max(0.05, prior[subset[i]]);
                weights[i] = bias(CardIndex.Def(subset[i])) * p;
            }

            int guard = 0;
            while (howMany > 0 && guard++ < 400)
            {
                int card = Pick(subset, weights, rng);
                int limit = CardIndex.CopyLimit(card);
                int have = counts.GetValueOrDefault(card);
                if (have >= limit) continue;
                // Commons come in playsets, legends come alone: the copy count is
                // a roll inside what rarity allows, weighted towards filling out.
                int want2 = 1 + rng.NextInt(limit);
                int add = Math.Min(Math.Min(want2, limit - have), howMany);
                counts[card] = have + add;
                howMany -= add;
                total += add;
            }
        }

        Take(d => d.Type == CardType.Summon, shape.Summons, d => shape.LevelMix[Math.Clamp(d.Level, 1, 3) - 1]);
        Take(d => d.Type == CardType.Spell, shape.Spells, _ => 1);
        Take(d => d.Type == CardType.Trap, shape.Traps, _ => 1);
        Take(d => d.Type == CardType.Stage, shape.Stages, _ => 1);

        // Whatever the type targets could not fill, and the colours the leader's
        // powers need paying in.
        var demanded = DemandedColors(leaderId);
        for (int ci = 0; ci < 5; ci++)
        {
            if (!demanded[ci]) continue;
            var col = Colors.All[ci];
            int have = 0;
            foreach (var (card, n) in counts)
            {
                if (CardIndex.Def(card).Color == col) have += n;
            }
            int need = shape.MinPerDemandedColor - have;
            if (need > 0 && total + need <= shape.Size)
            {
                Take(d => d.Color == col && d.Color2 is null, need, _ => 1);
            }
        }

        int shortfall = shape.Size - total;
        if (shortfall > 0) Take(_ => true, shortfall, d => d.Type == CardType.Summon ? 1.4 : 1);

        return Expand(counts, shape.Size, pool, rng);
    }

    private static List<string> Expand(Dictionary<int, int> counts, int size, List<int> pool, Gauss rng)
    {
        var list = new List<string>(size);
        foreach (var (card, n) in counts.OrderBy(kv => kv.Key))
        {
            for (int i = 0; i < n; i++) list.Add(CardIndex.Id(card));
        }
        // A tiny pool may not reach the target size; a short deck is legal, it
        // just runs out sooner, so it is left short rather than made illegal.
        int guard = 0;
        while (list.Count > size) list.RemoveAt(list.Count - 1);
        while (list.Count < size && guard++ < 400)
        {
            int card = pool[rng.NextInt(pool.Count)];
            if (counts.GetValueOrDefault(card) >= CardIndex.CopyLimit(card)) continue;
            counts[card] = counts.GetValueOrDefault(card) + 1;
            list.Add(CardIndex.Id(card));
        }
        list.Sort(StringComparer.Ordinal);
        return list;
    }

    /// <summary>
    /// Swaps cards out of a deck that just lost. Removals come from the bottom of
    /// whatever the agent learned about its own cards, additions from the pool
    /// weighted by how the card has done for everyone.
    /// </summary>
    public static List<string> Mutate(string leaderId, IReadOnlyList<string> deck, int swaps,
        Func<int, double> localScore, Func<int, double> globalScore, Gauss rng)
    {
        var counts = new Dictionary<int, int>();
        foreach (var id in deck)
        {
            int c = CardIndex.Of(id);
            if (c >= 0) counts[c] = counts.GetValueOrDefault(c) + 1;
        }

        var pool = PoolFor(leaderId);
        var poolSet = new HashSet<int>(pool);
        int size = deck.Count;

        for (int s = 0; s < swaps; s++)
        {
            // Drop: worst local score, with a nudge so the same card is not
            // always the one that goes.
            int worst = -1;
            double worstScore = double.MaxValue;
            foreach (var (card, n) in counts)
            {
                if (n <= 0) continue;
                double sc = localScore(card) + rng.Uniform() * 0.15;
                if (sc < worstScore)
                {
                    worstScore = sc;
                    worst = card;
                }
            }
            if (worst < 0) break;
            counts[worst]--;
            if (counts[worst] <= 0) counts.Remove(worst);

            // Add: best of a small random slate, so the population explores
            // rather than everyone converging on the same four cards.
            int best = -1;
            double bestScore = double.MinValue;
            for (int t = 0; t < 6; t++)
            {
                int card = pool[rng.NextInt(pool.Count)];
                if (counts.GetValueOrDefault(card) >= CardIndex.CopyLimit(card)) continue;
                double sc = globalScore(card) + rng.Uniform() * 0.25;
                if (sc > bestScore)
                {
                    bestScore = sc;
                    best = card;
                }
            }
            if (best < 0) continue;
            counts[best] = counts.GetValueOrDefault(best) + 1;
        }

        foreach (var card in counts.Keys.ToList())
        {
            if (!poolSet.Contains(card)) counts.Remove(card);
        }
        return Expand(counts, size, pool, rng);
    }

    /// <summary>Why a deck is illegal, or null when it is fine.</summary>
    public static string? Validate(string leaderId, IReadOnlyList<string> cards, int expectedSize = 0)
    {
        CardIndex.EnsureBuilt();
        if (!Identity.CanBeLeader(leaderId)) return $"{leaderId} cannot stand as a leader";
        if (expectedSize > 0 && cards.Count != expectedSize)
        {
            return $"deck has {cards.Count} cards, wanted {expectedSize}";
        }
        var (ok, _, off) = Identity.CheckDeckColors(leaderId, cards);
        if (!ok) return $"off-colour: {string.Join(", ", off.Take(4))}";

        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var id in cards) counts[id] = counts.GetValueOrDefault(id) + 1;
        foreach (var (id, n) in counts)
        {
            var def = Registry.TryCard(id);
            if (def is null) return $"unknown card {id}";
            int limit = Rarities.Limit(def.Rarity);
            if (n > limit) return $"{n} copies of {id}, limit {limit}";
        }
        return null;
    }

    public static DeckList ToDeckList(string name, string leaderId, IReadOnlyList<string> cards) =>
        new() { Name = name, LeaderId = leaderId, Cards = cards };
}
