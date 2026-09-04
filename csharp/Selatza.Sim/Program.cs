using Selatza.Learn;
using Selatza.Learn.Nn;
using System.Reflection;
using System.Diagnostics;
using Selatza;
using Selatza.Ai;
using Selatza.Cards;

namespace Selatza.Sim;

/// <summary>
/// Bot-versus-bot batch runner and replay tool.
///
///   dotnet run --project csharp/Selatza.Sim -- sweep --games 200
///   dotnet run --project csharp/Selatza.Sim -- pair --a deepcurrent --b emberchoir --games 500
///   dotnet run --project csharp/Selatza.Sim -- record --games 12
///   dotnet run --project csharp/Selatza.Sim -- verify
/// </summary>
public static class Program
{
    public static int Main(string[] args)
    {
        CardSets.RegisterAll();
        var cmd = args.FirstOrDefault() ?? "sweep";
        int games = ArgInt(args, "--games", 50);
        string a = ArgStr(args, "--a", "deepcurrent");
        string b = ArgStr(args, "--b", "emberchoir");

        return cmd switch
        {
            "sweep" => Sweep(games),
            "duel" => Duel(games),
            "tune" => Tune(games, ArgInt(args, "--rounds", 3),
                ArgInt(args, "--threads", Environment.ProcessorCount),
                ArgStr(args, "--only", ""), ArgStr(args, "--decks", "random")),
            "pair" => Pair(a, b, games, verbose: true),
            "record" => Record(games),
            "verify" => Verify(),
            "cards" => DumpCards(),
            _ => Usage(),
        };
    }

    private static int Usage()
    {
        Console.WriteLine("commands: sweep | pair | record | verify | cards | tune");
        return 2;
    }

    private static string ArgStr(string[] args, string name, string fallback)
    {
        int i = Array.IndexOf(args, name);
        return i >= 0 && i + 1 < args.Length ? args[i + 1] : fallback;
    }

    private static int ArgInt(string[] args, string name, int fallback)
    {
        int i = Array.IndexOf(args, name);
        return i >= 0 && i + 1 < args.Length && int.TryParse(args[i + 1], out var v) ? v : fallback;
    }

    private sealed record Outcome(int Winner, string? Reason, int Turns, bool Drawn);

    private static Outcome PlayOne(StarterDeck a, StarterDeck b, int seed)
    {
        var s = Engine.CreateGame(a.ToDeckList($"{a.Name} (P1)"), b.ToDeckList($"{b.Name} (P2)"), seed);
        int actions = 0;
        // IsOver, not Winner: a drawn game leaves Winner at -1, and looping past
        // it made Apply refuse with "The game is already over."
        while (!s.IsOver && actions < 8000 && s.Turn < 400)
        {
            int actor = s.CurrentActor;
            var res = Engine.Apply(s, actor, Bot.ChooseAction(s, actor));
            if (!res.Ok) throw new InvalidOperationException($"illegal bot action turn {s.Turn}: {res.Error}");
            s = res.State!;
            actions++;
        }
        return new Outcome(s.Winner, s.WinReason, s.Turn, s.Drawn);
    }

    /// <summary>
    /// Hill-climbs the bot's weights against themselves.
    ///
    /// Every weight is a number somebody reasoned to, and reasoning is what the
    /// rest of this project refuses to accept as evidence. This plays candidate
    /// weights against the incumbent over mirror matches on matched seeds with
    /// the seats alternating, so the deck and the seat are out of the comparison
    /// and only the weights are left.
    ///
    /// A move is kept only when it clears the noise floor by the stated margin.
    /// With so many comparisons in a round some of what it keeps will be luck
    /// anyway, which is what the validation pass at the end is for: it replays
    /// the finished set against the defaults on seeds the tuning never saw.
    /// </summary>
    private static int Tune(int games, int rounds, int threads, string only, string pool)
    {
        // A run that names weights tunes only those. The long-standing ones are
        // already close to a local best, so re-deriving them costs hours to say
        // so again; the ones worth the machine are whichever were last added.
        var wanted = only.Length == 0
            ? null
            : new HashSet<string>(only.Split(',', StringSplitOptions.RemoveEmptyEntries)
                .Select(n => n.Trim()), StringComparer.OrdinalIgnoreCase);
        var knobs = typeof(BotWeights)
            .GetFields(BindingFlags.Public | BindingFlags.Instance)
            .Where(f => f.FieldType == typeof(double))
            .Where(f => wanted is null || wanted.Contains(f.Name))
            .ToArray();
        if (knobs.Length == 0)
        {
            Console.Error.WriteLine($"no weights match --only {only}");
            return 2;
        }

        var best = new BotWeights();
        double se = 50.0 / Math.Sqrt(games);
        double bar = 50 + 2 * se;
        Console.WriteLine($"tuning {knobs.Length} weights over {pool} decks, "
            + $"{games} games a comparison");
        Console.WriteLine($"one standard error is {se:0.00} points, so a move has to reach {bar:0.0}%\n");

        var sw = System.Diagnostics.Stopwatch.StartNew();
        for (int round = 1; round <= rounds; round++)
        {
            bool moved = false;
            foreach (var knob in knobs)
            {
                foreach (double factor in new[] { 0.6, 1.6 })
                {
                    var cand = CloneWeights(best, knobs);
                    double was = (double)knob.GetValue(best)!;
                    double now = was * factor;
                    // The reply share is a proportion, so it cannot leave [0,1].
                    if (knob.Name == nameof(BotWeights.Reply)) now = Math.Clamp(now, 0.05, 1.0);
                    if (Math.Abs(now - was) < 1e-9) continue;
                    knob.SetValue(cand, now);

                    var (wins, losses) = Match(cand, best, games, seed: 1000, threads, pool);
                    int decided = wins + losses;
                    double rate = decided == 0 ? 50 : wins * 100.0 / decided;
                    bool keep = rate >= bar;
                    Console.WriteLine($"  r{round} {knob.Name,-13} {was,7:0.###} -> {now,7:0.###}"
                        + $"  {wins,4}-{losses,-4} {rate,5:0.0}%  {(keep ? "kept" : "")}");
                    if (!keep) continue;
                    knob.SetValue(best, now);
                    moved = true;
                }
            }
            if (!moved)
            {
                Console.WriteLine($"\nround {round} moved nothing; stopping.");
                break;
            }
        }

        Console.WriteLine($"\ntuned weights after {sw.Elapsed.TotalSeconds:0}s:");
        // The whole set, not only what this run touched: a reader wants the
        // finished weights entire.
        foreach (var knob in typeof(BotWeights)
            .GetFields(BindingFlags.Public | BindingFlags.Instance)
            .Where(f => f.FieldType == typeof(double)))
        {
            double now = (double)knob.GetValue(best)!;
            double was = (double)knob.GetValue(BotWeights.Default)!;
            string mark = Math.Abs(now - was) < 1e-9 ? "" : $"   (was {was:0.###})";
            Console.WriteLine($"  {knob.Name,-13} {now,8:0.###}{mark}");
        }

        // Fresh seeds the hill-climb never saw. Anything it kept by luck has no
        // reason to survive this, which is the only part of the run worth
        // quoting.
        int check = games * 3;
        var (tw, tl) = Match(best, BotWeights.Default, check, seed: 987_001, threads, pool);
        int total = tw + tl;
        double final = total == 0 ? 50 : tw * 100.0 / total;
        double checkSe = 50.0 / Math.Sqrt(Math.Max(1, total));
        Console.WriteLine($"\nvalidation on unseen seeds: tuned {tw} - {tl} default"
            + $"  ({final:0.0}%, one standard error {checkSe:0.00})");
        Console.WriteLine(Math.Abs(final - 50) < 2 * checkSe
            ? "  inside the noise: the tuning did not find anything that holds up."
            : final > 50
                ? "  the tuned set is genuinely ahead."
                : "  the tuned set is genuinely behind. Keep the defaults.");
        return 0;
    }

    private static BotWeights CloneWeights(BotWeights src, FieldInfo[] knobs)
    {
        var copy = new BotWeights();
        foreach (var f in knobs) f.SetValue(copy, f.GetValue(src));
        return copy;
    }

    /// <summary>
    /// Two weight sets over the same decks and seeds, each taking both seats.
    /// </summary>
    /**
     * A deck for one game of the comparison.
     *
     * Both seats get the same one. That is the point: a mirror cancels deck
     * quality exactly, so a random deck costs nothing in noise and buys the one
     * thing the starters cannot give. There are five of those and they are value
     * decks, so a weight that only speaks when a combo is on the board never
     * gets a word in, and anything the sweep does to it is noise fitted to games
     * where the term never fired. Drawn from every leader the rules allow, which
     * is the same spread the tournaments use.
     */
    private static DeckList DeckFor(string pool, int game)
    {
        if (pool == "starters")
        {
            var starters = CardSets.Starters;
            var d = starters[(game / 2) % starters.Length];
            return d.ToDeckList("A");
        }
        // Seeded off the game index alone, so both weight sets in a comparison
        // are handed identical decks and the whole run reproduces.
        var rng = new Gauss(unchecked(50_021 + game * 6_361));
        string leader = DeckGen.RandomLeader(LeaderPool.All, rng);
        return new DeckList
        {
            Name = "A",
            LeaderId = leader,
            Cards = DeckGen.Random(leader, DeckShape.Default, rng),
        };
    }

    private static (int A, int B) Match(BotWeights a, BotWeights b, int games, int seed,
        int threads, string pool)
    {
        // Built up front and on one thread. The card index behind the deck
        // builder assembles itself lazily on first use and is not safe to race,
        // and the decks are identical for both weight sets in any case, so there
        // is nothing to gain by making each worker find its own.
        var decks = new DeckList[games];
        for (int g = 0; g < games; g++) decks[g] = DeckFor(pool, g);

        int aWins = 0, bWins = 0;
        var gate = new object();
        var opts = new ParallelOptions { MaxDegreeOfParallelism = Math.Max(1, threads) };

        Parallel.For(0, games, opts, g =>
        {
            // The deck turns over half as fast as the seat, so a deck is never
            // tied to a seat.
            var d = decks[g];
            int seatA = g % 2;
            Bot.ClearPlan();
            var other = new DeckList { Name = "B", LeaderId = d.LeaderId, Cards = d.Cards };
            var s = Engine.CreateGame(d, other, seed + g * 7919);
            int actions = 0;
            while (!s.IsOver && actions < 8000 && s.Turn < 400)
            {
                int actor = s.CurrentActor;
                var res = Engine.Apply(s, actor, Bot.ChooseAction(s, actor, actor == seatA ? a : b));
                if (!res.Ok) break;
                s = res.State!;
                actions++;
            }
            if (s.Winner < 0) return;
            lock (gate)
            {
                if (s.Winner == seatA) aWins++;
                else bWins++;
            }
        });
        return (aWins, bWins);
    }

    /// <summary>
    /// TEMPORARY: the searching bot against the pre-search one over the same
    /// seeds and the same decks, each taking both seats.
    /// </summary>
    private static int Duel(int games)
    {
        var decks = CardSets.Starters.ToList();
        int newWins = 0, oldWins = 0, stalls = 0, turns = 0;
        var sw = System.Diagnostics.Stopwatch.StartNew();

        for (int g = 0; g < games; g++)
        {
            // The mirror removes the deck from the comparison entirely, and the
            // seat alternates so neither bot keeps the advantage of going first.
            // The deck turns over half as fast as the seat, so a deck is never
            // tied to a seat however many decks there are.
            var d = decks[(g / 2) % decks.Count];
            int deep = g % 2;
            var s = Engine.CreateGame(d.ToDeckList("A"), d.ToDeckList("B"), 1000 + g * 7919);
            int actions = 0;
            while (!s.IsOver && actions < 8000 && s.Turn < 400)
            {
                int actor = s.CurrentActor;
                var action = actor == deep
                    ? Bot.ChooseAction(s, actor)
                    : LegacyBot.ChooseAction(s, actor);
                var res = Engine.Apply(s, actor, action);
                if (!res.Ok) throw new InvalidOperationException($"illegal action turn {s.Turn}: {res.Error}");
                s = res.State!;
                actions++;
            }
            turns += s.Turn;
            if (s.Winner < 0) stalls++;
            else if (s.Winner == deep) newWins++;
            else oldWins++;
        }

        int decided = newWins + oldWins;
        Console.WriteLine($"searching {newWins} - {oldWins} legacy over {games} mirror games"
            + $"  ({(decided > 0 ? newWins * 100.0 / decided : 0):0.0}% for the searching bot)"
            + $"  avg {turns / (double)games:0.0} turns"
            + (stalls > 0 ? $", {stalls} unresolved" : "")
            + $"  in {sw.Elapsed.TotalSeconds:0.0}s");
        return 0;
    }

    private static int Pair(string aKey, string bKey, int games, bool verbose)
    {
        var a = CardSets.ByKey(aKey);
        var b = CardSets.ByKey(bKey);
        int winsA = 0, winsB = 0, draws = 0, stalls = 0, turns = 0;
        var reasons = new Dictionary<string, int>(StringComparer.Ordinal);

        for (int g = 0; g < games; g++)
        {
            var r = PlayOne(a, b, 1000 + g * 7919);
            turns += r.Turns;
            if (r.Winner == 0) winsA++;
            else if (r.Winner == 1) winsB++;
            // A draw is a finished game, not a harness failure: only a game the
            // caps cut off counts as a stall and turns the exit code red.
            else if (r.Drawn) draws++;
            else stalls++;
            var key = Classify(r.Reason);
            reasons[key] = reasons.GetValueOrDefault(key) + 1;
        }

        string pct(int n) => $"{(int)Math.Round(n * 100.0 / games),3}%";
        Console.WriteLine($"{aKey,-13}{pct(winsA)}  vs  {pct(winsB)} {bKey,-13} avg {turns / (double)games:0.0} turns"
            + (draws > 0 ? $"  {draws} drawn" : "")
            + (stalls > 0 ? $"  {stalls} unresolved" : ""));
        if (verbose)
        {
            Console.WriteLine("             " + string.Join(", ",
                reasons.OrderByDescending(kv => kv.Value).Select(kv => $"{kv.Key} x{kv.Value}")));
        }
        return stalls > 0 ? 1 : 0;
    }

    private static string Classify(string? reason)
    {
        if (reason is null) return "unresolved";
        if (reason.Contains("leader", StringComparison.Ordinal)) return "lost their leader";
        if (reason.Contains("debt", StringComparison.Ordinal)) return $"reached {Rules.DebtLimit} debt";
        return reason;
    }

    private static int Sweep(int games)
    {
        var sw = Stopwatch.StartNew();
        var decks = CardSets.All;
        int bad = 0, total = 0;
        foreach (var a in decks)
        {
            foreach (var b in decks)
            {
                if (string.CompareOrdinal(a.Key, b.Key) > 0) continue;
                bad += Pair(a.Key, b.Key, games, verbose: false);
                total += games;
            }
        }
        Console.WriteLine();
        Console.WriteLine($"{total} games in {sw.ElapsedMilliseconds} ms "
            + $"({total * 1000.0 / Math.Max(1, sw.ElapsedMilliseconds):0} games/sec)");
        return bad;
    }

    /// <summary>
    /// Writes a corpus of replays that both engines re-run. Deterministic input
    /// means the corpus only changes when the rules change, which is exactly when
    /// you want to look at it.
    /// </summary>
    private static int Record(int games)
    {
        var dir = Corpus.Directory(create: true);
        if (dir is null)
        {
            Console.Error.WriteLine("could not locate the repository root");
            return 1;
        }
        // Matchup names move when the deck list does. Without this the corpus keeps
        // orphans from an older ruleset and verify checks them forever.
        foreach (var stale in Directory.GetFiles(dir, "*.json")) File.Delete(stale);
        var decks = CardSets.All;
        int written = 0;
        for (int i = 0; i < games; i++)
        {
            var a = decks[i % decks.Length];
            var b = decks[(i * 3 + 1) % decks.Length];
            int seed = 20000 + i * 104729;
            var label = $"{a.Key}-vs-{b.Key}-{seed}";
            var replay = Recorder.RecordBotGame(a, b, seed, label);
            var path = Path.Combine(dir, $"{i:D3}-{a.Key}-{b.Key}.json");
            File.WriteAllText(path, Recorder.ToJson(replay));
            written++;
        }
        // One game that provably haggles, so the store negotiation stays in the
        // parity corpus: scan seeds of the Candy mirror until a purchase closes.
        var shop = Array.Find(decks, d => d.Key == "sweetshop");
        if (shop is not null)
        {
            for (int probe = 0; probe < 400; probe++)
            {
                int seed = 91000 + probe * 7919;
                var replay = Recorder.RecordBotGame(shop, shop, seed, $"sweetshop-store-{seed}");
                bool haggled = replay.Steps.Any(s =>
                    s.Action.TryGetProperty("type", out var t) && t.GetString() == "STORE_ACCEPT");
                if (!haggled) continue;
                File.WriteAllText(Path.Combine(dir, $"{written:D3}-sweetshop-store.json"),
                    Recorder.ToJson(replay));
                written++;
                Console.WriteLine($"store game found after {probe + 1} seed(s)");
                break;
            }
        }
        Console.WriteLine($"wrote {written} replays to {dir}");
        return 0;
    }

    private static int DumpCards()
    {
        var dir = Corpus.ConformanceDirectory(create: true);
        if (dir is null)
        {
            Console.Error.WriteLine("could not locate the repository root");
            return 1;
        }
        var path = Path.Combine(dir, "cards.json");
        File.WriteAllText(path, Manifest.Build());
        Console.WriteLine($"wrote {Registry.All.Count(c => c.Art is not null)} card definitions to {path}");
        return 0;
    }

    private static int Verify()
    {
        var dir = Corpus.Directory();
        if (dir is null)
        {
            Console.WriteLine("no replay corpus found; run `record` first");
            return 0;
        }
        var files = Directory.GetFiles(dir, "*.json").OrderBy(f => f, StringComparer.Ordinal).ToArray();
        var sw = Stopwatch.StartNew();
        int bad = 0;
        foreach (var file in files)
        {
            var replay = Replay.Load(file);
            var res = Replays.Verify(replay);
            if (!res.Ok)
            {
                bad++;
                Console.WriteLine($"  FAIL {Path.GetFileName(file)} step {res.StepIndex}: {res.Detail}");
            }
        }
        Console.WriteLine(bad == 0
            ? $"  {files.Length} replays verified in {sw.ElapsedMilliseconds} ms"
            : $"  {bad} of {files.Length} replays failed");
        return bad == 0 ? 0 : 1;
    }
}
