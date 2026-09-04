using Selatza.Ai;
using Selatza.Learn.Nn;

namespace Selatza.Learn;

public sealed class AgentConfig
{
    /// <summary>
    /// How large a correction the network is allowed to make to the search's
    /// ranking. The network does not score positions on its own: it predicts
    /// how much the search was wrong, and this is the size of the nudge.
    ///
    /// The candidates handed to the network are the end-of-turn positions the
    /// search already played the opponent's reply out for, and their scores sit
    /// close together. A network asked to rank them from scratch has to be
    /// better than the search at exactly the comparisons the search finds
    /// hardest, and one that is merely as good adds noise and picks worse.
    /// Predicting zero, which is what an untrained one does, leaves the ranking
    /// alone.
    /// </summary>
    public double NetWeight { get; set; } = 0.35;

    /// <summary>Divisor that puts search scores on the network's [-1, 1] scale.</summary>
    public double HeuristicScale { get; set; } = 200.0;

    /// <summary>Chance of taking a random candidate instead of the best.</summary>
    public double Epsilon { get; set; } = 0.0;

    /// <summary>Softmax spread over candidate scores. 0 is a plain argmax.</summary>
    public double Temperature { get; set; } = 0.0;

    /// <summary>Keep one planned turn in this many for training.</summary>
    public int RecordEvery { get; set; } = 1;

    public AgentConfig Clone() => (AgentConfig)MemberwiseClone();
}

/// <summary>
/// One player at the table: the shipped bot's search, with its final choice
/// re-read by a network that only sees what this side is entitled to see.
///
/// The search plans a turn once and follows it, so the network is asked once
/// per planned turn rather than once per action. It is handed the end-of-turn
/// candidates the search played the reply out for, which are the comparisons
/// that decide the turn. Everything below that level stays on the raw
/// evaluator, because its job there is pruning and a correction would only add
/// noise to it.
/// </summary>
public sealed class NeuralPlayer : Bot.ILeafChooser
{
    private readonly SelatzaNet _net;
    private readonly BotWeights _weights;
    private readonly AgentConfig _cfg;

    private Encoder? _enc;
    private Intel? _intel;
    private int _me;
    private Gauss _rng = new(1);

    private float[] _batch = Array.Empty<float>();
    private float[] _values = Array.Empty<float>();
    private readonly float[] _handTarget = new float[SelatzaNet.HandBuckets];

    private SampleStore? _store;
    private float _lastPrior;
    private int _firstRow = -1;
    private int _lastRow = -1;
    private bool _lastBooted;
    private int _rows;
    private int _decisions;

    public NeuralPlayer(SelatzaNet net, AgentConfig cfg, BotWeights? weights = null)
    {
        _net = net;
        _cfg = cfg;
        _weights = weights ?? BotWeights.Default;
    }

    public SelatzaNet Net => _net;
    public Intel Intel => _intel ?? throw new InvalidOperationException("no game started");
    public AgentConfig Config => _cfg;

    /// <summary>Positions this player contributed to the store during the last game.</summary>
    public int RecordedRows => _rows;

    /// <summary>Times this player was asked to act, and how often the search put a turn to it.</summary>
    public int DecisionsAsked { get; private set; }

    public int DecisionsWithChoice => _decisions;

    public void StartGame(GameState state, int me, Intel intel, Gauss rng, SampleStore? store)
    {
        _me = me;
        _intel = intel;
        _rng = rng;
        _enc = new Encoder(me, intel, state);
        _store = store;
        if (_batch.Length == 0) _batch = new float[_net.SampleSize];
        _firstRow = -1;
        _lastRow = -1;
        _lastBooted = false;
        _rows = 0;
        _decisions = 0;
        intel.Begin(state);
    }

    /// <summary>
    /// Labels everything this player recorded with how the game turned out. The
    /// last position has no next turn to bootstrap from, so the result stands
    /// in for it.
    /// </summary>
    public void EndGame(float outcome)
    {
        if (_store is null || _firstRow < 0) return;
        _store.SetValues(_firstRow, _rows, outcome);
        if (_lastRow >= 0) _store.SetBoot(_lastRow, outcome);
    }

    /// <summary>
    /// The shipped bot's whole decision, with this player installed as the judge
    /// of its final ranking for the duration of the call. The hook is per
    /// thread and the tournament plays one game per thread, so nothing else can
    /// see it.
    /// </summary>
    public GameAction Choose(GameState state)
    {
        DecisionsAsked++;
        Bot.Chooser = this;
        try
        {
            return Bot.ChooseAction(state, _me, _weights);
        }
        finally
        {
            Bot.Chooser = null;
        }
    }

    int Bot.ILeafChooser.Pick(IReadOnlyList<GameState> leaves, IReadOnlyList<double> scores, int me)
    {
        var enc = _enc ?? throw new InvalidOperationException("no game started");
        int n = leaves.Count;
        if (n == 0) return 0;
        _decisions++;

        Span<double> prior = stackalloc double[n];
        Span<double> score = stackalloc double[n];
        for (int i = 0; i < n; i++)
        {
            prior[i] = Math.Tanh(scores[i] / _cfg.HeuristicScale);
            score[i] = prior[i];
        }

        int encoded = 0;
        if (_cfg.NetWeight > 0)
        {
            int size = n * _net.SampleSize;
            if (_batch.Length < size) _batch = new float[size];
            if (_values.Length < n) _values = new float[n];
            for (int i = 0; i < n; i++) enc.Encode(leaves[i], _batch, i * _net.SampleSize);
            _net.ValueInto(_batch, n, _values);
            encoded = n;
            for (int i = 0; i < n; i++) score[i] += _cfg.NetWeight * _values[i];
        }

        int pick = Select(score, n);
        _lastPrior = (float)prior[pick];
        Record(leaves[pick], pick < encoded ? pick : -1);
        return pick;
    }

    private int Select(Span<double> score, int n)
    {
        if (_cfg.Epsilon > 0 && _rng.Uniform() < _cfg.Epsilon) return _rng.NextInt(n);

        if (_cfg.Temperature > 0)
        {
            double max = double.MinValue;
            for (int i = 0; i < n; i++) max = Math.Max(max, score[i]);
            double total = 0;
            Span<double> w = stackalloc double[n];
            for (int i = 0; i < n; i++)
            {
                w[i] = Math.Exp((score[i] - max) / _cfg.Temperature);
                total += w[i];
            }
            double roll = _rng.Uniform() * total;
            for (int i = 0; i < n; i++)
            {
                roll -= w[i];
                if (roll <= 0) return i;
            }
            return n - 1;
        }

        int best = 0;
        for (int i = 1; i < n; i++)
        {
            if (score[i] > score[best]) best = i;
        }
        return best;
    }

    /// <summary>
    /// Stores the end-of-turn position the search settled on, with the search's
    /// own score as the prior the label is measured against. When the network
    /// was consulted the observation is already sitting in the batch and
    /// recording costs a copy; when it was not, which is how a run opens, the
    /// position is encoded here. Play at weight zero is exactly the shipped bot,
    /// and those positions are worth learning from.
    ///
    /// The prior of this turn's pick is also what the previous recorded position
    /// turned into after a full round of play, which is the bootstrapped half of
    /// that position's label.
    /// </summary>
    private void Record(GameState leaf, int slot)
    {
        if (_store is null || _cfg.RecordEvery <= 0) return;
        if (_lastRow >= 0 && !_lastBooted)
        {
            _store.SetBoot(_lastRow, _lastPrior);
            _lastBooted = true;
        }
        if (_cfg.RecordEvery > 1 && _decisions % _cfg.RecordEvery != 0) return;

        if (slot < 0)
        {
            if (_batch.Length < _net.SampleSize) _batch = new float[_net.SampleSize];
            (_enc ?? throw new InvalidOperationException("no game started")).Encode(leaf, _batch, 0);
            slot = 0;
        }
        var span = _batch.AsSpan(slot * _net.SampleSize, _net.SampleSize);
        int enemy = GameState.Other(_me);
        Aux.HandTarget(leaf, enemy, _handTarget);
        float trap = Aux.TrapTarget(leaf, enemy);
        int row = _store.Count;
        if (_firstRow < 0) _firstRow = row;
        _store.Add(span, 0f, _lastPrior, _handTarget, trap);
        _lastRow = row;
        _lastBooted = false;
        _rows++;
    }

    /// <summary>Whatever the network thinks of a position, for reporting and probes.</summary>
    public float ValueOf(GameState state)
    {
        var enc = _enc ?? throw new InvalidOperationException("no game started");
        if (_batch.Length < _net.SampleSize) _batch = new float[_net.SampleSize];
        enc.Encode(state, _batch, 0);
        return _net.Value(_batch, 1)[0];
    }
}
