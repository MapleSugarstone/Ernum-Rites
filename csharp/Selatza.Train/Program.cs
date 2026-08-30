using System.Globalization;
using System.Diagnostics;
using Selatza;
using Selatza.Ai;
using Selatza.Cards;
using Selatza.Learn;
using Selatza.Learn.Nn;

namespace Selatza.Train;

/// <summary>
/// The training harness.
///
///   dotnet run -c Release --project csharp/Selatza.Train -- train --rounds 40
///   dotnet run -c Release --project csharp/Selatza.Train -- gauntlet --net runs/latest/net0.snn
///   dotnet run -c Release --project csharp/Selatza.Train -- probe
///   dotnet run -c Release --project csharp/Selatza.Train -- bench
/// </summary>
public static class Program
{
    public static int Main(string[] args)
    {
        CardSets.RegisterAll();
        CardIndex.EnsureBuilt();
        var cmd = args.FirstOrDefault(a => !a.StartsWith("--", StringComparison.Ordinal)) ?? "train";

        // Any command that plays games can record them. Opened here rather than
        // inside each one so the flag means the same thing everywhere.
        string logPath = Str(args, "--log-games", "");
        if (logPath.Length > 0)
        {
            GameLog.Open(logPath, Int(args, "--log-every", 1));
            Console.WriteLine($"logging games to {logPath}"
                + (Int(args, "--log-every", 1) > 1 ? $", 1 in {Int(args, "--log-every", 1)}" : ""));
        }
        try
        {
            return Dispatch(cmd, args);
        }
        finally
        {
            if (GameLog.Active)
            {
                long n = GameLog.GamesWritten;
                GameLog.Close();
                var size = new FileInfo(logPath).Length;
                Console.WriteLine($"wrote {n:N0} games to {logPath} "
                    + $"({size / 1024.0 / 1024.0:F1} MB, {(n > 0 ? size / (double)n : 0):F0} bytes a game)");
            }
        }
    }

    private static int Dispatch(string cmd, string[] args)
    {
        return cmd switch
        {
            "train" => Train(args),
            "gauntlet" => Gauntlet(args),
            "probe" => Probe(args),
            "bench" => Bench(args),
            "deck" => Deck(args),
            "gradcheck" => GradCheck(args),
            "cards" => CardReport(args),
            "matchup" => Matchup(args),
            "roundrobin" => RoundRobin(args),
            "diff" => Diff(args),
            "logstats" => LogStats(args),
            "patterns" => Patterns.Run(args),
            "fuzz" => Fuzz.Run(args),
            "mirror" => Mirror.Run(args),
            "query" => Query.Run(args),
            "db" => Db.Build(args),
            "sql" => Db.Sql(args),
            _ => Usage(),
        };
    }

    private static int Usage()
    {
        Console.WriteLine("commands: train | matchup | roundrobin | logstats | diff | cards | probe | deck | gauntlet"
            + " | bench | gradcheck");
        Console.WriteLine();
        Console.WriteLine("For balance work, start here:");
        Console.WriteLine("  train --no-net --rounds 400 --out runs/v1     evolve decks, fast");
        Console.WriteLine("  matchup --a runs/v1/best-deck.txt --swap px-firebolt=px-potion");
        Console.WriteLine("  diff --before runs/v1/cards.csv --after runs/v2/cards.csv");
        Console.WriteLine();
        Console.WriteLine("train    --rounds 60 --agents 16 --brains 4 --anchors 2 --games 2");
        Console.WriteLine("         --no-net (no networks: the evaluator plays and only decks evolve,");
        Console.WriteLine("           which is the setting to use when you are balancing cards)");
        Console.WriteLine("         --leader-pool all|printed|sturdy|dual|nonflip --deck-size 48 --topk 12");
        Console.WriteLine("         --leaders id1,id2,...  fixed roster, dealt round robin across --agents");
        Console.WriteLine("         --every-leader (one agent per card in the pool, in order, which sets");
        Console.WriteLine("           --agents for you and gives every one of them its own rating)");
        Console.WriteLine("         --random-leaders (draw each leader independently instead of covering");
        Console.WriteLine("           every colour identity, which can leave a colour pair unrepresented)");
        Console.WriteLine("         --scout-deck 0.15 --scout-rolls 3 --scout-hand 0.05 --scout-hand-rolls 1");
        Console.WriteLine("         --forget 0 --no-counting --mutate 3 --reseed 0 --evolve-every 10");
        Console.WriteLine("         --steps 150 --batch 128 --lr 0.002 --replay-cap 60000 --net small");
        Console.WriteLine("         --threads N --seed 1 --out runs/latest --gauntlet 40 --quiet");
        Console.WriteLine("         --snapshot-every 1 --fresh (ignore any snapshot and start over)");
        Console.WriteLine("         --net-weight-start 0 --net-weight-end 0.2 (how large a correction");
        Console.WriteLine("           the network may make to the evaluator's ranking, first round to last)");
        Console.WriteLine("         --temperature 0.05 --epsilon 0.02 (exploration, both anneal to zero)");
        Console.WriteLine("         --residual 1.0 (scale on the correction it is asked to learn)");
        Console.WriteLine("         --evolve-gap 60 (rating gap before a network is reseeded)");
        Console.WriteLine();
        Console.WriteLine("A run snapshots itself after every round and picks up where it left off,");
        Console.WriteLine("so rerunning the same command after a crash continues rather than restarts.");
        Console.WriteLine();
        Console.WriteLine("matchup  --a <deck file or starter:key> --b <deck> --games 400");
        Console.WriteLine("         --swap old-id=new-id --swap-count 0 (0 swaps every copy)");
        Console.WriteLine("         --net runs/v1/net0.snn (play it with a network instead)");
        Console.WriteLine("diff     --before runs/v1/cards.csv --after runs/v2/cards.csv --top 15");
        Console.WriteLine("cards    lists the card axis and audits costs against colour identity");
        Console.WriteLine("gauntlet --net runs/latest/net0.snn --games 60 --deck runs/latest/best-deck.txt");
        Console.WriteLine("probe    --seed 7 --scout-deck 0.15 --turns 12");
        return 2;
    }

    // --- argument helpers ----------------------------------------------------

    private static bool Flag(string[] a, string name) => Array.IndexOf(a, name) >= 0;

    private static string Str(string[] a, string name, string fallback)
    {
        int i = Array.IndexOf(a, name);
        return i >= 0 && i + 1 < a.Length ? a[i + 1] : fallback;
    }

    private static int Int(string[] a, string name, int fallback)
    {
        int i = Array.IndexOf(a, name);
        return i >= 0 && i + 1 < a.Length && int.TryParse(a[i + 1], out var v) ? v : fallback;
    }

    private static double Dbl(string[] a, string name, double fallback)
    {
        int i = Array.IndexOf(a, name);
        return i >= 0 && i + 1 < a.Length && double.TryParse(a[i + 1],
            System.Globalization.CultureInfo.InvariantCulture, out var v) ? v : fallback;
    }

    private static TournamentConfig ConfigFrom(string[] args)
    {
        var intel = new IntelConfig
        {
            DeckScoutChance = Dbl(args, "--scout-deck", 0.15),
            DeckScoutRolls = Int(args, "--scout-rolls", 3),
            HandScoutChance = Dbl(args, "--scout-hand", 0.05),
            HandScoutRolls = Int(args, "--scout-hand-rolls", 1),
            HandForgetPerTurn = Dbl(args, "--forget", 0.0),
            CountPlayedCopies = !Flag(args, "--no-counting"),
        };

        var shape = Str(args, "--net", "default") == "small" ? NetShape.Small : NetShape.Default;
        int size = Int(args, "--deck-size", 48);
        // Balance work wants games, not gradients. With no networks a round is
        // five to ten times faster and the card numbers are correspondingly
        // less noisy for the same wall clock.
        bool noNet = Flag(args, "--no-net");

        return new TournamentConfig
        {
            Agents = Int(args, "--agents", 16),
            Brains = noNet ? 0 : Int(args, "--brains", 4),
            Anchors = Int(args, "--anchors", 2),
            Rounds = Int(args, "--rounds", 60),
            GamesPerPairing = Int(args, "--games", 2),
            EvolveEvery = Int(args, "--evolve-every", 10),
            MutateOnLoss = Int(args, "--mutate", 3),
            ReseedWorst = Int(args, "--reseed", 0),
            Threads = Int(args, "--threads", Math.Max(1, Environment.ProcessorCount - 1)),
            Seed = Int(args, "--seed", 1),
            OutDir = Str(args, "--out", Path.Combine("runs", "latest")),
            GauntletGames = Int(args, "--gauntlet", noNet ? 0 : 40),
            Quiet = Flag(args, "--quiet"),
            Resume = !Flag(args, "--fresh"),
            SpreadLeaders = !Flag(args, "--random-leaders"),
            EnumerateLeaders = Flag(args, "--every-leader"),
            LeaderList = Str(args, "--leaders", "")
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .ToList(),
            SnapshotEvery = Int(args, "--snapshot-every", 1),
            NetWeightStart = noNet ? 0 : Dbl(args, "--net-weight-start", 0.0),
            EvolveGap = Dbl(args, "--evolve-gap", 60),
            NetWeightEnd = noNet ? 0 : Dbl(args, "--net-weight-end", 0.2),
            Epsilon = Dbl(args, "--epsilon", 0.02),
            TemperatureStart = Dbl(args, "--temperature", 0.05),
            LeaderPool = Str(args, "--leader-pool", "all").ToLowerInvariant() switch
            {
                "starter" or "printed" => LeaderPool.Starter,
                "sturdy" => LeaderPool.Sturdy,
                "dual" => LeaderPool.Dual,
                "nonflip" => LeaderPool.NonFlip,
                _ => LeaderPool.All,
            },
            Deck = new DeckShape
            {
                Size = size,
                Summons = (int)Math.Round(size * 0.5),
                Spells = (int)Math.Round(size * 0.29),
                Traps = (int)Math.Round(size * 0.06),
                Stages = (int)Math.Round(size * 0.04),
            },
            Intel = intel,
            Net = shape,
            Agent = new AgentConfig
            {
                TopK = Int(args, "--topk", 12),
                RecordEvery = noNet ? 0 : Int(args, "--record-every", 2),
            },
            Train = new TrainConfig
            {
                StepsPerRound = noNet ? 0 : Int(args, "--steps", 150),
                BatchSize = Int(args, "--batch", 128),
                Lr = (float)Dbl(args, "--lr", 0.002),
                ReplayCap = Int(args, "--replay-cap", 60000),
                SampleReuse = Dbl(args, "--reuse", 4),
                ResidualScale = (float)Dbl(args, "--residual", 1.0),
                HandWeight = (float)Dbl(args, "--hand-weight", 0.3),
                TrapWeight = (float)Dbl(args, "--trap-weight", 0.2),
            },
        };
    }

    // --- commands ------------------------------------------------------------

    private static int Train(string[] args)
    {
        var cfg = ConfigFrom(args);
        var run = new Tournament(cfg);
        run.Run();

        if (cfg.GauntletGames > 0)
        {
            var best = run.Agents.Where(a => !a.ReferenceBot).OrderByDescending(a => a.Elo).First();
            int n = cfg.GauntletGames;
            Console.WriteLine();
            Console.WriteLine($"gauntlet: {best.Name} on {best.LeaderName} ({best.Colors}) "
                + $"against the shipped bot on starter decks, {n} games each way.");

            // The same deck over the same games at several settings of how much
            // the network decides. Zero is the evaluator the network replaced,
            // which is the bar; anything above that line is what the network is
            // actually worth. Reading only the top line would credit the network
            // with the deck's record.
            best.Config.Temperature = 0;
            best.Config.Epsilon = 0;
            double baseline = 0;
            Console.WriteLine("  correction   record        win rate   versus the evaluator");
            foreach (double weight in new[] { 0.0, 0.15, 0.35, 0.6, 1.0 })
            {
                best.Config.NetWeight = weight;
                var (w, l, d) = run.Gauntlet(best, n, cfg.Seed * 13);
                double rate = (w + 0.5 * d) / n;
                if (weight == 0) baseline = rate;
                Console.WriteLine($"  {weight,10:0.00}   {w,3}-{l,3}-{d,-3}   {rate,8:P0}   "
                    + (weight == 0 ? "(the bar)" : $"{(rate - baseline) * 100:+0.0;-0.0;0.0} points"));
            }
        }
        Console.WriteLine($"written to {Path.GetFullPath(cfg.OutDir)}");
        return 0;
    }

    private static int Gauntlet(string[] args)
    {
        string netPath = Str(args, "--net", Path.Combine("runs", "latest", "net0.snn"));
        int games = Int(args, "--games", 60);
        if (!File.Exists(netPath))
        {
            Console.Error.WriteLine($"no network at {netPath}");
            return 1;
        }
        var net = SelatzaNet.Load(netPath);
        var cfg = ConfigFrom(args);
        var rng = new Gauss(cfg.Seed);

        string leaderArg = Str(args, "--leader", "");
        string leader = leaderArg.Length > 0 ? leaderArg : DeckGen.RandomLeader(cfg.LeaderPool, rng);
        var deckPath = Str(args, "--deck", "");
        List<string> deck = deckPath.Length > 0 && File.Exists(deckPath)
            ? LoadDeck(deckPath, ref leader)
            : DeckGen.Random(leader, cfg.Deck, rng);

        var brain = new Brain { Name = "loaded", Net = net };
        brain.EnsureReplicas(Math.Max(1, cfg.Threads), 99);
        var agent = new Agent
        {
            Name = "learned",
            LeaderId = leader,
            Deck = deck,
            Brain = brain,
            Config = cfg.Agent,
            Intel = cfg.Intel,
        };
        agent.Config.NetWeight = 1;
        agent.Config.Temperature = 0;
        agent.Config.Epsilon = 0;

        var run = new Tournament(new TournamentConfig
        { Agents = 0, Brains = 1, Anchors = 0, Rounds = 0, Threads = cfg.Threads, Seed = cfg.Seed });
        var (w, l, d) = run.Gauntlet(agent, games, cfg.Seed * 13);
        Console.WriteLine($"{Path.GetFileName(netPath)} on {agent.LeaderName} ({agent.Colors}) "
            + $"over {games} games: {w}-{l}-{d} ({(w + 0.5 * d) / games:P0})");
        return 0;
    }

    private static List<string> LoadDeck(string path, ref string leader)
    {
        var cards = new List<string>();
        foreach (var line in File.ReadAllLines(path))
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
        return cards;
    }

    /// <summary>
    /// One game with the scouting narrated, so the read can be seen working
    /// rather than taken on faith.
    /// </summary>
    private static int Probe(string[] args)
    {
        var cfg = ConfigFrom(args);
        var rng = new Gauss(cfg.Seed);
        int seed = Int(args, "--seed", 7);
        int turnCap = Int(args, "--turns", 14);

        string leaderA = DeckGen.RandomLeader(cfg.LeaderPool, rng);
        string leaderB = DeckGen.RandomLeader(cfg.LeaderPool, rng);
        var a = new Agent
        {
            Name = "watcher",
            LeaderId = leaderA,
            Deck = DeckGen.Random(leaderA, cfg.Deck, rng),
            Intel = cfg.Intel,
            ReferenceBot = true,
        };
        var b = new Agent
        {
            Name = "target",
            LeaderId = leaderB,
            Deck = DeckGen.Random(leaderB, cfg.Deck, rng),
            Intel = IntelConfig.Blind,
            ReferenceBot = true,
        };

        var state = Engine.CreateGame(a.ToDeckList(), b.ToDeckList(), seed);
        var intel = new Intel(0, cfg.Intel, seed * 31 + 5);
        intel.Begin(state);
        var enc = new Encoder(0, intel, state);

        Console.WriteLine($"watcher: {a.LeaderName} ({a.Colors})   target: {b.LeaderName} ({b.Colors})");
        Console.WriteLine($"intel: {cfg.Intel}");
        Console.WriteLine();

        int lastNamed = 0;
        while (state.Winner < 0 && state.Turn <= turnCap)
        {
            int actor = state.CurrentActor;
            var action = Bot.ChooseAction(state, actor);
            var res = Engine.Apply(state, actor, action);
            if (!res.Ok) break;
            intel.Observe(state, actor, action, res.State!);
            state = res.State!;

            int named = intel.DeckCardsNamed + intel.HandCardsNamed;
            if (named != lastNamed)
            {
                lastNamed = named;
                Console.WriteLine($"turn {state.Turn,2}: after {intel.ScoutRollsTaken,3} rolls, "
                    + $"{intel.DeckCardsNamed} deck and {intel.HandCardsNamed} hand cards named");
                Console.WriteLine("          deck: " + Named(intel.KnownDeck));
                Console.WriteLine("          hand: " + Named(intel.KnownHand));
                Console.WriteLine($"          trap risk {intel.TrapRisk(state):P0}");
            }
        }

        Console.WriteLine();
        Console.WriteLine($"after {state.Turn} turns"
            + (state.Winner >= 0 ? $", won by player {state.Winner} ({state.WinReason})" : ""));
        Console.WriteLine($"  {intel.ScoutRollsTaken} rolls named {intel.DeckCardsNamed} deck "
            + $"and {intel.HandCardsNamed} hand cards");
        Console.WriteLine("  still named in their deck: " + Named(intel.KnownDeck));
        Console.WriteLine("  still named in their hand: " + Named(intel.KnownHand));
        Console.WriteLine($"  trap risk {intel.TrapRisk(state):P0}");
        Console.WriteLine();
        Console.WriteLine("copies of their cards accounted for by watching:");
        Console.WriteLine("          " + Named(intel.Accounted));
        var obs = enc.EncodeNew(state);
        int nonzero = obs.Count(v => v != 0);
        Console.WriteLine();
        Console.WriteLine($"observation: {obs.Length} floats, {nonzero} non-zero "
            + $"({CardIndex.Count} card columns x {Encoder.CardChannels} channels, "
            + $"{Encoder.Entities} bodies x {Encoder.EntityChannels}, {Encoder.ScalarCount} scalars)");
        return 0;
    }

    private static string Named(ReadOnlySpan<int> counts)
    {
        var parts = new List<string>();
        for (int c = 0; c < counts.Length; c++)
        {
            if (counts[c] > 0) parts.Add($"{counts[c]}x {CardIndex.Def(c).Name}");
        }
        return parts.Count == 0 ? "(nothing)" : string.Join(", ", parts);
    }

    private static int Bench(string[] args)
    {
        var cfg = ConfigFrom(args);
        var rng = new Gauss(1);
        string leader = DeckGen.RandomLeader(cfg.LeaderPool, rng);
        var deck = DeckGen.Random(leader, cfg.Deck, rng);
        var list = DeckGen.ToDeckList("bench", leader, deck);
        var state = Engine.CreateGame(list, list, 11);
        var intel = new Intel(0, cfg.Intel, 5);
        intel.Begin(state);
        var enc = new Encoder(0, intel, state);
        var net = new SelatzaNet(cfg.Net, 3);

        Console.WriteLine($"{net.ParameterCount:N0} weights, sample {net.SampleSize:N0} floats "
            + $"({net.SampleSize * 4 / 1024.0:0.0} kB)");

        var buf = new float[net.SampleSize * 16];
        var sw = Stopwatch.StartNew();
        int n = 20000;
        for (int i = 0; i < n; i++) enc.Encode(state, buf, 0);
        Console.WriteLine($"encode      {n / (sw.ElapsedMilliseconds / 1000.0):N0}/sec "
            + $"({sw.ElapsedMilliseconds * 1000.0 / n:0.0} us)");

        foreach (int batch in new[] { 1, 4, 12 })
        {
            for (int i = 0; i < batch; i++) enc.Encode(state, buf, i * net.SampleSize);
            var dest = new float[batch];
            net.ValueInto(buf, batch, dest);
            sw.Restart();
            int reps = 2000;
            for (int i = 0; i < reps; i++) net.ValueInto(buf, batch, dest);
            double perEval = sw.Elapsed.TotalMilliseconds * 1000 / (reps * batch);
            Console.WriteLine($"net b={batch,-3}   {perEval:0.0} us/position "
                + $"({reps * batch / sw.Elapsed.TotalSeconds:N0}/sec)");
        }

        var brain = new Brain { Name = "bench", Net = net };
        brain.EnsureReplicas(4, 1);
        var agent = new Agent
        {
            Name = "bench",
            LeaderId = leader,
            Deck = deck,
            Brain = brain,
            Config = cfg.Agent,
            Intel = cfg.Intel,
        };
        agent.Config.NetWeight = 1;
        sw.Restart();
        int games = Int(args, "--games", 6);
        int turns = 0, decisions = 0, recorded = 0, acts = 0;
        for (int g = 0; g < games; g++)
        {
            var store = new SampleStore();
            var m = Match.Play(agent, agent, 100 + g, g % 2, 0, store, store);
            turns += m.Turns;
            acts += m.Actions;
            decisions += m.Decisions;
            recorded += m.Recorded;
        }
        Console.WriteLine($"game        {sw.Elapsed.TotalSeconds / games:0.00} s each "
            + $"({games / sw.Elapsed.TotalSeconds:0.0}/sec single-threaded)");
        Console.WriteLine($"per game    {turns / (double)games:0.0} turns, {acts / (double)games:0.0} actions, "
            + $"{decisions / (double)games:0.0} real choices, {recorded / (double)games:0.0} recorded");
        return 0;
    }

    private static int Deck(string[] args)
    {
        var cfg = ConfigFrom(args);
        var rng = new Gauss(Int(args, "--seed", 1));
        int n = Int(args, "--count", 3);
        for (int i = 0; i < n; i++)
        {
            string leader = Str(args, "--leader", "");
            if (leader.Length == 0) leader = DeckGen.RandomLeader(cfg.LeaderPool, rng);
            var deck = DeckGen.Random(leader, cfg.Deck, rng);
            string? bad = DeckGen.Validate(leader, deck, cfg.Deck.Size);
            var agent = new Agent { Name = $"deck{i}", LeaderId = leader, Deck = deck };
            Console.WriteLine(Tournament.DeckText(agent));
            Console.WriteLine(bad is null ? "  legal" : $"  ILLEGAL: {bad}");
            Console.WriteLine();
        }
        return 0;
    }

    /// <summary>
    /// Compares every analytic gradient against a numeric one. Hand-written
    /// backprop is exactly the kind of code that is quietly wrong, so this is
    /// the test that says it is not.
    /// </summary>
    private static int GradCheck(string[] args)
    {
        bool bad = false;
        Console.WriteLine("layer by layer, against a linear loss:");
        foreach (var r in Selatza.Learn.Nn.GradCheck.All(Int(args, "--seed", 17)))
        {
            bool ok = r.Worst < 1e-2;
            bad |= !ok;
            Console.WriteLine($"  {(ok ? "ok  " : "FAIL")} {r}");
        }
        Console.WriteLine();
        Console.WriteLine("whole network, for information only. Any weight that shifts a whole");
        Console.WriteLine("channel at once (biases, depthwise kernels, the static projection) walks");
        Console.WriteLine("a finite difference across ReLU hinges the analytic gradient does not");
        Console.WriteLine("have, so only the median is meaningful here:");
        int netCode = WholeNetCheck(args);
        Console.WriteLine();
        Console.WriteLine("end to end, can it learn:");
        int fitCode = FitCheck();
        return bad || netCode != 0 || fitCode != 0 ? 1 : 0;
    }

    /// <summary>
    /// Trains the real network on a fixed target that is a function of the
    /// observation, which exercises encoder, forward, backward and optimiser
    /// together. A finite-difference check cannot catch a wiring mistake that
    /// happens to be self-consistent; a loss that refuses to fall can.
    /// </summary>
    private static int FitCheck()
    {
        var net = new SelatzaNet(NetShape.Small, 21);
        var brain = new Brain { Name = "fit", Net = net };
        brain.Optimizer.Lr = 3e-3f;
        var rng = new Gauss(5);
        var store = brain.Store;

        var target = new float[net.SampleSize];
        for (int i = 0; i < target.Length; i++) target[i] = rng.Next(0.05f);
        var sample = new float[net.SampleSize];
        var hand = new float[SelatzaNet.HandBuckets];

        for (int s = 0; s < 600; s++)
        {
            Array.Clear(sample);
            double sum = 0;
            for (int k = 0; k < 40; k++)
            {
                int i = rng.NextInt(net.SampleSize);
                sample[i] = 0.25f * (1 + rng.NextInt(4));
                sum += sample[i] * target[i];
            }
            for (int i = 0; i < hand.Length; i++) hand[i] = 0;
            hand[s % SelatzaNet.HandBuckets] = 0.5f;
            store.Add(sample, (float)Math.Tanh(sum * 6), 0f, hand, s % 2);
        }

        var cfg = new TrainConfig { BatchSize = 64, StepsPerRound = 40, Lr = 3e-3f };
        var first = Trainer.Train(brain, cfg, rng);
        TrainReport last = first;
        for (int i = 0; i < 14; i++) last = Trainer.Train(brain, cfg, rng);
        Console.WriteLine($"  value loss {first.Value:0.0000} -> {last.Value:0.0000}");
        Console.WriteLine($"  hand loss  {first.Hand:0.0000} -> {last.Hand:0.0000}");
        Console.WriteLine($"  trap loss  {first.Trap:0.0000} -> {last.Trap:0.0000}");
        bool ok = last.Value < first.Value * 0.5 && last.Hand < first.Hand * 0.8;
        Console.WriteLine(ok ? "  ok" : "  FAIL: the loss did not come down");
        return ok ? 0 : 1;
    }

    private static int WholeNetCheck(string[] args)
    {
        var net = new SelatzaNet(NetShape.Small, 5);
        int batch = 3;
        var rng = new Gauss(11);
        var input = new float[batch * net.SampleSize];
        for (int i = 0; i < input.Length; i++) input[i] = rng.Uniform() < 0.03 ? rng.Next(0.6f) : 0;
        var zv = new float[batch];
        var zh = new float[batch * SelatzaNet.HandBuckets];
        var zt = new float[batch];
        for (int i = 0; i < batch; i++)
        {
            zv[i] = rng.Next(0.5f);
            zt[i] = i % 2;
        }
        for (int i = 0; i < zh.Length; i++) zh[i] = MathF.Abs(rng.Next(0.3f));

        double Loss()
        {
            net.Forward(input, batch, training: false);
            double l = 0;
            for (int i = 0; i < batch; i++)
            {
                float e = net.LastValue.Data[i] - zv[i];
                l += e * e / batch;
                float p = 1f / (1f + MathF.Exp(-net.LastTrap.Data[i]));
                l += -(zt[i] * Math.Log(p + 1e-7) + (1 - zt[i]) * Math.Log(1 - p + 1e-7)) / batch;
            }
            for (int i = 0; i < zh.Length; i++)
            {
                float e = net.LastHand.Data[i] - zh[i];
                l += e * e / (batch * SelatzaNet.HandBuckets);
            }
            return l;
        }

        net.Forward(input, batch, training: true);
        var dv = new float[batch];
        var dh = new float[batch * SelatzaNet.HandBuckets];
        var dt = new float[batch];
        for (int i = 0; i < batch; i++)
        {
            dv[i] = 2f * (net.LastValue.Data[i] - zv[i]) / batch;
            float p = 1f / (1f + MathF.Exp(-net.LastTrap.Data[i]));
            dt[i] = (p - zt[i]) / batch;
        }
        for (int i = 0; i < dh.Length; i++)
        {
            dh[i] = 2f * (net.LastHand.Data[i] - zh[i]) / (batch * SelatzaNet.HandBuckets);
        }
        Adam.ZeroGrads(net.Parameters);
        net.Backward(dv, dh, dt, batch);

        var errors = new List<(double Rel, string Where)>();
        double worst = 0;
        string worstName = "";
        int checkedCount = 0;
        var probe = new Gauss(3);
        foreach (var p in net.Parameters)
        {
            int take = Math.Min(6, p.W.Length);
            for (int t = 0; t < take; t++)
            {
                int i = probe.NextInt(p.W.Length);
                float orig = p.W[i];
                const float h = 1e-3f;
                p.W[i] = orig + h;
                net.AfterStep();
                double up = Loss();
                p.W[i] = orig - h;
                net.AfterStep();
                double down = Loss();
                p.W[i] = orig;
                net.AfterStep();

                double numeric = (up - down) / (2 * h);
                double analytic = p.G[i];
                double scale = Math.Max(1e-4, Math.Abs(numeric) + Math.Abs(analytic));
                double rel = Math.Abs(numeric - analytic) / scale;
                checkedCount++;
                errors.Add((rel, $"{p.Name}[{i}] numeric {numeric:E3} analytic {analytic:E3}"));
                if (rel > worst)
                {
                    worst = rel;
                    worstName = $"{p.Name}[{i}] numeric {numeric:E3} analytic {analytic:E3}";
                }
            }
        }
        var sorted = errors.OrderBy(e => e.Rel).ToList();
        double median = sorted[sorted.Count / 2].Rel;
        double p90 = sorted[(int)(sorted.Count * 0.9)].Rel;
        Console.WriteLine($"  checked {checkedCount} weights across {net.Parameters.Count} tensors");
        Console.WriteLine($"  median {median:E2}  p90 {p90:E2}  worst {worst:E2} ({worstName})");
        bool ok = median < 1e-2;
        Console.WriteLine(ok ? "  ok" : "  FAIL");
        return ok ? 0 : 1;
    }

    /// <summary>
    /// Two decks, the same games, one difference. This is the command that
    /// settles a card, as opposed to the tournament report, which nominates one.
    /// </summary>
    private static int Matchup(string[] args)
    {
        int games = Int(args, "--games", 400);
        int seed = Int(args, "--seed", 1);
        int threads = Int(args, "--threads", Math.Max(1, Environment.ProcessorCount - 1));
        string aSpec = Str(args, "--a", "");
        if (aSpec.Length == 0)
        {
            Console.Error.WriteLine("matchup needs --a <deck file or starter:key>");
            return 2;
        }

        Experiment.Deck a, b;
        try
        {
            a = Experiment.Load(aSpec);
        }
        catch (Exception ex) when (ex is FileNotFoundException or InvalidDataException or KeyNotFoundException)
        {
            Console.Error.WriteLine(ex.Message);
            return 1;
        }

        string swap = Str(args, "--swap", "");
        string label;
        if (swap.Length > 0)
        {
            var parts = swap.Split('=', 2);
            if (parts.Length != 2)
            {
                Console.Error.WriteLine("--swap wants old-card-id=new-card-id");
                return 2;
            }
            int count = Int(args, "--swap-count", 0);
            b = Experiment.Swap(a, parts[0], parts[1], count, out var problem);
            if (problem is not null)
            {
                Console.Error.WriteLine($"the swapped deck is not usable: {problem}");
                return 1;
            }
            string fromName = Registry.TryCard(parts[0])?.Name ?? parts[0];
            string toName = Registry.TryCard(parts[1])?.Name ?? parts[1];
            label = count > 0
                ? $"{count} copies of {fromName} become {toName}"
                : $"every {fromName} becomes {toName}";
        }
        else
        {
            string bSpec = Str(args, "--b", aSpec);
            b = Experiment.Load(bSpec);
            label = bSpec == aSpec ? "the same deck both sides, which should land near even" : bSpec;
        }

        var intel = ConfigFrom(args).Intel;
        SelatzaNet? net = null;
        string netPath = Str(args, "--net", "");
        if (netPath.Length > 0 && File.Exists(netPath)) net = SelatzaNet.Load(netPath);

        Console.WriteLine($"A: {a.Name} on {Registry.TryCard(a.LeaderId)?.Name ?? a.LeaderId}");
        Console.WriteLine($"B: {label}");
        Console.WriteLine($"{games} games, {(net is null ? "the evaluator plays" : "network scoring")}, "
            + $"intel: {intel}");
        Console.WriteLine();

        var res = Experiment.Play(a, b, games, seed, threads, intel, net: net);
        var ci = res.Confidence95;
        Console.WriteLine($"  A wins {res.WinsA}, B wins {res.WinsB}"
            + (res.Draws > 0 ? $", {res.Draws} unresolved" : ""));
        Console.WriteLine($"  A takes {res.RateA:P1} of the points, 95% interval {ci}");
        Console.WriteLine($"  games run {res.Shape.Mean:0.0} turns on average, "
            + $"{res.Shape.ShareUnder(8):P0} under 8");
        Console.WriteLine("  " + string.Join(", ", res.Shape.Reasons.Select(r => $"{r.Reason} x{r.Count}")));
        Console.WriteLine();
        Console.WriteLine(res.Decisive
            ? $"  Decisive: the interval excludes an even matchup, so the difference is real."
            : $"  Not decisive at {games} games. The interval still covers 50%, so run more.");
        return 0;
    }

    /// <summary>
    /// Every deck in a folder against every other, both seats. One process holds
    /// all of them, because 190 pairings launched one at a time spends more time
    /// starting the runtime than playing.
    /// </summary>
    private static int RoundRobin(string[] args)
    {
        string dir = Str(args, "--decks", "");
        int games = Int(args, "--games", 200);
        int seed = Int(args, "--seed", 1);
        int threads = Int(args, "--threads", Math.Max(1, Environment.ProcessorCount - 1));
        string outPath = Str(args, "--out", "");
        if (!Directory.Exists(dir))
        {
            Console.Error.WriteLine("roundrobin needs --decks <folder of deck files>");
            return 2;
        }

        var files = Directory.GetFiles(dir, "*.txt").OrderBy(f => f, StringComparer.Ordinal).ToArray();
        var decks = new List<Experiment.Deck>();
        foreach (var f in files)
        {
            try { decks.Add(Experiment.Load(f)); }
            catch (Exception ex) when (ex is InvalidDataException or KeyNotFoundException)
            {
                Console.Error.WriteLine($"skipping {Path.GetFileName(f)}: {ex.Message}");
            }
        }
        if (decks.Count < 2)
        {
            Console.Error.WriteLine("need at least two usable decks");
            return 1;
        }

        var intel = ConfigFrom(args).Intel;
        int pairs = decks.Count * (decks.Count - 1) / 2;
        Console.WriteLine($"{decks.Count} decks, {pairs} pairings, {games} games each "
            + $"({pairs * games} games total), intel: {intel}");
        Console.WriteLine();

        var rows = new List<string> { "a,b,a_leader,b_leader,games,a_wins,b_wins,draws,a_rate,lo,hi,turns" };
        int done = 0;
        for (int i = 0; i < decks.Count; i++)
        {
            for (int j = i + 1; j < decks.Count; j++)
            {
                // Seat is part of the matchup, so each pairing gets its own seed
                // and Play alternates who is on the play inside it.
                var res = Experiment.Play(decks[i], decks[j], games, seed + i * 1000 + j, threads, intel);
                var ci = res.Confidence95;
                rows.Add(string.Join(",",
                    decks[i].Name, decks[j].Name,
                    Registry.TryCard(decks[i].LeaderId)?.Name ?? decks[i].LeaderId,
                    Registry.TryCard(decks[j].LeaderId)?.Name ?? decks[j].LeaderId,
                    res.Games, res.WinsA, res.WinsB, res.Draws,
                    res.RateA.ToString("0.0000", CultureInfo.InvariantCulture),
                    ci.Low.ToString("0.0000", CultureInfo.InvariantCulture),
                    ci.High.ToString("0.0000", CultureInfo.InvariantCulture),
                    res.Shape.Mean.ToString("0.00", CultureInfo.InvariantCulture)));
                done++;
                if (done % 10 == 0 || done == pairs)
                {
                    Console.WriteLine($"  {done}/{pairs} pairings");
                }
            }
        }

        if (outPath.Length > 0)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(outPath))!);
            File.WriteAllLines(outPath, rows);
            Console.WriteLine($"\nwritten to {Path.GetFullPath(outPath)}");
        }
        else
        {
            foreach (var r in rows) Console.WriteLine(r);
        }
        return 0;
    }

    /// <summary>Compares two runs' card tables, which is what a balance change looks like.</summary>

    /// <summary>
    /// Questions asked of a recorded run. The log holds every action with its
    /// targets already resolved, so each of these is a group-by rather than a
    /// replay of the tournament.
    /// </summary>
    private static int LogStats(string[] args)
    {
        string path = Str(args, "--log", "");
        if (path.Length == 0)
        {
            path = args.FirstOrDefault(a => a.EndsWith(".szgl", StringComparison.OrdinalIgnoreCase)) ?? "";
        }
        if (!File.Exists(path))
        {
            Console.Error.WriteLine("logstats needs --log <file written by --log-games>");
            return 2;
        }
        int top = Int(args, "--top", 15);
        string power = Str(args, "--power", "");
        string card = Str(args, "--card", "");
        bool attacks = Flag(args, "--attacks");
        string csv = Str(args, "--csv", "");

        using var r = new GameLogReader(path);
        string Name(int i) =>
            i >= 0 && i < r.Cards.Length ? Registry.Card(r.Cards[i])?.Name ?? r.Cards[i] : "-";

        // Which (card, slot) pairs the named power lives on, matched on the
        // printed name so a power is found wherever it is printed.
        var wanted = new HashSet<(int, int)>();
        if (power.Length > 0)
        {
            foreach (var kv in r.Powers)
            {
                if (string.Equals(kv.Value, power, StringComparison.OrdinalIgnoreCase)) wanted.Add(kv.Key);
            }
            if (wanted.Count == 0)
            {
                Console.Error.WriteLine("no power named " + power + ". Known powers:");
                foreach (var n in r.Powers.Values.Distinct().OrderBy(x => x, StringComparer.OrdinalIgnoreCase))
                {
                    Console.Error.WriteLine("  " + n);
                }
                return 1;
            }
        }

        int cardFilter = -1;
        if (card.Length > 0)
        {
            for (int i = 0; i < r.Cards.Length; i++)
            {
                var def = Registry.Card(r.Cards[i]);
                if (string.Equals(def?.Name, card, StringComparison.OrdinalIgnoreCase)
                    || string.Equals(r.Cards[i], card, StringComparison.Ordinal))
                {
                    cardFilter = i;
                    break;
                }
            }
            if (cardFilter < 0)
            {
                Console.Error.WriteLine("no card named " + card);
                return 1;
            }
        }

        long games = 0, events = 0, turnSum = 0, uses = 0, usesUntargeted = 0;
        var reasons = new long[4];
        var byType = new long[24];
        var played = new Dictionary<int, long>();
        var hits = new Dictionary<int, long>();
        var hitKind = new Dictionary<int, long>();
        var byTurn = new Dictionary<int, long>();
        var attackTargets = new Dictionary<int, long>();

        StreamWriter? rows = null;
        if (csv.Length > 0)
        {
            rows = new StreamWriter(csv);
            rows.WriteLine("game,actor,type,turn,card,power,target_kind,target_player,target_card");
        }

        while (r.NextGame(out _))
        {
            games++;
            while (r.NextEvent(out var e))
            {
                events++;
                if (e.Type >= 0 && e.Type < byType.Length) byType[e.Type]++;
                if (e.Card >= 0 && IsPlayType(e.Type)) Bump(played, e.Card);
                if (e.Type == (int)ActionType.DeclareAttack && e.TargetCount > 0)
                {
                    Bump(attackTargets, r.Targets[0].Card);
                }

                bool match =
                    (wanted.Count > 0 && e.PowerSlot >= 0 && wanted.Contains((e.Card, e.PowerSlot)))
                    || (cardFilter >= 0 && e.Card == cardFilter);
                if (match)
                {
                    uses++;
                    Bump(byTurn, e.Turn);
                    if (e.TargetCount == 0) usesUntargeted++;
                    for (int i = 0; i < e.TargetCount; i++)
                    {
                        Bump(hits, r.Targets[i].Card);
                        Bump(hitKind, r.Targets[i].Kind);
                    }
                }

                bool dump = rows is not null && ((wanted.Count == 0 && cardFilter < 0) || match);
                if (dump)
                {
                    string head = games + "," + e.Actor + "," + (ActionType)e.Type + "," + e.Turn
                        + "," + Csv(Name(e.Card)) + "," + Csv(PowerName(r, e));
                    if (e.TargetCount == 0)
                    {
                        rows!.WriteLine(head + ",,,");
                    }
                    else
                    {
                        for (int i = 0; i < e.TargetCount; i++)
                        {
                            rows!.WriteLine(head + "," + (TargetKind)r.Targets[i].Kind
                                + "," + r.Targets[i].Player + "," + Csv(Name(r.Targets[i].Card)));
                        }
                    }
                }
            }
            var tail = r.EndGame();
            turnSum += tail.Turns;
            if (tail.Reason >= 0 && tail.Reason < 4) reasons[tail.Reason]++;
        }
        rows?.Dispose();

        double perGame = (double)events / Math.Max(1, games);
        double avgTurns = (double)turnSum / Math.Max(1, games);
        Console.WriteLine($"{games:N0} games, {events:N0} actions, {perGame:F1} per game, {avgTurns:F1} turns average");
        Console.WriteLine($"  ended on debt {reasons[1]:N0}   on a leader {reasons[2]:N0}   other {reasons[0] + reasons[3]:N0}");
        Console.WriteLine();

        if (uses == 0 && (power.Length > 0 || card.Length > 0))
        {
            Console.WriteLine((power.Length > 0 ? power : card)
                + " was never used in this log. It is a real name, so nothing in this run played it.");
            Console.WriteLine();
        }

        if (uses > 0)
        {
            string what = power.Length > 0 ? power : card;
            Console.WriteLine($"{what}: {uses:N0} uses, {usesUntargeted:N0} with no target");
            Console.WriteLine($"  {"most common targets",-34}{"count",9}{"share",9}");
            long tot = Math.Max(1, hits.Values.Sum());
            foreach (var kv in hits.OrderByDescending(k => k.Value).Take(top))
            {
                Console.WriteLine($"  {Name(kv.Key),-34}{kv.Value,9:N0}{(double)kv.Value / tot,9:P1}");
            }
            Console.WriteLine();
            Console.WriteLine("  by zone: " + string.Join("  ", hitKind.OrderByDescending(k => k.Value)
                .Select(k => (TargetKind)k.Key + " " + k.Value.ToString("N0"))));
            Console.WriteLine("  by turn: " + string.Join("  ", byTurn.OrderBy(k => k.Key).Take(10)
                .Select(k => "t" + k.Key + " " + k.Value.ToString("N0"))));
            Console.WriteLine();
        }

        if (attacks)
        {
            Console.WriteLine($"  {"most attacked",-34}{"count",9}");
            foreach (var kv in attackTargets.OrderByDescending(k => k.Value).Take(top))
            {
                Console.WriteLine($"  {Name(kv.Key),-34}{kv.Value,9:N0}");
            }
            Console.WriteLine();
        }

        if (power.Length == 0 && card.Length == 0)
        {
            Console.WriteLine($"  {"most played",-34}{"count",9}");
            foreach (var kv in played.OrderByDescending(k => k.Value).Take(top))
            {
                Console.WriteLine($"  {Name(kv.Key),-34}{kv.Value,9:N0}");
            }
            Console.WriteLine();
            Console.WriteLine("  actions: " + string.Join("  ", byType.Select((n, i) => (n, i))
                .Where(t => t.n > 0).OrderByDescending(t => t.n).Take(8)
                .Select(t => (ActionType)t.i + " " + t.n.ToString("N0"))));
        }

        if (csv.Length > 0) Console.WriteLine("\nwrote " + csv);
        return 0;
    }

    private static string PowerName(GameLogReader r, LogEvent e) =>
        e.PowerSlot >= 0 && r.Powers.TryGetValue((e.Card, e.PowerSlot), out var n) ? n : "";

    private static string Csv(string s) =>
        s.IndexOf(',') >= 0 || s.IndexOf('"') >= 0
            ? "\"" + s.Replace("\"", "\"\"") + "\""
            : s;

    private static void Bump(Dictionary<int, long> d, int k)
    {
        if (k < 0) return;
        d[k] = d.TryGetValue(k, out var v) ? v + 1 : 1;
    }

    private static bool IsPlayType(int t) =>
        t == (int)ActionType.PlaySummon || t == (int)ActionType.CastSpell
        || t == (int)ActionType.PlayStage || t == (int)ActionType.CastTrap
        || t == (int)ActionType.PlaySupporter || t == (int)ActionType.ReplaceSummon;

    private static int Diff(string[] args)
    {
        string beforePath = Str(args, "--before", "");
        string afterPath = Str(args, "--after", "");
        int show = Int(args, "--top", 15);
        if (!File.Exists(beforePath) || !File.Exists(afterPath))
        {
            Console.Error.WriteLine("diff needs --before <cards.csv> --after <cards.csv>");
            return 2;
        }

        var before = Experiment.ReadCsv(beforePath);
        var after = Experiment.ReadCsv(afterPath);
        // card,name,colour,type,level,rarity,plays,lift,avg_turns,dead_rate,copies,decks
        var rows = new List<(string Id, string Name, double DLift, int DCopies, int DPlays, int Plays)>();
        foreach (var (id, row) in after)
        {
            if (!before.TryGetValue(id, out var old)) continue;
            double lift = Val(row, 7), oldLift = Val(old, 7);
            int copies = (int)Val(row, 10), oldCopies = (int)Val(old, 10);
            int plays = (int)Val(row, 6), oldPlays = (int)Val(old, 6);
            rows.Add((id, row[1], lift - oldLift, copies - oldCopies, plays - oldPlays, plays));
        }

        Console.WriteLine($"{Path.GetFileName(beforePath)} -> {Path.GetFileName(afterPath)}, "
            + $"{rows.Count} cards in both");
        Console.WriteLine();

        void Table(string title, IEnumerable<(string Id, string Name, double DLift, int DCopies,
            int DPlays, int Plays)> list)
        {
            Console.WriteLine(title);
            Console.WriteLine("   d lift  d copies  plays  card");
            foreach (var r in list)
            {
                Console.WriteLine($"  {r.DLift,7:+0.000;-0.000}  {r.DCopies,8:+0;-0;0}  {r.Plays,5}  {r.Name}");
            }
            Console.WriteLine();
        }

        var solid = rows.Where(r => r.Plays >= 25).ToList();
        Table("Gained the most deck slots:", rows.OrderByDescending(r => r.DCopies).Take(show));
        Table("Lost the most deck slots:", rows.OrderBy(r => r.DCopies).Take(show));
        Table("Lift moved up most (25+ plays):", solid.OrderByDescending(r => r.DLift).Take(show));
        Table("Lift moved down most (25+ plays):", solid.OrderBy(r => r.DLift).Take(show));
        Console.WriteLine("Two runs differ by their seed as well as by your card change, so a card");
        Console.WriteLine("moving on its own means little. Look for a card you changed moving, and");
        Console.WriteLine("for the cards around it moving the other way.");
        return 0;
    }

    private static double Val(string[] row, int i) =>
        i < row.Length && double.TryParse(row[i], System.Globalization.CultureInfo.InvariantCulture,
            out var v) ? v : 0;

    private static int CardReport(string[] args)
    {
        int show = Int(args, "--count", 20);
        Console.WriteLine($"{CardIndex.Count} cards on the convolution axis, "
            + $"{CardIndex.StaticChannels} static channels each");
        Console.WriteLine();
        Console.WriteLine("first cards in axis order, with the tags read off their text:");
        for (int c = 0; c < Math.Min(show, CardIndex.Count); c++)
        {
            var d = CardIndex.Def(c);
            Console.WriteLine($"  {c,3} {d.Id,-22} {d.Name,-24} {d.Color}{(d.Color2 is { } c2 ? c2.ToString() : "")} "
                + $"{d.Type,-6} L{d.Level} {CardIndex.Tags(c)}");
        }

        // A card whose cost asks for a colour its identity does not bring is
        // legal in a mono-colour deck and uncastable there, which is a trap the
        // deckbuilder cannot warn about. Found by watching generated decks fill
        // up with cards that never got played.
        Console.WriteLine();
        var stranded = new List<CardDef>();
        foreach (var d in CardIndex.Defs)
        {
            if (d.Art is null) continue;
            byte identity = CardIndex.MaskOf(Identity.ColorsOf(d));
            foreach (var col in Colors.All)
            {
                if (d.Cost[col] > 0 && (identity & (1 << (int)col)) == 0)
                {
                    stranded.Add(d);
                    break;
                }
            }
        }
        Console.WriteLine(stranded.Count == 0
            ? "every card can be paid for by a deck that is allowed to run it"
            : $"{stranded.Count} cards cost a colour their identity does not bring, so a deck "
              + "may run them and never cast them:");
        foreach (var d in stranded)
        {
            Console.WriteLine($"  {d.Id,-22} {d.Name,-24} identity "
                + $"{string.Join("", Identity.ColorsOf(d).Select(Colors.Letter))}  cost {d.Cost}");
        }
        return 0;
    }
}
