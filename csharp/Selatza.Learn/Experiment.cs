using Selatza.Cards;

namespace Selatza.Learn;

public readonly record struct Interval(double Low, double High)
{
    public override string ToString() => $"{Low:P1} to {High:P1}";
}

public sealed class MatchupResult
{
    public int WinsA { get; set; }
    public int WinsB { get; set; }
    public int Draws { get; set; }
    public GameShape Shape { get; } = new();

    public int Games => WinsA + WinsB + Draws;
    public double RateA => Games == 0 ? 0 : (WinsA + 0.5 * Draws) / Games;

    /// <summary>
    /// Wilson interval, which stays sensible near 0 and 1 where the textbook
    /// normal approximation runs off the end of the scale.
    /// </summary>
    public Interval Confidence95
    {
        get
        {
            int n = Games;
            if (n == 0) return new Interval(0, 1);
            const double z = 1.96;
            double p = RateA;
            double denom = 1 + z * z / n;
            double centre = (p + z * z / (2.0 * n)) / denom;
            double half = z * Math.Sqrt(p * (1 - p) / n + z * z / (4.0 * n * n)) / denom;
            return new Interval(Math.Max(0, centre - half), Math.Min(1, centre + half));
        }
    }

    /// <summary>True when the interval excludes an even matchup.</summary>
    public bool Decisive => Confidence95.Low > 0.5 || Confidence95.High < 0.5;
}

/// <summary>
/// The direct experiment: two decks, the same games, one difference. A card's
/// row in a tournament report is a correlation over decks that were changing
/// underneath it, and is only ever a shortlist. This is how a suspicion gets
/// settled.
/// </summary>
public static class Experiment
{
    public sealed class Deck
    {
        public required string Name { get; init; }
        public required string LeaderId { get; init; }
        public required List<string> Cards { get; init; }

        public DeckList ToList() => DeckGen.ToDeckList(Name, LeaderId, Cards);

        public Deck Clone(string name) => new()
        { Name = name, LeaderId = LeaderId, Cards = new List<string>(Cards) };
    }

    /// <summary>A deck file written by the tournament, or <c>starter:key</c>.</summary>
    public static Deck Load(string spec)
    {
        CardIndex.EnsureBuilt();
        if (spec.StartsWith("starter:", StringComparison.OrdinalIgnoreCase))
        {
            var key = spec["starter:".Length..];
            var deck = CardSets.ByKey(key);
            return new Deck { Name = deck.Name, LeaderId = deck.LeaderId, Cards = deck.Cards.ToList() };
        }
        if (!File.Exists(spec)) throw new FileNotFoundException($"no deck at {spec}");

        string leader = "";
        var cards = new List<string>();
        foreach (var line in File.ReadAllLines(spec))
        {
            var t = line.Trim();
            if (t.StartsWith("leader:", StringComparison.Ordinal))
            {
                int lb = t.IndexOf('['), rb = t.IndexOf(']');
                if (lb >= 0 && rb > lb) leader = t.Substring(lb + 1, rb - lb - 1);
                continue;
            }
            int x = t.IndexOf('x');
            if (x <= 0 || !int.TryParse(t[..x], out int n)) continue;
            int l2 = t.IndexOf('['), r2 = t.IndexOf(']');
            if (l2 < 0 || r2 < l2) continue;
            string id = t.Substring(l2 + 1, r2 - l2 - 1);
            for (int i = 0; i < n; i++) cards.Add(id);
        }
        if (leader.Length == 0) throw new InvalidDataException($"{spec} names no leader");
        return new Deck { Name = Path.GetFileNameWithoutExtension(spec), LeaderId = leader, Cards = cards };
    }

    /// <summary>
    /// Replaces copies of one card with another. <paramref name="count"/> of 0
    /// swaps every copy, which is the "is this card better than that one" test;
    /// a smaller number is the "does cutting it from four to two help" test.
    /// </summary>
    public static Deck Swap(Deck deck, string fromId, string toId, int count, out string? problem)
    {
        problem = null;
        var copy = deck.Clone(deck.Name + " swapped");
        int have = copy.Cards.Count(id => string.Equals(id, fromId, StringComparison.Ordinal));
        if (have == 0)
        {
            problem = $"{fromId} is not in {deck.Name}";
            return copy;
        }
        int want = count <= 0 ? have : Math.Min(count, have);

        for (int i = 0, done = 0; i < copy.Cards.Count && done < want; i++)
        {
            if (!string.Equals(copy.Cards[i], fromId, StringComparison.Ordinal)) continue;
            copy.Cards[i] = toId;
            done++;
        }
        copy.Cards.Sort(StringComparer.Ordinal);
        problem = DeckGen.Validate(copy.LeaderId, copy.Cards);
        return copy;
    }

    /// <summary>
    /// Plays the two decks against each other, alternating who goes first, and
    /// on the same seeds each way so the comparison is paired.
    /// </summary>
    public static MatchupResult Play(Deck a, Deck b, int games, int seed, int threads,
        IntelConfig? intel = null, AgentConfig? agentCfg = null, Nn.SelatzaNet? net = null)
    {
        var result = new MatchupResult();
        threads = Math.Max(1, threads);
        var winners = new int[games];
        var turns = new int[games];
        var reasons = new string?[games];
        var fatigueKill = new bool[games];
        var sawFatigue = new bool[games];

        Brain? brain = null;
        if (net is not null)
        {
            brain = new Brain { Name = "loaded", Net = net };
            brain.EnsureReplicas(threads, seed + 7);
        }

        var free = new System.Collections.Concurrent.ConcurrentBag<int>();
        for (int i = 0; i < threads; i++) free.Add(i);
        var opts = new ParallelOptions { MaxDegreeOfParallelism = threads };

        Parallel.For(0, games, opts, g =>
        {
            var agentA = new Agent
            {
                Name = a.Name,
                LeaderId = a.LeaderId,
                Deck = a.Cards,
                Brain = brain,
                Config = agentCfg ?? new AgentConfig { RecordEvery = 0 },
                Intel = intel ?? IntelConfig.Default,
                ReferenceBot = brain is null,
            };
            var agentB = new Agent
            {
                Name = b.Name,
                LeaderId = b.LeaderId,
                Deck = b.Cards,
                Brain = brain,
                Config = agentCfg ?? new AgentConfig { RecordEvery = 0 },
                Intel = intel ?? IntelConfig.Default,
                ReferenceBot = brain is null,
            };
            if (!free.TryTake(out int slot)) slot = 0;
            try
            {
                var m = Match.Play(agentA, agentB, unchecked(seed + g * 104729 + 7), g % 2, slot);
                winners[g] = m.Winner;
                turns[g] = m.Turns;
                reasons[g] = m.Reason;
                fatigueKill[g] = m.FatigueKill;
                sawFatigue[g] = m.SawFatigue;
            }
            finally
            {
                free.Add(slot);
            }
        });

        for (int g = 0; g < games; g++)
        {
            if (winners[g] == 0) result.WinsA++;
            else if (winners[g] == 1) result.WinsB++;
            else result.Draws++;
            result.Shape.Add(turns[g], reasons[g], reasons[g] is not null,
                fatigueKill[g], sawFatigue[g]);
        }
        return result;
    }

    /// <summary>Reads a cards.csv written by a run, keyed by card id.</summary>
    public static Dictionary<string, string[]> ReadCsv(string path)
    {
        var rows = new Dictionary<string, string[]>(StringComparer.Ordinal);
        var lines = File.ReadAllLines(path);
        for (int i = 1; i < lines.Length; i++)
        {
            var parts = SplitCsv(lines[i]);
            if (parts.Length < 3) continue;
            rows[parts[0]] = parts;
        }
        return rows;
    }

    private static string[] SplitCsv(string line)
    {
        var outList = new List<string>();
        bool quoted = false;
        var sb = new System.Text.StringBuilder();
        foreach (char ch in line)
        {
            if (ch == '"') quoted = !quoted;
            else if (ch == ',' && !quoted)
            {
                outList.Add(sb.ToString());
                sb.Clear();
            }
            else sb.Append(ch);
        }
        outList.Add(sb.ToString());
        return outList.ToArray();
    }
}
