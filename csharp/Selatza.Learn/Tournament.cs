using System.Diagnostics;
using Selatza.Cards;
using Selatza.Learn.Nn;

namespace Selatza.Learn;

public sealed class TournamentConfig
{
    public int Agents { get; set; } = 16;

    /// <summary>Networks in the run. Several agents share one, so it sees more games.</summary>
    public int Brains { get; set; } = 4;

    /// <summary>Copies of the shipped one-ply bot, held at 1500 so the ladder has a zero.</summary>
    public int Anchors { get; set; } = 2;

    public int Rounds { get; set; } = 60;
    public int GamesPerPairing { get; set; } = 2;

    /// <summary>Rounds between brain evolution and a checkpoint.</summary>
    public int EvolveEvery { get; set; } = 10;

    /// <summary>Cards a losing deck swaps out at the end of a round.</summary>
    public int MutateOnLoss { get; set; } = 3;

    /// <summary>Weakest agents handed a fresh leader and deck at each checkpoint.</summary>
    public int ReseedWorst { get; set; }

    /// <summary>
    /// Hand out leaders so every colour identity in the pool is represented
    /// before any is repeated. Off, a colour pair with few eligible bodies can
    /// miss the field entirely and its cards read as dead.
    /// </summary>
    public bool SpreadLeaders { get; set; } = true;

    /// <summary>
    /// One agent per card in the leader pool, in order, rather than a sample.
    /// Forces <see cref="Agents"/> to the size of the pool.
    /// </summary>
    public bool EnumerateLeaders { get; set; }

    /// <summary>
    /// An explicit roster of leaders, dealt round robin until Agents is filled,
    /// so a run can put a fixed number of competing decks behind each of a chosen
    /// few. Empty means fall back to the pool.
    /// </summary>
    public List<string> LeaderList { get; set; } = new();

    /// <summary>Rating gap below which a network is left alone instead of reseeded.</summary>
    public double EvolveGap { get; set; } = 60;

    /// <summary>
    /// Size of the correction the network may make, first round to last. The
    /// sweep printed at the end of a run is what says where this should sit: on
    /// the runs so far anything above about 0.35 costs win rate.
    /// </summary>
    public double NetWeightStart { get; set; }

    public double NetWeightEnd { get; set; } = 0.2;
    public double TemperatureStart { get; set; } = 0.05;
    public double TemperatureEnd { get; set; }
    public double Epsilon { get; set; } = 0.02;
    public float PerturbSigma { get; set; } = 0.01f;

    public LeaderPool LeaderPool { get; set; } = LeaderPool.All;
    public DeckShape Deck { get; set; } = DeckShape.Default;
    public IntelConfig Intel { get; set; } = IntelConfig.Default;
    public AgentConfig Agent { get; set; } = new();
    public NetShape Net { get; set; } = NetShape.Default;
    public TrainConfig Train { get; set; } = new();

    public int Threads { get; set; } = Math.Max(1, Environment.ProcessorCount - 1);
    public int Seed { get; set; } = 1;
    public string OutDir { get; set; } = Path.Combine("runs", "latest");
    public int GauntletGames { get; set; } = 40;
    public bool Quiet { get; set; }

    /// <summary>Pick up where a snapshot in the output directory left off.</summary>
    public bool Resume { get; set; } = true;

    /// <summary>Rounds between snapshots. One means a crash costs a single round.</summary>
    public int SnapshotEvery { get; set; } = 1;
}

/// <summary>
/// The run itself: a population of decks and networks that play each other,
/// carry a rating, learn from what happened, and rebuild the parts of their
/// decks that keep losing.
/// </summary>
public sealed class Tournament
{
    private readonly TournamentConfig _cfg;
    private readonly Gauss _rng;
    private readonly List<Brain> _brains = new();
    private readonly List<Agent> _agents = new();
    private readonly List<Agent> _all = new();
    private CardStats _global = new();
    private readonly GameShape _shape = new();
    private int _round;

    public Tournament(TournamentConfig cfg)
    {
        CardIndex.EnsureBuilt();
        _cfg = cfg;
        _rng = new Gauss(cfg.Seed);
        Build();
    }

    public IReadOnlyList<Agent> Agents => _all;
    public IReadOnlyList<Brain> Brains => _brains;

    private void Build()
    {
        for (int i = 0; i < _cfg.Brains; i++)
        {
            var net = new SelatzaNet(_cfg.Net, _cfg.Seed * 1000 + i * 17 + 3);
            var brain = new Brain { Name = $"net{i}", Net = net };
            brain.Optimizer.Lr = _cfg.Train.Lr;
            _brains.Add(brain);
        }

        List<string> leaders;
        if (_cfg.LeaderList.Count > 0)
        {
            leaders = Enumerable.Range(0, _cfg.Agents)
                .Select(i => _cfg.LeaderList[i % _cfg.LeaderList.Count]).ToList();
        }
        else if (_cfg.EnumerateLeaders)
        {
            leaders = DeckGen.LeaderCandidates(_cfg.LeaderPool);
            _cfg.Agents = leaders.Count;
        }
        else if (_cfg.SpreadLeaders)
        {
            leaders = DeckGen.SpreadLeaders(_cfg.LeaderPool, _cfg.Agents, _rng);
        }
        else
        {
            leaders = Enumerable.Range(0, _cfg.Agents)
                .Select(_ => DeckGen.RandomLeader(_cfg.LeaderPool, _rng)).ToList();
        }

        for (int i = 0; i < _cfg.Agents; i++)
        {
            // No networks means the evaluator plays and only the decks evolve,
            // which is five to ten times as many games for the same minute.
            var brain = _brains.Count > 0 ? _brains[i % _brains.Count] : null;
            string leader = leaders[i];
            var deck = DeckGen.Random(leader, _cfg.Deck, _rng);
            var agent = new Agent
            {
                Name = $"a{i:D2}",
                LeaderId = leader,
                Deck = deck,
                Brain = brain,
                Config = _cfg.Agent.Clone(),
                Intel = _cfg.Intel.Clone(),
            };
            _agents.Add(agent);
            _all.Add(agent);
        }

        var starters = CardSets.Starters;
        for (int i = 0; i < _cfg.Anchors; i++)
        {
            var deck = starters[i % starters.Length];
            _all.Add(new Agent
            {
                Name = $"bot{i}",
                LeaderId = deck.LeaderId,
                Deck = deck.Cards.ToList(),
                Brain = null,
                ReferenceBot = true,
                Frozen = true,
                Intel = IntelConfig.Blind,
            });
        }

        int slots = Math.Max(1, _all.Count / 2 + 1);
        foreach (var b in _brains) b.EnsureReplicas(slots, _cfg.Seed * 31 + 7);
    }

    // --- pairing -------------------------------------------------------------

    /// <summary>
    /// Ratings with a shake, then neighbours play. Close pairings make the
    /// ratings informative; the shake stops the same two agents meeting forever.
    /// </summary>
    private List<(int A, int B)> Pair()
    {
        var order = new List<int>();
        for (int i = 0; i < _all.Count; i++) order.Add(i);
        var jitter = new double[_all.Count];
        for (int i = 0; i < _all.Count; i++) jitter[i] = _all[i].Elo + _rng.Next(60f);
        order.Sort((a, b) => jitter[b].CompareTo(jitter[a]));

        var pairs = new List<(int, int)>();
        for (int i = 0; i + 1 < order.Count; i += 2) pairs.Add((order[i], order[i + 1]));
        return pairs;
    }

    // --- one round -----------------------------------------------------------

    private sealed class PairOutcome
    {
        public int A;
        public int B;
        public int WinsA;
        public int WinsB;
        public int Draws;
        public int Turns;
        public readonly List<(int Turns, string? Reason, bool FatigueKill, bool SawFatigue)> Games = new();
        public SampleStore? StoreA;
        public SampleStore? StoreB;
        public string? Error;
    }

    public void RunRound()
    {
        _round++;
        Anneal();
        foreach (var a in _all)
        {
            a.RoundWins = 0;
            a.RoundLosses = 0;
        }

        var pairs = Pair();
        var outcomes = new PairOutcome[pairs.Count];
        var opts = new ParallelOptions { MaxDegreeOfParallelism = _cfg.Threads };

        Parallel.For(0, pairs.Count, opts, p =>
        {
            var (ia, ib) = pairs[p];
            var a = _all[ia];
            var b = _all[ib];
            var res = new PairOutcome { A = ia, B = ib };
            res.StoreA = a.Brain is null ? null : new SampleStore();
            res.StoreB = b.Brain is null ? null : new SampleStore();

            try
            {
                for (int g = 0; g < _cfg.GamesPerPairing; g++)
                {
                    int seed = unchecked(_cfg.Seed * 1_000_003 + _round * 7919 + p * 131 + g * 17);
                    var m = Match.Play(a, b, seed, g % 2, p, res.StoreA, res.StoreB);
                    res.Turns += m.Turns;
                    res.Games.Add((m.Turns, m.Reason, m.FatigueKill, m.SawFatigue));
                    if (m.Winner == 0) res.WinsA++;
                    else if (m.Winner == 1) res.WinsB++;
                    else res.Draws++;
                }
            }
            catch (Exception ex)
            {
                res.Error = ex.Message;
            }
            outcomes[p] = res;
        });

        foreach (var o in outcomes)
        {
            if (o.Error is not null)
            {
                Console.Error.WriteLine($"  round {_round}: {_all[o.A].Name} vs {_all[o.B].Name}: {o.Error}");
                continue;
            }
            var a = _all[o.A];
            var b = _all[o.B];
            foreach (var (turns, reason, kill, seen) in o.Games)
            {
                _shape.Add(turns, reason, reason is not null, kill, seen);
            }
            for (int i = 0; i < o.WinsA; i++) Score(a, b, 1);
            for (int i = 0; i < o.WinsB; i++) Score(a, b, 0);
            for (int i = 0; i < o.Draws; i++) Score(a, b, 0.5);
            if (o.StoreA is not null && a.Brain is not null) a.Brain.Store.Merge(o.StoreA);
            if (o.StoreB is not null && b.Brain is not null) b.Brain.Store.Merge(o.StoreB);
        }

        if (_cfg.Train.StepsPerRound > 0)
        {
            foreach (var brain in _brains)
            {
                while (brain.Store.Count > _cfg.Train.ReplayCap) brain.Store.HalveOldest();
                Trainer.Train(brain, _cfg.Train, _rng, _cfg.Threads);
                brain.RefreshReplicas();
            }
        }

        RebuildGlobalStats();
        MutateLosers();
        AppendCensus();
    }

    /// <summary>One game's worth of rating movement, from A's point of view.</summary>
    private void Score(Agent a, Agent b, double scoreA)
    {
        double ra = a.Elo, rb = b.Elo;
        double surprise = scoreA - Elo.Expected(ra, rb);
        a.SurpriseSum += surprise;
        a.SurpriseSq += surprise * surprise;
        b.SurpriseSum -= surprise;
        b.SurpriseSq += surprise * surprise;
        if (!a.Frozen) a.Elo = Elo.Update(ra, rb, scoreA, a.Games);
        if (!b.Frozen) b.Elo = Elo.Update(rb, ra, 1 - scoreA, b.Games);

        a.Games++;
        b.Games++;
        if (scoreA == 1)
        {
            a.Wins++;
            b.Losses++;
            a.RoundWins++;
            b.RoundLosses++;
        }
        else if (scoreA == 0)
        {
            b.Wins++;
            a.Losses++;
            b.RoundWins++;
            a.RoundLosses++;
        }
        else
        {
            a.Draws++;
            b.Draws++;
        }

        // A network is rated against the network across the table, or against the
        // reference bot's fixed rating when that is who it played.
        double bra = a.Brain?.Elo ?? ra;
        double brb = b.Brain?.Elo ?? rb;
        if (a.Brain is not null)
        {
            a.Brain.Elo = Elo.Update(bra, brb, scoreA, a.Brain.Games);
            a.Brain.Games++;
            if (scoreA == 1) a.Brain.Wins++;
            else if (scoreA == 0.5) a.Brain.Draws++;
        }
        if (b.Brain is not null)
        {
            b.Brain.Elo = Elo.Update(brb, bra, 1 - scoreA, b.Brain.Games);
            b.Brain.Games++;
            if (scoreA == 0) b.Brain.Wins++;
            else if (scoreA == 0.5) b.Brain.Draws++;
        }
    }

    private void Anneal()
    {
        double t = _cfg.Rounds <= 1 ? 1 : Math.Min(1.0, (_round - 1) / (double)Math.Max(1, _cfg.Rounds - 1));
        double net = _cfg.NetWeightStart + (_cfg.NetWeightEnd - _cfg.NetWeightStart) * t;
        double temp = _cfg.TemperatureStart + (_cfg.TemperatureEnd - _cfg.TemperatureStart) * t;
        foreach (var a in _agents)
        {
            a.Config.NetWeight = net;
            a.Config.Temperature = temp;
            a.Config.Epsilon = _cfg.Epsilon * (1 - t);
        }
    }

    private void RebuildGlobalStats()
    {
        var g = new CardStats();
        foreach (var a in _agents) g.Merge(a.Stats);
        _global = g;
    }

    /// <summary>Copies of each card held across the population right now.</summary>
    public (int[] Copies, int[] Decks) Census()
    {
        var copies = new int[CardIndex.Count];
        var decks = new int[CardIndex.Count];
        foreach (var a in _agents)
        {
            var seen = new HashSet<int>();
            foreach (var id in a.Deck)
            {
                int c = CardIndex.Of(id);
                if (c < 0) continue;
                copies[c]++;
                seen.Add(c);
            }
            foreach (int c in seen) decks[c]++;
        }
        return (copies, decks);
    }

    /// <summary>
    /// One row per card per round, appended rather than rewritten, so a run that
    /// resumes keeps its history. This is the file that answers what a buff did:
    /// a card the population is selecting for climbs, and one it is cutting
    /// falls, without anybody having to interpret a win rate.
    /// </summary>
    private void AppendCensus()
    {
        var path = Path.Combine(_cfg.OutDir, "meta.csv");
        Directory.CreateDirectory(_cfg.OutDir);
        bool fresh = !File.Exists(path);
        var (copies, decks) = Census();
        using var w = new StreamWriter(path, append: true);
        if (fresh) w.WriteLine("round,card,name,colour,type,copies,decks,plays,lift");
        for (int c = 0; c < copies.Length; c++)
        {
            if (copies[c] == 0 && _global.Plays(c) == 0) continue;
            var d = CardIndex.Def(c);
            string colour = Colors.Letter(d.Color) + (d.Color2 is { } c2 ? Colors.Letter(c2) : "");
            w.WriteLine($"{_round},{d.Id},\"{d.Name}\",{colour},{d.Type},{copies[c]},{decks[c]},"
                + $"{_global.Plays(c)},{_global.Lift(c):0.0000}");
        }
    }

    private void MutateLosers()
    {
        if (_cfg.MutateOnLoss <= 0) return;
        int totalPlays = _global.TotalPlays;
        foreach (var a in _agents)
        {
            if (a.Frozen) continue;
            if (a.RoundLosses <= a.RoundWins) continue;
            int swaps = Math.Min(_cfg.MutateOnLoss * (a.RoundLosses - a.RoundWins), a.Deck.Count / 4);
            a.Deck = DeckGen.Mutate(a.LeaderId, a.Deck, swaps,
                card => a.Stats.Score(card),
                card => _global.GlobalScore(card, totalPlays),
                _rng);
            a.Mutations += swaps;
        }
    }

    /// <summary>
    /// The bottom network takes the top one's weights and a shake. Gradients
    /// alone cannot escape a bad basin; this is the part of the run that can.
    /// </summary>
    public void Evolve()
    {
        if (_brains.Count < 2) return;
        var ranked = _brains.OrderByDescending(b => b.Elo).ToList();
        var best = ranked[0];
        var worst = ranked[^1];
        if (ReferenceEquals(best, worst)) return;
        if (worst.Elo >= best.Elo - _cfg.EvolveGap) return;

        worst.Net.CopyWeightsFrom(best.Net);
        worst.Net.Perturb(_cfg.PerturbSigma, _rng);
        // The weights just moved discontinuously, so Adam's running estimates
        // describe a network that no longer exists.
        foreach (var p in worst.Net.Parameters)
        {
            Array.Clear(p.M);
            Array.Clear(p.V);
        }
        worst.Optimizer.Steps = 0;
        worst.RefreshReplicas();
        worst.Elo = (worst.Elo + best.Elo) / 2;
        if (!_cfg.Quiet) Console.WriteLine($"  {worst.Name} reseeded from {best.Name}");
    }

    private void Reseed()
    {
        if (_cfg.ReseedWorst <= 0) return;
        var worst = _agents.Where(a => !a.Frozen).OrderBy(a => a.Elo).Take(_cfg.ReseedWorst).ToList();
        foreach (var a in worst)
        {
            string leader = DeckGen.RandomLeader(_cfg.LeaderPool, _rng);
            int totalPlays = _global.TotalPlays;
            var prior = new double[CardIndex.Count];
            for (int c = 0; c < prior.Length; c++)
            {
                prior[c] = Math.Max(0.05, 1 + _global.GlobalScore(c, totalPlays));
            }
            var fresh = new Agent
            {
                Name = a.Name,
                LeaderId = leader,
                Deck = DeckGen.Random(leader, _cfg.Deck, _rng, prior),
                Brain = a.Brain,
                Config = a.Config,
                Intel = a.Intel,
                Elo = Math.Max(Elo.Start - 100, a.Elo),
            };
            int ai = _agents.IndexOf(a);
            int alli = _all.IndexOf(a);
            _agents[ai] = fresh;
            _all[alli] = fresh;
            if (!_cfg.Quiet) Console.WriteLine($"  {a.Name} reseeded onto {fresh.LeaderName}");
        }
    }

    // --- running -------------------------------------------------------------

    private volatile bool _stopping;

    public void Run()
    {
        var sw = Stopwatch.StartNew();
        Directory.CreateDirectory(_cfg.OutDir);

        if (_cfg.Resume && Snapshot.Exists(_cfg.OutDir))
        {
            int at = TryResume();
            if (at > 0 && !_cfg.Quiet) Console.WriteLine($"resumed from round {at} in {_cfg.OutDir}");
        }

        ConsoleCancelEventHandler onCancel = (_, e) =>
        {
            if (_stopping) return;
            e.Cancel = true;
            _stopping = true;
            Console.WriteLine();
            Console.WriteLine("  stopping after this round, snapshot will be written");
        };
        Console.CancelKeyPress += onCancel;

        if (!_cfg.Quiet)
        {
            if (_brains.Count == 0)
            {
                Console.WriteLine($"{_cfg.Agents} agents, {_cfg.Anchors} anchors, no networks: "
                    + "the evaluator plays and the decks do the learning");
            }
            else
            {
                Console.WriteLine($"{_cfg.Agents} agents over {_brains.Count} networks "
                    + $"({_brains[0].Net.ParameterCount:N0} weights each), {_cfg.Anchors} anchors");
                Console.WriteLine($"observation {_brains[0].Net.SampleSize:N0} floats, "
                    + $"{CardIndex.Count} cards, intel: {_cfg.Intel}");
            }
            Console.WriteLine();
        }

        try
        {
            while (_round < _cfg.Rounds && !_stopping)
            {
                var t0 = sw.ElapsedMilliseconds;
                RunRound();
                if (!_cfg.Quiet)
                {
                    var best = _all.OrderByDescending(a => a.Elo).First();
                    var brain = _brains.OrderByDescending(b => b.Elo).FirstOrDefault();
                    Console.WriteLine($"round {_round,3}  {sw.ElapsedMilliseconds - t0,5} ms  "
                        + $"top {best.Name} {best.Elo,6:0} on {best.LeaderName}"
                        + (brain is null
                            ? $"  {_shape.Games} games  {_shape.Mean:0.0} turns"
                            : $"  {brain.Name} {brain.Elo,6:0}  loss {brain.LastLoss:0.0000}"
                              + $"  positions {brain.Store.Count,6}"));
                }
                if (_cfg.EvolveEvery > 0 && _round % _cfg.EvolveEvery == 0)
                {
                    Evolve();
                    Reseed();
                    Checkpoint();
                }
                if (_cfg.SnapshotEvery > 0 && _round % _cfg.SnapshotEvery == 0) SaveSnapshot();
            }
        }
        finally
        {
            Console.CancelKeyPress -= onCancel;
            SaveSnapshot();
            Checkpoint();
        }

        if (!_cfg.Quiet)
        {
            Console.WriteLine();
            Console.WriteLine(Report());
            Console.WriteLine($"{(_stopping ? "stopped" : "finished")} at round {_round} "
                + $"in {sw.ElapsedMilliseconds / 1000.0:0.0} s");
        }
    }

    /// <summary>
    /// Best agent against the shipped bot, which is the number that matters.
    ///
    /// Every game here uses the same agent, so unlike a round of the tournament
    /// it cannot take its replica slot from the game index: two games would
    /// share one network's buffers. Slots are leased instead, and each game gets
    /// a throwaway copy of the agent so the per-card records are not written
    /// from several threads at once.
    /// </summary>
    public (int Wins, int Losses, int Draws) Gauntlet(Agent agent, int games, int seed = 0)
    {
        var starters = CardSets.Starters;
        int wins = 0, losses = 0, draws = 0;
        int threads = Math.Max(1, _cfg.Threads);
        agent.Brain?.EnsureReplicas(threads, seed + 31);

        var free = new System.Collections.Concurrent.ConcurrentBag<int>();
        for (int i = 0; i < threads; i++) free.Add(i);

        var opts = new ParallelOptions { MaxDegreeOfParallelism = threads };
        var results = new int[games];
        Parallel.For(0, games, opts, g =>
        {
            var deck = starters[g % starters.Length];
            var foe = new Agent
            {
                Name = "gauntlet-bot",
                LeaderId = deck.LeaderId,
                Deck = deck.Cards.ToList(),
                ReferenceBot = true,
                Frozen = true,
                Intel = IntelConfig.Blind,
            };
            var solo = new Agent
            {
                Name = agent.Name,
                LeaderId = agent.LeaderId,
                Deck = agent.Deck,
                Brain = agent.Brain,
                Config = agent.Config,
                Intel = agent.Intel,
                ReferenceBot = agent.ReferenceBot,
            };
            if (!free.TryTake(out int slot)) slot = 0;
            try
            {
                var m = Match.Play(solo, foe, unchecked(seed + g * 104729 + 7), g % 2, slot);
                results[g] = m.Winner;
            }
            finally
            {
                free.Add(slot);
            }
        });
        foreach (int w in results)
        {
            if (w == 0) wins++;
            else if (w == 1) losses++;
            else draws++;
        }
        return (wins, losses, draws);
    }

    public string Report()
    {
        var sb = new System.Text.StringBuilder();
        sb.AppendLine("  rating  agent  brain  leader                         W-L-D        rate  swaps");
        foreach (var a in _all.OrderByDescending(x => x.Elo))
        {
            string leader = $"{a.LeaderName} ({a.Colors})";
            if (leader.Length > 28) leader = leader[..28];
            sb.AppendLine($"  {a.Elo,6:0}  {a.Name,-5}  {a.Brain?.Name ?? "--",-5}  {leader,-28} "
                + $"{a.Wins,3}-{a.Losses,3}-{a.Draws,-3}  {a.WinRate,5:P0}  {a.Mutations,5}");
        }
        sb.AppendLine();
        foreach (var b in _brains.OrderByDescending(x => x.Elo))
        {
            sb.AppendLine($"  {b.Elo,6:0}  {b.Name,-5}  {b.Games,5} games  {b.WinRate,5:P0}  "
                + $"{b.TrainedSteps,6} steps  loss {b.LastLoss:0.0000}");
        }
        return sb.ToString();
    }

    // --- snapshots -----------------------------------------------------------

    /// <summary>
    /// Everything needed to pick the run back up: weights, optimiser moments,
    /// ratings, decks, per-card records and the RNG stream. Written after every
    /// round so a crash costs one round rather than the whole run.
    /// </summary>
    public void SaveSnapshot()
    {
        Snapshot.Write(_cfg.OutDir, w =>
        {
            w.Write(_round);
            w.Write(_brains.Count);
            w.Write(_all.Count);
            w.Write(CardIndex.Count);

            var (rngState, spare, hasSpare) = _rng.Capture();
            w.Write(rngState);
            w.Write(spare);
            w.Write(hasSpare);

            foreach (var b in _brains)
            {
                w.Write(b.Name);
                w.Write(b.Elo);
                w.Write(b.Games);
                w.Write(b.Wins);
                w.Write(b.Draws);
                w.Write(b.TrainedSteps);
                w.Write(b.LastLoss);
                w.Write(b.Optimizer.Lr);
                w.Write(b.Optimizer.Steps);
                Snapshot.SaveParams(w, b.Net, moments: true);
            }

            foreach (var a in _all)
            {
                w.Write(a.Name);
                w.Write(a.LeaderId);
                w.Write(a.Deck.Count);
                foreach (var id in a.Deck) w.Write(id);
                w.Write(a.Elo);
                w.Write(a.Games);
                w.Write(a.Wins);
                w.Write(a.Losses);
                w.Write(a.Draws);
                w.Write(a.Mutations);
                w.Write(a.SurpriseSum);
                w.Write(a.SurpriseSq);
                w.Write(a.ReferenceBot);
                w.Write(_brains.IndexOf(a.Brain!));
                a.Stats.Save(w);
            }
        });
    }

    /// <summary>
    /// Rebuilds the run from the snapshot in the output directory. Returns the
    /// round it resumed at, or 0 when there was nothing to resume.
    /// </summary>
    public int TryResume()
    {
        int resumed = 0;
        Snapshot.Read(_cfg.OutDir, r =>
        {
            int round = r.ReadInt32();
            int brains = r.ReadInt32();
            int agents = r.ReadInt32();
            int cards = r.ReadInt32();
            if (brains != _brains.Count || agents != _all.Count || cards != CardIndex.Count)
            {
                Console.Error.WriteLine($"  snapshot is {brains} networks, {agents} agents, {cards} cards; "
                    + $"this run wants {_brains.Count}, {_all.Count}, {CardIndex.Count}. Starting fresh.");
                return false;
            }

            _rng.Restore(r.ReadInt32(), r.ReadDouble(), r.ReadBoolean());

            foreach (var b in _brains)
            {
                _ = r.ReadString();
                b.Elo = r.ReadDouble();
                b.Games = r.ReadInt32();
                b.Wins = r.ReadInt32();
                b.Draws = r.ReadInt32();
                b.TrainedSteps = r.ReadInt32();
                b.LastLoss = r.ReadDouble();
                b.Optimizer.Lr = r.ReadSingle();
                b.Optimizer.Steps = r.ReadInt32();
                Snapshot.LoadParams(r, b.Net, moments: true);
                b.RefreshReplicas();
            }

            for (int i = 0; i < _all.Count; i++)
            {
                string name = r.ReadString();
                string leader = r.ReadString();
                int n = r.ReadInt32();
                var deck = new List<string>(n);
                for (int k = 0; k < n; k++) deck.Add(r.ReadString());
                double elo = r.ReadDouble();
                int games = r.ReadInt32(), wins = r.ReadInt32(), losses = r.ReadInt32();
                int draws = r.ReadInt32(), mutations = r.ReadInt32();
                double surpriseSum = r.ReadDouble(), surpriseSq = r.ReadDouble();
                bool reference = r.ReadBoolean();
                int brainIndex = r.ReadInt32();

                var template = _all[i];
                var restored = new Agent
                {
                    Name = name,
                    LeaderId = leader,
                    Deck = deck,
                    Brain = brainIndex >= 0 ? _brains[brainIndex] : null,
                    Config = template.Config,
                    Intel = template.Intel,
                    ReferenceBot = reference,
                    Frozen = reference,
                    Elo = elo,
                    Games = games,
                    Wins = wins,
                    Losses = losses,
                    Draws = draws,
                    Mutations = mutations,
                    SurpriseSum = surpriseSum,
                    SurpriseSq = surpriseSq,
                };
                restored.Stats.Load(r);
                int ai = _agents.IndexOf(template);
                if (ai >= 0) _agents[ai] = restored;
                _all[i] = restored;
            }

            _round = round;
            resumed = round;
            return true;
        });
        if (resumed > 0) RebuildGlobalStats();
        return resumed;
    }

    public void Checkpoint()
    {
        Directory.CreateDirectory(_cfg.OutDir);
        foreach (var b in _brains) b.Net.Save(Path.Combine(_cfg.OutDir, $"{b.Name}.snn"));
        File.WriteAllText(Path.Combine(_cfg.OutDir, "ladder.json"), Json());
        File.WriteAllText(Path.Combine(_cfg.OutDir, "report.txt"), Report());
        var best = _all.OrderByDescending(a => a.Elo).First();
        File.WriteAllText(Path.Combine(_cfg.OutDir, "best-deck.txt"), DeckText(best));
        File.WriteAllText(Path.Combine(_cfg.OutDir, "cards.txt"), CardReport());
        File.WriteAllText(Path.Combine(_cfg.OutDir, "cards.csv"), CardCsv());
        File.WriteAllText(Path.Combine(_cfg.OutDir, "decks.txt"), AllDecks());
        File.WriteAllText(Path.Combine(_cfg.OutDir, "timing.txt"), TimingReport());
        File.WriteAllText(Path.Combine(_cfg.OutDir, "timing.csv"), TimingCsv());
        File.WriteAllText(Path.Combine(_cfg.OutDir, "swing.txt"), SwingReport());
        File.WriteAllText(Path.Combine(_cfg.OutDir, "volatility.txt"), VolatilityReport());
        File.WriteAllText(Path.Combine(_cfg.OutDir, "archetypes.txt"), ArchetypeReport());
    }

    // --- the timing report ---------------------------------------------------

    /// <summary>
    /// The same lift the card table uses, split by when the card left its
    /// owner's hand. A card whose opening lift beats its late lift wants to be
    /// played on curve; the reverse is a card worth holding.
    /// </summary>
    public string TimingReport(int minPlays = 40, int minBucket = 15, int show = 18)
    {
        var sb = new System.Text.StringBuilder();
        sb.AppendLine($"Lift by when the card was played, after {_shape.Games} games.");
        sb.AppendLine();
        sb.AppendLine("Buckets count the owner's own turns: most games give each player four to");
        sb.AppendLine("six of them. Lift is result minus rating expectation, shrunk toward zero");
        sb.AppendLine($"below {CardStats.Shrink:0} plays. A row needs {minPlays} plays overall and "
            + $"{minBucket} in both the");
        sb.AppendLine("opening and late buckets before its timing spread is trusted.");
        sb.AppendLine();

        var rows = new List<(int Card, double Spread)>();
        for (int c = 0; c < CardIndex.Count; c++)
        {
            if (_global.Plays(c) < minPlays) continue;
            if (_global.BucketPlays(0, c) < minBucket || _global.BucketPlays(2, c) < minBucket) continue;
            rows.Add((c, _global.BucketLift(0, c) - _global.BucketLift(2, c)));
        }

        void Table(string title, IEnumerable<(int Card, double Spread)> list)
        {
            sb.AppendLine(title);
            sb.AppendLine("   early    mid   late   plays (e/m/l)   card");
            foreach (var (c, _) in list)
            {
                var d = CardIndex.Def(c);
                sb.AppendLine($"  {_global.BucketLift(0, c),6:+0.000;-0.000} "
                    + $"{_global.BucketLift(1, c),6:+0.000;-0.000} "
                    + $"{_global.BucketLift(2, c),6:+0.000;-0.000}   "
                    + $"{_global.BucketPlays(0, c),4}/{_global.BucketPlays(1, c),4}/{_global.BucketPlays(2, c),4}    "
                    + $"{d.Name,-24} {Colors.Letter(d.Color)}{(d.Color2 is { } c2 ? Colors.Letter(c2) : " ")} "
                    + $"{d.Type,-6} L{d.Level}");
            }
            sb.AppendLine();
        }

        Table("Best played early (opening lift beats late lift by the most):",
            rows.OrderByDescending(r => r.Spread).Take(show));
        Table("Best held for the late game:",
            rows.OrderBy(r => r.Spread).Take(show));
        return sb.ToString();
    }

    /// <summary>One row per card with its per-bucket plays and lift, for spreadsheets.</summary>
    public string TimingCsv()
    {
        var sb = new System.Text.StringBuilder();
        sb.AppendLine("card,name,colour,type,level,plays,"
            + "plays_early,lift_early,plays_mid,lift_mid,plays_late,lift_late");
        for (int c = 0; c < CardIndex.Count; c++)
        {
            var d = CardIndex.Def(c);
            if (d.Art is null || _global.Plays(c) == 0) continue;
            string colour = Colors.Letter(d.Color) + (d.Color2 is { } c2 ? Colors.Letter(c2) : "");
            sb.Append($"{d.Id},\"{d.Name}\",{colour},{d.Type},{d.Level},{_global.Plays(c)}");
            for (int b = 0; b < CardStats.Buckets; b++)
            {
                sb.Append($",{_global.BucketPlays(b, c)},{_global.BucketLift(b, c):0.0000}");
            }
            sb.AppendLine();
        }
        return sb.ToString();
    }

    // --- the swing report ----------------------------------------------------

    /// <summary>
    /// Swing is the spread of a card's per-game lift, not its average: a swingy
    /// card decides games in both directions, a steady one nudges them.
    /// </summary>
    public string SwingReport(int minPlays = 40, int show = 20)
    {
        var rows = new List<int>();
        for (int c = 0; c < CardIndex.Count; c++)
        {
            if (_global.Plays(c) >= minPlays) rows.Add(c);
        }

        var sb = new System.Text.StringBuilder();
        sb.AppendLine($"Swing after {_shape.Games} games: the standard deviation of each card's");
        sb.AppendLine("per-game lift. High swing with positive lift is a finisher that sometimes");
        sb.AppendLine("backfires; high swing near zero lift is a coin flip; low swing is a card");
        sb.AppendLine($"whose games go as the ratings expected. Rows need {minPlays} plays.");
        sb.AppendLine();

        void Table(string title, IEnumerable<int> list)
        {
            sb.AppendLine(title);
            sb.AppendLine("   swing    lift  plays  card");
            foreach (int c in list)
            {
                var d = CardIndex.Def(c);
                sb.AppendLine($"  {_global.Swing(c),6:0.000}  {_global.Lift(c),6:+0.000;-0.000}  "
                    + $"{_global.Plays(c),5}  {d.Name,-24} "
                    + $"{Colors.Letter(d.Color)}{(d.Color2 is { } c2 ? Colors.Letter(c2) : " ")} "
                    + $"{d.Type,-6} L{d.Level}");
            }
            sb.AppendLine();
        }

        Table("Swingiest cards:", rows.OrderByDescending(c => _global.Swing(c)).Take(show));
        Table("Steadiest cards:", rows.OrderBy(c => _global.Swing(c)).Take(show));
        return sb.ToString();
    }

    // --- the deck volatility report ------------------------------------------

    public string VolatilityReport(int minGames = 60, int show = 25)
    {
        var pool = _all.Where(a => !a.ReferenceBot && a.Games >= minGames).ToList();
        var sb = new System.Text.StringBuilder();
        sb.AppendLine("Deck volatility: the standard deviation of (result - expected result) over");
        sb.AppendLine("every game the deck played. Around 0.40 is a deck whose games are near coin");
        sb.AppendLine("flips even against rating-matched opponents; well under that is a deck that");
        sb.AppendLine("reliably beats who it should and loses to who it should.");
        sb.AppendLine();

        void Table(string title, IEnumerable<Agent> list)
        {
            sb.AppendLine(title);
            sb.AppendLine("   vol   rating  games  leader");
            foreach (var a in list)
            {
                sb.AppendLine($"  {a.Volatility,5:0.000}  {a.Elo,6:0}  {a.Games,5}  "
                    + $"{a.LeaderName} ({a.Colors})");
            }
            sb.AppendLine();
        }

        Table("Most volatile decks:", pool.OrderByDescending(a => a.Volatility).Take(show));
        Table("Steadiest decks:", pool.OrderBy(a => a.Volatility).Take(show));
        return sb.ToString();
    }

    // --- the archetype report ------------------------------------------------

    /// <summary>
    /// Groups the population's decks by what they actually run. Two decks land
    /// in one archetype when the cosine similarity of their card counts clears
    /// the threshold against the group's running average.
    /// </summary>
    public string ArchetypeReport(double threshold = 0.55, int show = 10)
    {
        var pool = _all.Where(a => !a.ReferenceBot).OrderByDescending(a => a.Elo).ToList();
        int n = CardIndex.Count;

        double[] VectorOf(Agent a)
        {
            var v = new double[n];
            foreach (var id in a.Deck)
            {
                int c = CardIndex.Of(id);
                if (c >= 0) v[c]++;
            }
            return v;
        }

        static double Cosine(double[] x, double[] y)
        {
            double dot = 0, nx = 0, ny = 0;
            for (int i = 0; i < x.Length; i++)
            {
                dot += x[i] * y[i];
                nx += x[i] * x[i];
                ny += y[i] * y[i];
            }
            return nx <= 0 || ny <= 0 ? 0 : dot / Math.Sqrt(nx * ny);
        }

        var clusters = new List<(List<Agent> Members, double[] Sum)>();
        foreach (var a in pool)
        {
            var v = VectorOf(a);
            int bestAt = -1;
            double bestSim = 0;
            for (int k = 0; k < clusters.Count; k++)
            {
                var centroid = new double[n];
                for (int i = 0; i < n; i++) centroid[i] = clusters[k].Sum[i] / clusters[k].Members.Count;
                double sim = Cosine(v, centroid);
                if (sim > bestSim)
                {
                    bestSim = sim;
                    bestAt = k;
                }
            }
            if (bestAt >= 0 && bestSim >= threshold)
            {
                clusters[bestAt].Members.Add(a);
                for (int i = 0; i < n; i++) clusters[bestAt].Sum[i] += v[i];
            }
            else
            {
                clusters.Add((new List<Agent> { a }, v));
            }
        }

        // The population's average deck, for finding what defines a cluster
        // rather than what everyone runs.
        var global = new double[n];
        foreach (var a in pool)
        {
            var v = VectorOf(a);
            for (int i = 0; i < n; i++) global[i] += v[i] / pool.Count;
        }

        var sb = new System.Text.StringBuilder();
        sb.AppendLine($"{clusters.Count} archetypes across {pool.Count} decks, cosine threshold "
            + $"{threshold:0.00}. Decks joined the best-fitting group in rating order, so each");
        sb.AppendLine("archetype formed around its strongest deck. Defining cards are the ones");
        sb.AppendLine("this group runs far more of than the population does.");
        sb.AppendLine();

        int label = 0;
        foreach (var (members, sum) in clusters.OrderByDescending(c => c.Members.Average(m => m.Elo)))
        {
            label++;
            var defining = new List<(int Card, double Excess)>();
            for (int i = 0; i < n; i++)
            {
                double mean = sum[i] / members.Count;
                if (mean > 0) defining.Add((i, mean - global[i]));
            }
            var top = defining.OrderByDescending(d => d.Excess).Take(show).ToList();
            var identities = members.Select(m => m.Colors).Distinct().OrderBy(s => s).ToList();

            sb.AppendLine($"Archetype {label}: {members.Count} deck(s), colours "
                + $"{string.Join("/", identities.Select(i => i.Length == 0 ? "neutral" : i))}, "
                + $"mean rating {members.Average(m => m.Elo):0}");
            sb.AppendLine("  defining cards: " + string.Join(", ", top.Select(t =>
                $"{CardIndex.Def(t.Card).Name} ({sum[t.Card] / members.Count:0.0}x)")));
            foreach (var m in members.OrderByDescending(x => x.Elo).Take(6))
            {
                sb.AppendLine($"    {m.Elo,6:0}  {m.LeaderName} ({(m.Colors.Length == 0 ? "neutral" : m.Colors)})  "
                    + $"{m.Wins}-{m.Losses}-{m.Draws}  vol {m.Volatility:0.00}");
            }
            if (members.Count > 6) sb.AppendLine($"    ... and {members.Count - 6} more");
            sb.AppendLine();
        }
        return sb.ToString();
    }

    /// <summary>
    /// Every deck in the population, best first. These are the strategies the
    /// run found: each one is a leader the agent was stuck with and forty-eight
    /// cards it kept rebuilding around that leader for as long as it kept losing.
    /// Each is loadable by `matchup --a`.
    /// </summary>
    public string AllDecks()
    {
        var sb = new System.Text.StringBuilder();
        sb.AppendLine($"{_agents.Count} decks after {_round} rounds, best first.");
        sb.AppendLine("Any of these can be replayed with: matchup --a <this file split out> ...");
        sb.AppendLine();
        foreach (var a in _all.Where(x => !x.ReferenceBot).OrderByDescending(x => x.Elo))
        {
            sb.AppendLine("--------------------------------------------------------------");
            sb.Append(DeckText(a));
            sb.AppendLine();
        }
        return sb.ToString();
    }

    public GameShape Shape => _shape;

    /// <summary>
    /// Machine-readable, one row per card, for diffing one run against the next.
    /// </summary>
    public string CardCsv()
    {
        var (copies, decks) = Census();
        var sb = new System.Text.StringBuilder();
        sb.AppendLine("card,name,colour,type,level,rarity,plays,lift,avg_turns,dead_rate,copies,decks");
        for (int c = 0; c < CardIndex.Count; c++)
        {
            var d = CardIndex.Def(c);
            if (d.Art is null) continue;
            string colour = Colors.Letter(d.Color) + (d.Color2 is { } c2 ? Colors.Letter(c2) : "");
            sb.AppendLine($"{d.Id},\"{d.Name}\",{colour},{d.Type},{d.Level},{d.Rarity},"
                + $"{_global.Plays(c)},{_global.Lift(c):0.0000},{_global.AverageTurns(c):0.00},"
                + $"{_global.DeadRate(c):0.000},{copies[c]},{decks[c]}");
        }
        return sb.ToString();
    }

    /// <summary>
    /// What the population decided about the set. Decks are rebuilt from losses,
    /// so after enough rounds the cards holding the most slots are the ones that
    /// kept being worth one.
    /// </summary>
    public string CardReport(int minPlays = 25, int show = 20)
    {
        int total = _global.TotalPlays;
        var (copies, decks) = Census();
        var rows = new List<int>();
        for (int c = 0; c < CardIndex.Count; c++)
        {
            if (_global.Plays(c) >= minPlays) rows.Add(c);
        }
        double medianTurns = _shape.Median;

        var sb = new System.Text.StringBuilder();
        sb.AppendLine($"After {_round} rounds and {_shape.Games} games, {total} cards played.");
        sb.AppendLine();
        sb.AppendLine("Lift is the result of a game the card was played in minus the result the");
        sb.AppendLine("ratings expected beforehand, averaged and pulled towards zero until there is");
        sb.AppendLine("enough evidence. It takes the deck and the opponent out of the number, which");
        sb.AppendLine("a plain win rate cannot. It is still not an experiment: to settle a card, use");
        sb.AppendLine("`matchup --swap`, which plays one deck against the same deck with that card");
        sb.AppendLine($"changed. Rows below need {minPlays} plays to appear.");
        sb.AppendLine();

        void Table(string title, IEnumerable<int> list)
        {
            sb.AppendLine(title);
            sb.AppendLine("    lift  plays  copies  turns  card");
            foreach (int c in list)
            {
                var d = CardIndex.Def(c);
                sb.AppendLine($"  {_global.Lift(c),6:+0.000;-0.000}  {_global.Plays(c),5}  "
                    + $"{copies[c],4} in {decks[c],2}  {_global.AverageTurns(c),5:0.0}  "
                    + $"{d.Name,-24} {Colors.Letter(d.Color)}{(d.Color2 is { } c2 ? Colors.Letter(c2) : " ")} "
                    + $"{d.Type,-6} L{d.Level} {d.Rarity}");
            }
            sb.AppendLine();
        }

        Table("Pulling their weight:", rows.OrderByDescending(c => _global.Lift(c)).Take(show));
        Table("Not pulling their weight:", rows.OrderBy(c => _global.Lift(c)).Take(show));
        Table("Holding the most deck slots:", rows.OrderByDescending(c => copies[c]).Take(show));

        // A card that keeps turning up in games that end early is the shape a
        // problem card has, whether or not its win rate looks unusual.
        var fast = rows.Where(c => _global.Plays(c) >= minPlays * 2)
            .OrderBy(c => _global.AverageTurns(c)).Take(show).ToList();
        sb.AppendLine($"Games are {_shape.Mean:0.0} turns on average, {medianTurns:0} median, "
            + $"{_shape.ShareUnder(8):P0} under 8 turns.");
        Table("Turning up in the shortest games:", fast);

        var never = new List<int>();
        for (int c = 0; c < CardIndex.Count; c++)
        {
            var d = CardIndex.Def(c);
            if (d.Art is null) continue;
            if (_global.Plays(c) == 0 && copies[c] == 0) never.Add(c);
        }
        sb.AppendLine($"Never played and in nobody's deck: {never.Count} of "
            + $"{CardIndex.Defs.Count(d => d.Art is not null)} cards.");
        sb.AppendLine("  " + string.Join(", ", never.Take(40).Select(c => CardIndex.Def(c).Name)));
        sb.AppendLine("  A card here was either never dealt into a legal pool or was cut every");
        sb.AppendLine("  time it was tried. Which one it is shows in meta.csv.");
        sb.AppendLine();

        sb.AppendLine("How games ended:");
        foreach (var (reason, count) in _shape.Reasons)
        {
            sb.AppendLine($"  {count,6}  {count / (double)Math.Max(1, _shape.Games),6:P0}  {reason}");
        }
        sb.AppendLine($"  {_shape.SawFatigue,6}  "
            + $"{_shape.SawFatigue / (double)Math.Max(1, _shape.Games),6:P0}  "
            + "charged debt for an empty deck at some point, however they ended");
        sb.AppendLine();

        sb.AppendLine("Leaders in the field:");
        foreach (var a in _all.Where(x => !x.ReferenceBot).OrderByDescending(x => x.Elo))
        {
            sb.AppendLine($"  {a.Elo,6:0}  {a.LeaderName,-26} ({a.Colors})  {a.Wins}-{a.Losses}-{a.Draws}");
        }
        return sb.ToString();
    }

    public static string DeckText(Agent a)
    {
        var sb = new System.Text.StringBuilder();
        sb.AppendLine($"{a.Name}  rating {a.Elo:0}  {a.Wins}-{a.Losses}-{a.Draws}");
        sb.AppendLine($"leader: {a.LeaderName} [{a.LeaderId}] ({a.Colors})");
        sb.AppendLine();
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var id in a.Deck) counts[id] = counts.GetValueOrDefault(id) + 1;
        foreach (var (id, n) in counts.OrderBy(kv => kv.Key, StringComparer.Ordinal))
        {
            var def = Registry.TryCard(id);
            sb.AppendLine($"  {n}x {def?.Name ?? id} [{id}] {def?.Type} L{def?.Level} {def?.Cost}");
        }
        return sb.ToString();
    }

    private string Json()
    {
        var sb = new System.Text.StringBuilder();
        sb.Append("{\n  \"round\": ").Append(_round).Append(",\n  \"agents\": [\n");
        bool first = true;
        foreach (var a in _all.OrderByDescending(x => x.Elo))
        {
            if (!first) sb.Append(",\n");
            first = false;
            sb.Append("    {\"name\": ").Append(Q(a.Name))
              .Append(", \"elo\": ").Append(a.Elo.ToString("0.0"))
              .Append(", \"brain\": ").Append(Q(a.Brain?.Name ?? "reference"))
              .Append(", \"leader\": ").Append(Q(a.LeaderId))
              .Append(", \"colors\": ").Append(Q(a.Colors))
              .Append(", \"wins\": ").Append(a.Wins)
              .Append(", \"losses\": ").Append(a.Losses)
              .Append(", \"draws\": ").Append(a.Draws)
              .Append(", \"volatility\": ").Append(a.Volatility.ToString("0.000",
                  System.Globalization.CultureInfo.InvariantCulture))
              .Append(", \"mutations\": ").Append(a.Mutations)
              .Append(", \"deck\": [").Append(string.Join(", ", a.Deck.Select(Q))).Append("]}");
        }
        sb.Append("\n  ],\n  \"brains\": [\n");
        first = true;
        foreach (var b in _brains.OrderByDescending(x => x.Elo))
        {
            if (!first) sb.Append(",\n");
            first = false;
            sb.Append("    {\"name\": ").Append(Q(b.Name))
              .Append(", \"elo\": ").Append(b.Elo.ToString("0.0"))
              .Append(", \"games\": ").Append(b.Games)
              .Append(", \"steps\": ").Append(b.TrainedSteps)
              .Append(", \"loss\": ").Append(b.LastLoss.ToString("0.00000"))
              .Append(", \"positions\": ").Append(b.Store.Count).Append('}');
        }
        sb.Append("\n  ]\n}\n");
        return sb.ToString();
    }

    private static string Q(string s) => "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
}
