namespace Selatza.Learn;

public static class Elo
{
    public const double Start = 1500;

    public static double Expected(double mine, double theirs) =>
        1.0 / (1.0 + Math.Pow(10, (theirs - mine) / 400.0));

    /// <summary>Provisional ratings move fast, settled ones slowly.</summary>
    public static double K(int games) => games < 30 ? 32 : games < 100 ? 20 : 12;

    /// <summary>Returns the new rating for the player whose score is given.</summary>
    public static double Update(double mine, double theirs, double score, int games) =>
        mine + K(games) * (score - Expected(mine, theirs));
}

/// <summary>
/// What each card did for whoever played it.
///
/// The number that matters is lift: the result of a game the card was played in,
/// minus what the rating difference said that game was worth before it started.
/// A raw win rate cannot be read as a card's strength, because a card sitting in
/// the strongest deck in the population inherits that deck's record and every
/// card in a losing deck looks bad. Subtracting the expected result takes both
/// the deck and the opponent out of it, and what is left is closer to the card's
/// own contribution.
///
/// It is still not an experiment. For that, swap one card and play the same deck
/// against itself.
/// </summary>
public sealed class CardStats
{
    private readonly int[] _plays;
    private readonly double[] _lift;
    private readonly double[] _liftSq;
    private readonly int[] _turns;
    private readonly int[] _stuck;
    private readonly int[] _appearances;
    private readonly int[][] _bucketPlays;
    private readonly double[][] _bucketLift;

    /// <summary>Games of evidence a card needs before its lift is taken at face value.</summary>
    public const double Shrink = 12;

    /// <summary>
    /// When in the game a card was played, in its owner's own turns: most games
    /// give each player four to six, so the opening is turns 1-2, the middle
    /// 3-4, and anything later is the late game.
    /// </summary>
    public const int Buckets = 3;

    public static readonly string[] BucketNames = { "turns 1-2", "turns 3-4", "turn 5+" };

    public static int BucketOf(int turn) => turn <= 2 ? 0 : turn <= 4 ? 1 : 2;

    public CardStats()
    {
        CardIndex.EnsureBuilt();
        int n = CardIndex.Count;
        _plays = new int[n];
        _lift = new double[n];
        _liftSq = new double[n];
        _turns = new int[n];
        _stuck = new int[n];
        _appearances = new int[n];
        _bucketPlays = new int[Buckets][];
        _bucketLift = new double[Buckets][];
        for (int b = 0; b < Buckets; b++)
        {
            _bucketPlays[b] = new int[n];
            _bucketLift[b] = new double[n];
        }
    }

    /// <summary>
    /// One play of one card. <paramref name="lift"/> is the game's result from
    /// its owner's side minus the result the ratings expected, so it is positive
    /// when the game went better than the matchup said it should.
    /// <paramref name="playedTurn"/> is the turn the card left the hand.
    /// </summary>
    public void Played(int card, double lift, int turns, int playedTurn)
    {
        if (card < 0) return;
        _plays[card]++;
        _lift[card] += lift;
        _liftSq[card] += lift * lift;
        _turns[card] += turns;
        int b = BucketOf(playedTurn);
        _bucketPlays[b][card]++;
        _bucketLift[b][card] += lift;
    }

    public void StuckInHand(int card)
    {
        if (card >= 0) _stuck[card]++;
    }

    public void Appeared(int card)
    {
        if (card >= 0) _appearances[card]++;
    }

    public int Plays(int card) => _plays[card];
    public int Appearances(int card) => _appearances[card];

    /// <summary>Average length of the games this card was played in, in turns.</summary>
    public double AverageTurns(int card) => _plays[card] > 0 ? _turns[card] / (double)_plays[card] : 0;

    /// <summary>How often it was still in hand when the game ended.</summary>
    public double DeadRate(int card) =>
        _appearances[card] > 0 ? _stuck[card] / (double)_appearances[card] : 0;

    /// <summary>
    /// Lift per game, pulled towards zero until there is enough evidence. A card
    /// played four times cannot be allowed to top the table.
    /// </summary>
    public double Lift(int card) => _lift[card] / (_plays[card] + Shrink);

    /// <summary>
    /// Standard deviation of the card's per-game lift: how far the games it is
    /// played in spread around their own average, which is what "swingy" means.
    /// </summary>
    public double Swing(int card)
    {
        int n = _plays[card];
        if (n < 2) return 0;
        double mean = _lift[card] / n;
        return Math.Sqrt(Math.Max(0, _liftSq[card] / n - mean * mean));
    }

    public int BucketPlays(int bucket, int card) => _bucketPlays[bucket][card];

    /// <summary>Lift per game inside one timing bucket, shrunk like <see cref="Lift"/>.</summary>
    public double BucketLift(int bucket, int card) =>
        _bucketLift[bucket][card] / (_bucketPlays[bucket][card] + Shrink);

    /// <summary>Lift, less a penalty for a card that spends the game in hand.</summary>
    public double Score(int card) => Lift(card) - 0.25 * DeadRate(card);

    public void Merge(CardStats other)
    {
        for (int i = 0; i < _plays.Length; i++)
        {
            _plays[i] += other._plays[i];
            _lift[i] += other._lift[i];
            _liftSq[i] += other._liftSq[i];
            _turns[i] += other._turns[i];
            _stuck[i] += other._stuck[i];
            _appearances[i] += other._appearances[i];
            for (int b = 0; b < Buckets; b++)
            {
                _bucketPlays[b][i] += other._bucketPlays[b][i];
                _bucketLift[b][i] += other._bucketLift[b][i];
            }
        }
    }

    /// <summary>
    /// The population's opinion of a card, with a bonus for cards nobody has
    /// tried. Without the bonus a random opening deck decides the metagame.
    /// </summary>
    public double GlobalScore(int card, int totalPlays)
    {
        double explore = 0.35 * Math.Sqrt(Math.Log(totalPlays + 2.0) / (_plays[card] + 1.0));
        return Score(card) + explore;
    }

    public int TotalPlays
    {
        get
        {
            int n = 0;
            foreach (var p in _plays) n += p;
            return n;
        }
    }

    public void Save(BinaryWriter w)
    {
        w.Write(_plays.Length);
        for (int i = 0; i < _plays.Length; i++)
        {
            w.Write(_plays[i]);
            w.Write(_lift[i]);
            w.Write(_liftSq[i]);
            w.Write(_turns[i]);
            w.Write(_stuck[i]);
            w.Write(_appearances[i]);
            for (int b = 0; b < Buckets; b++)
            {
                w.Write(_bucketPlays[b][i]);
                w.Write(_bucketLift[b][i]);
            }
        }
    }

    public void Load(BinaryReader r)
    {
        int n = r.ReadInt32();
        for (int i = 0; i < n; i++)
        {
            int plays = r.ReadInt32();
            double lift = r.ReadDouble();
            double liftSq = r.ReadDouble();
            int turns = r.ReadInt32();
            int stuck = r.ReadInt32();
            int appearances = r.ReadInt32();
            var bp = new int[Buckets];
            var bl = new double[Buckets];
            for (int b = 0; b < Buckets; b++)
            {
                bp[b] = r.ReadInt32();
                bl[b] = r.ReadDouble();
            }
            if (i >= _plays.Length) continue;
            _plays[i] = plays;
            _lift[i] = lift;
            _liftSq[i] = liftSq;
            _turns[i] = turns;
            _stuck[i] = stuck;
            _appearances[i] = appearances;
            for (int b = 0; b < Buckets; b++)
            {
                _bucketPlays[b][i] = bp[b];
                _bucketLift[b][i] = bl[b];
            }
        }
    }
}

/// <summary>
/// How a run ended, kept so a card set can be asked whether its games are the
/// shape they are meant to be. A pile of four-turn wins or a pile of games that
/// never resolve are both balance problems, and neither shows up in a win rate.
/// </summary>
public sealed class GameShape
{
    private readonly Dictionary<string, int> _reasons = new(StringComparer.Ordinal);
    private readonly List<int> _turns = new();
    private int _unresolved;
    private int _sawFatigue;

    public void Add(int turns, string? reason, bool resolved,
        bool fatigueKill = false, bool sawFatigue = false)
    {
        _turns.Add(turns);
        if (!resolved) _unresolved++;
        if (sawFatigue) _sawFatigue++;
        var key = Classify(reason, fatigueKill);
        _reasons[key] = _reasons.GetValueOrDefault(key) + 1;
    }

    public static string Classify(string? reason, bool fatigueKill = false)
    {
        if (reason is null) return "unresolved";
        if (reason.Contains("leader", StringComparison.Ordinal)) return "leader fell";
        if (reason.Contains("debt", StringComparison.Ordinal))
        {
            return fatigueKill ? "ran out of cards" : $"reached {Rules.DebtLimit} debt";
        }
        if (reason.Contains("conceded", StringComparison.Ordinal)) return "conceded";
        return reason;
    }

    public int Games => _turns.Count;
    public int Unresolved => _unresolved;

    /// <summary>Games in which either side was charged debt for an empty deck,
    /// whether or not that is what finished them.</summary>
    public int SawFatigue => _sawFatigue;

    public double Median
    {
        get
        {
            if (_turns.Count == 0) return 0;
            var sorted = _turns.OrderBy(t => t).ToList();
            return sorted[sorted.Count / 2];
        }
    }

    public double Mean => _turns.Count == 0 ? 0 : _turns.Average();

    /// <summary>Share of games that ended before either player had time to build.</summary>
    public double ShareUnder(int turns) =>
        _turns.Count == 0 ? 0 : _turns.Count(t => t < turns) / (double)_turns.Count;

    public IEnumerable<(string Reason, int Count)> Reasons =>
        _reasons.OrderByDescending(kv => kv.Value).Select(kv => (kv.Key, kv.Value));

    public void Merge(GameShape other)
    {
        _turns.AddRange(other._turns);
        _unresolved += other._unresolved;
        _sawFatigue += other._sawFatigue;
        foreach (var (k, v) in other._reasons) _reasons[k] = _reasons.GetValueOrDefault(k) + v;
    }
}
