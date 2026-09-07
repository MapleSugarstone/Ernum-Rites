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
///   dotnet run --project csharp/Selatza.Sim -- versus --games 600 --decks random --mutate 1
/// </summary>
public static class Program
{
    public static int Main(string[] args)
    {
        CardSets.RegisterAll();
        // --mutate <seed> plays a fake version of the game: random stat changes,
        // random effects and new cards, applied before any deck or index is
        // built. A bot that holds its own here handles a balance patch it has
        // never seen.
        int mutate = ArgInt(args, "--mutate", 0);
        if (mutate > 0)
        {
            string changes = Mutate.Apply(mutate,
                ArgInt(args, "--mutate-stats", 30), ArgInt(args, "--mutate-effects", 15), ArgInt(args, "--mutate-new", 8));
            Directory.CreateDirectory("runs");
            string where = Path.Combine("runs", $"mutate-{mutate}.txt");
            File.WriteAllText(where, changes);
            Console.WriteLine(changes.Split('\n')[0] + $" (written to {where})");
        }
        var cmd = args.FirstOrDefault() ?? "sweep";
        int games = ArgInt(args, "--games", 50);
        string a = ArgStr(args, "--a", "deepcurrent");
        string b = ArgStr(args, "--b", "emberchoir");

        return cmd switch
        {
            "sweep" => Sweep(games),
            "duel" => Duel(games),
            "versus" => Versus(games, ArgInt(args, "--threads", Environment.ProcessorCount),
                ArgStr(args, "--decks", "random"), ArgStr(args, "--set", ""), ArgInt(args, "--seed", 1), Flag2(args, "--self"),
                Flag2(args, "--perfect"), ArgStr(args, "--read", ""), ArgStr(args, "--hand", ""), ArgStr(args, "--deck", ""), ArgStr(args, "--reply", "")),
            "tune" => Tune(games, ArgInt(args, "--rounds", 3),
                ArgInt(args, "--threads", Environment.ProcessorCount),
                ArgStr(args, "--only", ""), ArgStr(args, "--decks", "random")),
            "pair" => Pair(a, b, games, verbose: true),
            "record" => Record(games),
            "explain" => Explain(ArgStr(args, "--replay", "012-sweetshop-store.json"), ArgInt(args, "--step", 0), ArgStr(args, "--set", ""), ArgStr(args, "--then", "")),
            "analyze" => Analyze(ArgStr(args, "--replay", "replays/human"), ArgInt(args, "--seat", -1), ArgStr(args, "--set", ""),
                Flag2(args, "--deep"), ArgInt(args, "--top", 12)),
            "panel" => Panel(games, ArgInt(args, "--threads", Environment.ProcessorCount),
                ArgStr(args, "--decks", "random"), ArgStr(args, "--set", ""), ArgInt(args, "--seed", 1)),
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

    private static bool Flag2(string[] args, string name) => Array.IndexOf(args, name) >= 0;

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
                    // A weight standing at zero cannot be scaled off it, so it
                    // is stepped onto the scale instead.
                    double now = was == 0 ? (factor < 1 ? 0.3 : 0.6) : was * factor;
                    // Proportions cannot leave [0,1].
                    if (knob.Name == nameof(BotWeights.Reply)) now = Math.Clamp(now, 0.05, 1.0);
                    if (knob.Name == nameof(BotWeights.DebtCurve)) now = Math.Clamp(now, 0.0, 1.0);
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
    /// <summary>
    /// Leaders whose colours reach Candy, so a game on this pool holds shops and
    /// Love. The debt terms only speak where a debt-for-benefit trade exists, and
    /// a random deck from the whole set rarely offers one.
    /// </summary>
    private static readonly Lazy<List<string>> CandyLeaders = new(() =>
        DeckGen.LeaderCandidates(LeaderPool.Contested2)
            .Where(id => (CardIndex.IdentityOf(id) & (1 << (int)Color.K)) != 0)
            .ToList());

    /// <summary>
    /// Deck files in a folder, `runs/heldout` by default: the evolved decks of
    /// earlier runs, which carry the combos random decks rarely hold. The
    /// format is the trainer's decks.txt block.
    /// </summary>
    private static readonly Dictionary<string, List<DeckList>> Folders = new(StringComparer.Ordinal);

    /// <summary>The deck files in a folder, read once. `--decks dir:<folder>` names one; `heldout` is runs/heldout.</summary>
    private static List<DeckList> FolderDecks(string folder)
    {
        if (Folders.TryGetValue(folder, out var hit)) return hit;
        var decks = new List<DeckList>();
        Folders[folder] = decks;
        if (!Directory.Exists(folder)) return decks;
        foreach (var file in Directory.GetFiles(folder, "*.txt").OrderBy(f => f, StringComparer.Ordinal))
        {
            string leader = "";
            var cards = new List<string>();
            foreach (var raw in File.ReadAllLines(file))
            {
                var line = raw.Trim();
                int lb = line.IndexOf('['), rb = line.IndexOf(']');
                if (lb < 0 || rb < lb) continue;
                string id = line.Substring(lb + 1, rb - lb - 1);
                if (line.StartsWith("leader:", StringComparison.Ordinal))
                {
                    leader = id;
                    continue;
                }
                int x = line.IndexOf('x');
                if (x <= 0 || !int.TryParse(line[..x], out int n)) continue;
                for (int i = 0; i < n; i++) cards.Add(id);
            }
            if (leader.Length > 0 && cards.Count > 0)
            {
                decks.Add(new DeckList { Name = Path.GetFileNameWithoutExtension(file), LeaderId = leader, Cards = cards });
            }
        }
        return decks;
    }

    private static DeckList DeckFor(string pool, int game)
    {
        string? folder = pool == "heldout"
            ? Path.Combine("runs", "heldout")
            : pool.StartsWith("dir:", StringComparison.Ordinal) ? pool[4..] : null;
        if (folder is not null && FolderDecks(folder).Count > 0)
        {
            var list = FolderDecks(folder);
            var d = list[(game / 2) % list.Count];
            return new DeckList { Name = "A", LeaderId = d.LeaderId, Cards = d.Cards };
        }
        if (pool == "starters")
        {
            var starters = CardSets.Starters;
            var d = starters[(game / 2) % starters.Length];
            return d.ToDeckList("A");
        }
        // Seeded off the game index alone, so both weight sets in a comparison
        // are handed identical decks and the whole run reproduces.
        var rng = new Gauss(unchecked(50_021 + game * 6_361));
        string leader = pool == "candy"
            ? CandyLeaders.Value[rng.NextInt(CandyLeaders.Value.Count)]
            : DeckGen.RandomLeader(LeaderPool.All, rng);
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
            // The deck and the seed turn over half as fast as the seat, so every
            // game is played twice with the seats swapped and whatever a seat is
            // worth cancels exactly. This once indexed the deck by the game as
            // well, which the comment above it already denied, and a weight set
            // against its own copy read 45 percent that way.
            var d = decks[g / 2];
            int seatA = g % 2;
            Bot.ClearPlan();
            var other = new DeckList { Name = "B", LeaderId = d.LeaderId, Cards = d.Cards };
            var s = Engine.CreateGame(d, other, seed + (g / 2) * 7919);
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
    /// The current bot against the snapshot in <see cref="PreviousBot"/>, on
    /// the same decks and seeds with the seats alternating, so the deck and the
    /// seat are out of the comparison and only the change is left. This is the
    /// answer to "is the new bot better", measured rather than argued.
    /// </summary>
    private static int Versus(int games, int threads, string pool, string set, int seed, bool self, bool perfect = false,
        string read = "", string hand = "", string deck = "", string reply = "")
    {
        // --reply <width>,<depth>,<budget> sets the opponent model's beam for
        // the current bot, so its profile can be tuned against the snapshot.
        if (reply.Length > 0)
        {
            var parts = reply.Split(',');
            Bot.ReplyBeamWidth = int.Parse(parts[0]);
            Bot.ReplyDepth = int.Parse(parts[1]);
            Bot.ReplyBudget = int.Parse(parts[2]);
        }
        // --perfect hands the current bot the opponent's real hand, as the
        // snapshot always has, so the read can be measured on its own.
        // --read known fills the believed hand with named cards only, --read
        // sample fills it from the legal pool as it once did by default, and
        // --hand <chance>x<rolls> sets the hand peeks, so a read model can be
        // measured against another without a build.
        if (perfect) Bot.Intel = new Bot.ReadConfig { Perfect = true };
        if (read == "known") Bot.Intel = new Bot.ReadConfig { KnownOnly = true };
        if (read == "sample") Bot.Intel = new Bot.ReadConfig { KnownOnly = false };
        if (hand.Length > 0)
        {
            var parts = hand.Split('x');
            Bot.Intel.HandChance = double.Parse(parts[0], System.Globalization.CultureInfo.InvariantCulture);
            Bot.Intel.HandRolls = int.Parse(parts[1]);
        }
        // --deck <chance>x<rolls> sets the deck peeks the same way.
        if (deck.Length > 0)
        {
            var parts = deck.Split('x');
            Bot.Intel.DeckChance = double.Parse(parts[0], System.Globalization.CultureInfo.InvariantCulture);
            Bot.Intel.DeckRolls = int.Parse(parts[1]);
        }
        // --set Name=value,... overrides weights on the current side only, so a
        // new term can be measured with and without the search change it came
        // with: zero it here and what is left is the search.
        var current = new BotWeights();
        foreach (var pair in set.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var parts = pair.Split('=');
            var field = typeof(BotWeights).GetField(parts[0].Trim(),
                BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase)
                ?? throw new ArgumentException($"no weight named {parts[0]}");
            field.SetValue(current, double.Parse(parts[1], System.Globalization.CultureInfo.InvariantCulture));
        }
        var decks = new DeckList[games];
        for (int g = 0; g < games; g++) decks[g] = DeckFor(pool, g);
        var result = new MatchupResult();
        var gate = new object();
        // How often each bot runs its own Store or opens a haggle at the other's,
        // asked because a bot that never buys is not playing the Candy game.
        int useA = 0, openA = 0, useB = 0, openB = 0;
        var opts = new ParallelOptions { MaxDegreeOfParallelism = Math.Max(1, threads) };
        var sw = System.Diagnostics.Stopwatch.StartNew();

        // Paired: every deck and seed is played twice with the seats swapped,
        // so whatever the seat is worth cancels exactly and a bot against its
        // own copy scores 50 by construction. Alternating the seat game by game
        // over different decks did not: the snapshot against itself read 44.9
        // percent over 600 games that way.
        Parallel.For(0, games, opts, g =>
        {
            var d = decks[g / 2];
            int seatNow = g % 2;
            Bot.ClearPlan();
            PreviousBot.ClearPlan();
            var other = new DeckList { Name = "B", LeaderId = d.LeaderId, Cards = d.Cards };
            var s = Engine.CreateGame(d, other, 4_000_037 + seed * 104_729 + (g / 2) * 7919);
            int actions = 0;
            while (!s.IsOver && actions < 8000 && s.Turn < 400)
            {
                int actor = s.CurrentActor;
                var action = actor == seatNow && !self
                    ? Bot.ChooseAction(s, actor, current)
                    : PreviousBot.ChooseAction(s, actor);
                var res = Engine.Apply(s, actor, action);
                if (!res.Ok) break;
                if (action.Type == ActionType.UseStore) { if (actor == seatNow && !self) Interlocked.Increment(ref useA); else Interlocked.Increment(ref useB); }
                if (action.Type == ActionType.OpenStore) { if (actor == seatNow && !self) Interlocked.Increment(ref openA); else Interlocked.Increment(ref openB); }
                s = res.State!;
                actions++;
            }
            lock (gate)
            {
                if (s.Winner == seatNow) result.WinsA++;
                else if (s.Winner >= 0) result.WinsB++;
                else result.Draws++;
            }
        });

        Console.WriteLine($"current bot{(set.Length > 0 ? $" with {set}" : "")} versus the previous snapshot "
            + $"over {pool} decks, {games} games, {sw.Elapsed.TotalSeconds:0}s");
        Console.WriteLine($"  current {result.WinsA} - previous {result.WinsB} - drawn {result.Draws}");
        Console.WriteLine($"  current wins {result.RateA:P1}, 95% interval {result.Confidence95}"
            + (result.Decisive ? " (decisive)" : " (inside the noise)"));
        Console.WriteLine($"  stores: current ran its own {useA} times and opened the other side's {openA}; "
            + $"previous {useB} and {openB}, over {games} games");
        return 0;
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

    /// <summary>
    /// The C# bot's ranking at one step of a replay, printed the way
    /// scripts/botparity.ts can be made to print the TypeScript bot's, so a
    /// replay the two engines stop agreeing on can be lined up leaf by leaf.
    /// </summary>
    private static int Explain(string file, int stop, string set, string then)
    {
        var dir = Corpus.Directory();
        if (dir is null)
        {
            Console.WriteLine("no replay corpus found; run `record` first");
            return 1;
        }
        var replay = Replay.Load(Path.Combine(dir, file));
        var d = replay.Decks;
        var state = Engine.CreateGame(
            new DeckList { Name = d[0].Name, LeaderId = d[0].LeaderId, Cards = d[0].Cards },
            new DeckList { Name = d[1].Name, LeaderId = d[1].LeaderId, Cards = d[1].Cards },
            replay.Seed,
            replay.StartingPlayer);
        for (int i = 0; i < stop && i < replay.Steps.Count; i++)
        {
            var step = replay.Steps[i];
            // The bot decides every earlier step too, so the caches it fills
            // along the way hold what they held when the replay was recorded.
            Bot.ChooseAction(state, step.Actor);
            var res = Engine.Apply(state, step.Actor, Replays.ParseAction(step.Action));
            if (!res.Ok)
            {
                Console.WriteLine($"step {i} refused: {res.Error}");
                return 1;
            }
            state = res.State!;
        }
        var w = new BotWeights();
        foreach (var pair in set.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var parts = pair.Split('=');
            var field = typeof(BotWeights).GetField(parts[0].Trim(),
                BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase)
                ?? throw new ArgumentException($"no weight named {parts[0]}");
            field.SetValue(w, double.Parse(parts[1], System.Globalization.CultureInfo.InvariantCulture));
        }
        int seat = replay.Steps[stop].Actor;
        Console.WriteLine($"step {stop} turn {state.Turn} seat {seat}; recorded {replay.Steps[stop].Action}");
        // --then <action json> plays one more action for the seat first, to
        // look at the search from inside a line.
        if (then.Length > 0)
        {
            var doc = System.Text.Json.JsonDocument.Parse(then).RootElement;
            var extras = doc.ValueKind == System.Text.Json.JsonValueKind.Array
                ? doc.EnumerateArray().Select(Replays.ParseAction).ToList()
                : new List<GameAction> { Replays.ParseAction(doc) };
            state = Bot.Redacted(state, seat);
            int logFrom = state.Log.Count;
            foreach (var extra in extras)
            {
                var res = Engine.Apply(state, seat, extra);
                if (!res.Ok)
                {
                    Console.WriteLine($"then refused at {extra.Type}: {res.Error}");
                    return 1;
                }
                state = Bot.SettleFor(res.State!, w);
            }
            foreach (var entry in state.Log.Skip(logFrom)) Console.WriteLine("      log: " + entry.Text);
            for (int side = 0; side < state.Players.Length; side++)
            {
                var p = state.Players[side];
                Console.WriteLine($"      seat {side}: leader {p.Leader?.RemainingHp ?? 0} debt {p.DebtCount} hand {p.Hand.Count} mana {p.Supporters.Count(x => !x.Sapped)}/{p.Supporters.Count} slots " + string.Join(",", p.Slots.Select(x => x is null ? "-" : x.CardId + ":" + x.RemainingHp + (x.Sapped ? "*" : ""))));
            }
            Console.WriteLine($"      evaluate {Bot.Evaluate(state, seat, w):F2} pending {state.Pending?.GetType().Name ?? "-"} queues {state.ChoiceQueue.Count}/{state.FlipQueue.Count}/{state.ReplaceQueue.Count}");
            Console.WriteLine("      candidates " + string.Join(" | ", Bot.Candidates(state, seat, w)));
        }
        foreach (var line in Bot.Explain(state, seat, w)) Console.WriteLine("    " + line);
        return 0;
    }

    /// <summary>
    /// The styles a candidate is measured against, beside the snapshot. A bot
    /// tuned against one opponent learns that opponent's habits; a candidate
    /// ships only when it loses to none of these by more than noise.
    /// </summary>
    private static readonly (string Name, string Set)[] PanelArms =
    {
        ("blunt: the old reading, no held pieces, no counter, no turn-after", "KitPips=3,KitDebt=0,KitSolo=0,KitExposed=1,TrapHold=0,Peril=0,StandingDeath=0"),
        ("holder: pieces held for the kit, combo weighed double", "KitExposed=0.25,Combo=24"),
        ("defensive: the turn after the reply charged in full", "Peril=4,StandingDeath=60"),
        ("racer: threat and standing kill weighed double", "Threat=8,StandingKill=120"),
    };

    private static BotWeights WeightsFrom(string set)
    {
        var w = new BotWeights();
        foreach (var pair in set.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var parts = pair.Split('=');
            var field = typeof(BotWeights).GetField(parts[0].Trim(),
                BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase)
                ?? throw new ArgumentException($"no weight named {parts[0]}");
            field.SetValue(w, double.Parse(parts[1], System.Globalization.CultureInfo.InvariantCulture));
        }
        return w;
    }

    /// <summary>
    /// The candidate (the defaults, plus --set) against a panel of styles and
    /// the snapshot, each over the same decks. The snapshot arm is the paired
    /// measurement <see cref="Versus"/> makes; the style arms are the current
    /// bot with other weights in the other seat.
    /// </summary>
    private static int Panel(int games, int threads, string pool, string set, int seed)
    {
        var mine = WeightsFrom(set);
        Console.WriteLine($"panel: the candidate{(set.Length > 0 ? $" with {set}" : "")} over {pool} decks, {games} games an arm");
        var rows = new List<string>();
        bool shipped = true;
        var arms = new List<(string Name, BotWeights? Theirs)> { ("snapshot: the deployed bot", null) };
        foreach (var (name, armSet) in PanelArms) arms.Add((name, WeightsFrom(armSet)));
        foreach (var (name, theirs) in arms)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            var r = PanelArm(games, threads, pool, seed, mine, theirs);
            // Losing by more than the interval's half width is a loss; anything
            // inside it is noise.
            bool loses = r.WinsA + r.WinsB > 0 && r.RateA < 0.5 && r.Decisive;
            if (loses) shipped = false;
            rows.Add($"  {name,-64} {r.WinsA,4} - {r.WinsB,-4} drawn {r.Draws,-3} {r.RateA,6:P1} {r.Confidence95}{(loses ? "  LOSES" : "")}  {sw.Elapsed.TotalSeconds:0}s");
            Console.WriteLine(rows[^1]);
        }
        Console.WriteLine(shipped ? "  the candidate loses to no arm by more than noise" : "  the candidate loses to at least one arm: do not ship it on this alone");
        return shipped ? 0 : 1;
    }

    private static MatchupResult PanelArm(int games, int threads, string pool, int seed, BotWeights mine, BotWeights? theirs)
    {
        var decks = new DeckList[games];
        for (int g = 0; g < games; g++) decks[g] = DeckFor(pool, g);
        var result = new MatchupResult();
        var gate = new object();
        var opts = new ParallelOptions { MaxDegreeOfParallelism = Math.Max(1, threads) };
        Parallel.For(0, games, opts, g =>
        {
            var d = decks[g / 2];
            int seatNow = g % 2;
            Bot.ClearPlan();
            PreviousBot.ClearPlan();
            var other = new DeckList { Name = "B", LeaderId = d.LeaderId, Cards = d.Cards };
            var s = Engine.CreateGame(d, other, 4_000_037 + seed * 104_729 + (g / 2) * 7919);
            int actions = 0;
            while (!s.IsOver && actions < 8000 && s.Turn < 400)
            {
                int actor = s.CurrentActor;
                var action = actor == seatNow
                    ? Bot.ChooseAction(s, actor, mine)
                    : theirs is null ? PreviousBot.ChooseAction(s, actor) : Bot.ChooseAction(s, actor, theirs);
                var res = Engine.Apply(s, actor, action);
                if (!res.Ok) break;
                s = res.State!;
                actions++;
            }
            lock (gate)
            {
                if (s.Winner == seatNow) result.WinsA++;
                else if (s.Winner >= 0) result.WinsB++;
                else result.Draws++;
            }
        });
        return result;
    }

    /// <summary>
    /// Post-game analysis: every decision of a replay searched again and the
    /// played action scored against the best line found, over one replay file
    /// or a folder of them (the human game log pulls into replays/human).
    /// --seat picks one seat, or every seat when -1; a replay that names its
    /// bot seat labels the seats bot and person. --deep widens the reply beam
    /// and turns the turn-after charge on, so the label sees further than the
    /// bot did at the table. The report is regret per seat, the decisions
    /// where a kill was on the table and not taken, the played-against-best
    /// pairs behind the large gaps, and the largest gaps with their lines.
    /// </summary>
    private static int Analyze(string path, int seat, string set, bool deep, int top)
    {
        var files = Directory.Exists(path)
            ? Directory.GetFiles(path, "*.json").OrderBy(f => f, StringComparer.Ordinal).ToArray()
            : new[] { path };
        if (files.Length == 0)
        {
            Console.WriteLine($"no replays under {path}");
            return 1;
        }
        var w = WeightsFrom(set.Length > 0 ? set : deep ? "Peril=2,StandingDeath=60" : "");
        if (deep)
        {
            Bot.ReplyBeamWidth = 12;
            Bot.ReplyDepth = 8;
            Bot.ReplyBudget = 1500;
        }
        var rows = new List<(string File, int Step, int Turn, int Seat, string Who, Bot.Regret R)>();
        var sw = System.Diagnostics.Stopwatch.StartNew();
        foreach (var file in files)
        {
            var replay = Replay.Load(file);
            int botSeat = -1;
            using (var doc = System.Text.Json.JsonDocument.Parse(File.ReadAllText(file)))
            {
                if (doc.RootElement.TryGetProperty("log", out var log) && log.TryGetProperty("botSeat", out var bs)) botSeat = bs.GetInt32();
            }
            var d = replay.Decks;
            if (d.Count != 2) continue;
            var state = Engine.CreateGame(
                new DeckList { Name = d[0].Name, LeaderId = d[0].LeaderId, Cards = d[0].Cards },
                new DeckList { Name = d[1].Name, LeaderId = d[1].LeaderId, Cards = d[1].Cards },
                replay.Seed, replay.StartingPlayer);
            for (int i = 0; i < replay.Steps.Count; i++)
            {
                var step = replay.Steps[i];
                var action = Replays.ParseAction(step.Action);
                if (seat < 0 || step.Actor == seat)
                {
                    Bot.ClearPlan();
                    var r = Bot.RegretOf(state, step.Actor, action, w);
                    if (r is not null)
                    {
                        string who = botSeat < 0 ? $"seat {step.Actor}" : step.Actor == botSeat ? "bot" : "person";
                        rows.Add((Path.GetFileName(file), i, state.Turn, step.Actor, who, r));
                    }
                }
                var res = Engine.Apply(state, step.Actor, action);
                if (!res.Ok)
                {
                    Console.WriteLine($"  {Path.GetFileName(file)} step {i} refused: {res.Error}; the rest of the game is skipped");
                    break;
                }
                state = res.State!;
            }
        }
        Console.WriteLine($"analyzed {files.Length} replay(s), {rows.Count} decisions in {sw.Elapsed.TotalSeconds:0}s{(deep ? " (deep)" : "")}");
        foreach (var group in rows.GroupBy(r => r.Who).OrderBy(g => g.Key, StringComparer.Ordinal))
        {
            var gaps = group.Select(r => r.R.Gap).ToList();
            int big = gaps.Count(g => g >= 20);
            int huge = gaps.Count(g => g >= 60);
            int missed = group.Count(r => r.R.BestKills && !r.R.PlayedKills);
            Console.WriteLine($"  {group.Key,-8} {gaps.Count,5} decisions, mean gap {gaps.Average():F1}, {big} at 20 or more, {huge} at 60 or more, {missed} with a kill on the table not taken");
        }
        var pairs = rows.Where(r => r.R.Gap >= 20)
            .GroupBy(r => $"played {Head(r.R.PlayedAction)}, best {Head(r.R.BestLine)}")
            .OrderByDescending(g => g.Count()).Take(10);
        Console.WriteLine("  behind the gaps of 20 or more:");
        foreach (var g in pairs) Console.WriteLine($"    {g.Count(),4}  {g.Key}");
        Console.WriteLine($"  the {top} largest gaps:");
        foreach (var r in rows.OrderByDescending(r => r.R.Gap).Take(top))
        {
            Console.WriteLine($"    {r.R.Gap,7:F1}  {r.File} step {r.Step} turn {r.Turn} {r.Who}: played {r.R.PlayedAction}; best {r.R.BestLine}");
        }
        return 0;
    }

    /// <summary>The first action of a described line, or the whole of a one-action line.</summary>
    private static string Head(string line)
    {
        int cut = line.IndexOf(" ; ", StringComparison.Ordinal);
        string head = cut < 0 ? line : line[..cut];
        int paren = head.IndexOf('(');
        int space = head.IndexOf(' ');
        int end = paren < 0 ? space : space < 0 ? paren : Math.Min(paren, space);
        return end < 0 ? head : head[..end];
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
