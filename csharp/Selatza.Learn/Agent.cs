using Selatza.Ai;
using Selatza.Learn.Nn;

namespace Selatza.Learn;

/// <summary>
/// One network, its optimiser, and the positions it has seen. Several agents can
/// share a brain: four decks feeding one network is four times the training data
/// and a rating that says something about the network rather than the deck.
/// </summary>
public sealed class Brain
{
    private SelatzaNet[] _replicas = Array.Empty<SelatzaNet>();

    public required string Name { get; init; }
    public required SelatzaNet Net { get; init; }
    public Adam Optimizer { get; init; } = new();
    public SampleStore Store { get; } = new();
    public double Elo { get; set; } = Selatza.Learn.Elo.Start;
    public int Games { get; set; }
    public int Wins { get; set; }
    public int Draws { get; set; }
    public int TrainedSteps { get; set; }
    public double LastLoss { get; set; }

    /// <summary>Play runs in parallel, so each worker slot gets its own buffers.</summary>
    public SelatzaNet Replica(int slot) => _replicas[slot % _replicas.Length];

    public void EnsureReplicas(int count, int seed)
    {
        if (_replicas.Length >= count) return;
        var grown = new SelatzaNet[count];
        Array.Copy(_replicas, grown, _replicas.Length);
        for (int i = _replicas.Length; i < count; i++) grown[i] = Net.CloneWeights(seed + i * 7919);
        _replicas = grown;
    }

    public void RefreshReplicas(int count = int.MaxValue)
    {
        int n = Math.Min(count, _replicas.Length);
        for (int i = 0; i < n; i++) _replicas[i].CopyWeightsFrom(Net);
    }

    public int ReplicaCount => _replicas.Length;

    public double WinRate => Games > 0 ? (Wins + 0.5 * Draws) / Games : 0;
}

/// <summary>A seat at the table: an assigned leader, the deck built under it, and a brain.</summary>
public sealed class Agent
{
    public required string Name { get; init; }
    public required string LeaderId { get; set; }
    public required List<string> Deck { get; set; }

    /// <summary>
    /// The deck this agent held when its rating was highest, and that rating.
    /// Mutation edits the deck in place with no memory, so a run of bad swaps
    /// walks a good list away and nothing brings it back. Kept so the agent can
    /// restart from its own best rather than from wherever the walk left it.
    /// </summary>
    public List<string>? BestDeck { get; set; }

    public double BestElo { get; set; } = double.MinValue;

    /// <summary>How often this agent was restored to its own best deck.</summary>
    public int Reverts { get; set; }
    public Brain? Brain { get; init; }
    public AgentConfig Config { get; init; } = new();

    /// <summary>
    /// What this seat's bot believes, when it should not be the shipped
    /// default. A deck and the evaluator that pilots it are one strategy:
    /// a Candy list is built to bank Love and spend it later, and an
    /// evaluator that prices a Love token at 0.6 against 8 for a point of
    /// leader HP will not play toward that whatever the cards say. Null
    /// means the shipped weights.
    /// </summary>
    public BotWeights? Weights { get; init; }
    public IntelConfig Intel { get; init; } = IntelConfig.Default;
    public CardStats Stats { get; } = new();

    public double Elo { get; set; } = Selatza.Learn.Elo.Start;
    public int Games { get; set; }
    public int Wins { get; set; }
    public int Losses { get; set; }
    public int Draws { get; set; }
    public int RoundWins { get; set; }
    public int RoundLosses { get; set; }
    public int Mutations { get; set; }

    /// <summary>
    /// Surprise accumulated since this deck last mutated, and the games it
    /// covers. Raw wins and losses punish a deck for meeting a stronger one,
    /// which is the wrong signal: what matters is whether it did better or
    /// worse than its own rating predicted. Reset every time the deck mutates.
    /// </summary>
    public double WindowSurprise { get; set; }

    public int WindowGames { get; set; }

    /// <summary>Sum and sum of squares of (result - expected), one entry per game.</summary>
    public double SurpriseSum { get; set; }

    public double SurpriseSq { get; set; }

    /// <summary>
    /// Standard deviation of how far this deck's games land from what the
    /// ratings predicted. A steady deck beats who it should and loses to who it
    /// should; a swingy one wins and loses games the ratings called wrong.
    /// </summary>
    public double Volatility
    {
        get
        {
            if (Games < 2) return 0;
            double mean = SurpriseSum / Games;
            return Math.Sqrt(Math.Max(0, SurpriseSq / Games - mean * mean));
        }
    }

    /// <summary>The shipped one-ply bot, kept at a fixed rating so the ladder has a zero.</summary>
    public bool ReferenceBot { get; init; }

    /// <summary>
    /// Plays the snapshot in <see cref="PreviousBot"/> rather than the current
    /// bot, so a run can evolve decks under the new bot while its anchors hold
    /// the old one.
    /// </summary>
    public bool Previous { get; init; }

    /// <summary>Anchors neither learn nor rebuild their decks.</summary>
    public bool Frozen { get; init; }

    public string LeaderName => Registry.TryCard(LeaderId)?.Name ?? LeaderId;

    public string Colors
    {
        get
        {
            byte m = CardIndex.IdentityOf(LeaderId);
            var sb = new System.Text.StringBuilder();
            foreach (var c in Selatza.Colors.All)
            {
                if ((m & (1 << (int)c)) != 0) sb.Append(Selatza.Colors.Letter(c));
            }
            return sb.ToString();
        }
    }

    public double WinRate => Games > 0 ? (Wins + 0.5 * Draws) / Games : 0;

    public DeckList ToDeckList(string? label = null) =>
        DeckGen.ToDeckList(label ?? Name, LeaderId, Deck);
}
