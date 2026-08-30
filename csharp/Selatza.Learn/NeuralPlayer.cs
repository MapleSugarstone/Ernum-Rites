using Selatza.Ai;
using Selatza.Learn.Nn;

namespace Selatza.Learn;

public sealed class AgentConfig
{
    /// <summary>
    /// How many of the legal actions reach the network. The hand-written
    /// evaluator ranks them all first and the network re-reads the shortlist,
    /// which is the difference between a tournament that runs overnight and one
    /// that runs over a week.
    /// </summary>
    public int TopK { get; set; } = 12;

    /// <summary>
    /// How large a correction the network is allowed to make to the evaluator's
    /// ranking. The network does not score positions on its own: it predicts
    /// how much the evaluator was wrong, and this is the size of the nudge.
    ///
    /// The reason it works this way is that the shortlist handed to the network
    /// is already sorted by the evaluator, and its top few entries are close
    /// together. A network asked to rank them from scratch has to be better than
    /// the evaluator at exactly the comparisons the evaluator finds hardest, and
    /// a network that is merely as good adds noise and picks worse. Predicting
    /// zero, which is what an untrained one does, leaves the ranking alone.
    /// </summary>
    public double NetWeight { get; set; } = 0.35;

    /// <summary>Divisor that puts heuristic scores on the network's [-1, 1] scale.</summary>
    public double HeuristicScale { get; set; } = 200.0;

    /// <summary>Chance of taking a random shortlisted action instead of the best.</summary>
    public double Epsilon { get; set; } = 0.0;

    /// <summary>Softmax spread over shortlisted scores. 0 is a plain argmax.</summary>
    public double Temperature { get; set; } = 0.0;

    /// <summary>Keep one position in this many for training.</summary>
    public int RecordEvery { get; set; } = 2;

    public AgentConfig Clone() => (AgentConfig)MemberwiseClone();
}

/// <summary>
/// One player at the table: the same one-ply search the old bot runs, with the
/// shortlist re-scored by a network that only sees what this side is entitled
/// to see.
/// </summary>
public sealed class NeuralPlayer
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
    private readonly List<GameAction> _acts = new();
    private readonly List<GameState> _succ = new();
    private readonly List<double> _heur = new();
    private readonly List<int> _order = new();

    private SampleStore? _store;
    private float _lastPrior;
    private int _firstRow = -1;
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

    /// <summary>Times this player was asked to act, and how often it had a real choice.</summary>
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
        _rows = 0;
        _decisions = 0;
        intel.Begin(state);
    }

    /// <summary>Labels everything this player recorded with how the game turned out.</summary>
    public void EndGame(float outcome)
    {
        if (_store is not null && _firstRow >= 0) _store.SetValues(_firstRow, _rows, outcome);
    }

    private static GameAction PassAction(GameState state)
    {
        if (state.Pending is not null) return GameAction.PassResponse();
        if (state.FlipQueue.Count > 0) return GameAction.DeclineFlip();
        if (state.ReplaceQueue.Count > 0) return GameAction.DeclineReplace();
        return GameAction.EndTurn();
    }

    /// <summary>
    /// An attack that opens a trap window is judged on the position after the
    /// window closes without a trap, or nothing would ever look worth swinging at.
    /// </summary>
    private static GameState Settle(GameState state)
    {
        if (state.Pending is null) return state;
        var res = Engine.Apply(state, state.Pending.Player, GameAction.PassResponse());
        return res.Ok ? res.State! : state;
    }

    public GameAction Choose(GameState state)
    {
        var enc = _enc ?? throw new InvalidOperationException("no game started");
        DecisionsAsked++;
        _acts.Clear();
        _succ.Clear();
        _heur.Clear();

        var pass = PassAction(state);
        var passRes = Engine.Apply(state, _me, pass);
        if (passRes.Ok)
        {
            // Ending the turn is scored as the position right now, not as the
            // position after the opponent has been handed the turn. Every other
            // candidate is a mid-turn position of your own, and a value function
            // asked to compare across the turn boundary answers the wrong
            // question: an untrained one finds a constant preference for one
            // side of the boundary and then passes, or never passes, forever.
            var baseline = pass.Type == ActionType.EndTurn ? state : Settle(passRes.State!);
            _acts.Add(pass);
            _succ.Add(baseline);
            _heur.Add(Bot.Evaluate(baseline, _me, _weights));
        }

        foreach (var action in Bot.CandidateActions(state, _me))
        {
            var res = Engine.Apply(state, _me, action);
            if (!res.Ok) continue;
            var settled = Settle(res.State!);
            _acts.Add(action);
            _succ.Add(settled);
            _heur.Add(Bot.Evaluate(settled, _me, _weights));
        }

        if (_acts.Count == 0) return pass;
        if (_acts.Count == 1) return _acts[0];

        // Shortlist by the cheap evaluator, always keeping the pass so standing
        // still stays on the table.
        _order.Clear();
        for (int i = 0; i < _acts.Count; i++) _order.Add(i);
        _order.Sort((a, b) => _heur[b].CompareTo(_heur[a]));
        int keep = Math.Min(_cfg.TopK, _order.Count);
        if (passRes.Ok)
        {
            bool passKept = false;
            for (int i = 0; i < keep && !passKept; i++) passKept = _order[i] == 0;
            if (!passKept) _order[keep - 1] = 0;
        }

        Span<double> score = stackalloc double[keep];
        Span<double> prior = stackalloc double[keep];
        for (int i = 0; i < keep; i++)
        {
            prior[i] = Math.Tanh(_heur[_order[i]] / _cfg.HeuristicScale);
            score[i] = prior[i];
        }

        int encoded = 0;
        if (_cfg.NetWeight > 0)
        {
            int size = keep * _net.SampleSize;
            if (_batch.Length < size) _batch = new float[size];
            if (_values.Length < keep) _values = new float[keep];
            for (int i = 0; i < keep; i++) enc.Encode(_succ[_order[i]], _batch, i * _net.SampleSize);
            _net.ValueInto(_batch, keep, _values);
            encoded = keep;
            for (int i = 0; i < keep; i++) score[i] = prior[i] + _cfg.NetWeight * _values[i];
        }

        int bestSlot = Select(score, keep);
        int chosen = _order[bestSlot];
        _lastPrior = (float)prior[bestSlot];
        Record(_succ[chosen], bestSlot < encoded ? bestSlot : -1);

        return _acts[chosen];
    }

    private int Select(Span<double> score, int keep)
    {
        if (_cfg.Epsilon > 0 && _rng.Uniform() < _cfg.Epsilon) return _rng.NextInt(keep);

        if (_cfg.Temperature > 0)
        {
            double max = double.MinValue;
            for (int i = 0; i < keep; i++) max = Math.Max(max, score[i]);
            double total = 0;
            Span<double> w = stackalloc double[keep];
            for (int i = 0; i < keep; i++)
            {
                w[i] = Math.Exp((score[i] - max) / _cfg.Temperature);
                total += w[i];
            }
            double roll = _rng.Uniform() * total;
            for (int i = 0; i < keep; i++)
            {
                roll -= w[i];
                if (roll <= 0) return i;
            }
            return keep - 1;
        }

        int best = 0;
        for (int i = 1; i < keep; i++)
        {
            if (score[i] > score[best]) best = i;
        }
        return best;
    }

    /// <summary>
    /// Stores the position the search settled on. When the network was consulted
    /// the observation is already sitting in the batch and recording costs a
    /// copy; when it was not, which is how a run opens, the position is encoded
    /// here. Play at weight zero is exactly the old bot, and those positions are
    /// worth learning from.
    /// </summary>
    private void Record(GameState settled, int slot)
    {
        if (_store is null || _cfg.RecordEvery <= 0) return;
        _decisions++;
        if (_cfg.RecordEvery > 1 && _decisions % _cfg.RecordEvery != 0) return;

        if (slot < 0)
        {
            if (_batch.Length < _net.SampleSize) _batch = new float[_net.SampleSize];
            (_enc ?? throw new InvalidOperationException("no game started")).Encode(settled, _batch, 0);
            slot = 0;
        }
        var span = _batch.AsSpan(slot * _net.SampleSize, _net.SampleSize);
        int enemy = GameState.Other(_me);
        Aux.HandTarget(settled, enemy, _handTarget);
        float trap = Aux.TrapTarget(settled, enemy);
        if (_firstRow < 0) _firstRow = _store.Count;
        _store.Add(span, 0f, _lastPrior, _handTarget, trap);
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
