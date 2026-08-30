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
            "pair" => Pair(a, b, games, verbose: true),
            "record" => Record(games),
            "verify" => Verify(),
            "cards" => DumpCards(),
            _ => Usage(),
        };
    }

    private static int Usage()
    {
        Console.WriteLine("commands: sweep | pair | record | verify | cards");
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

    private sealed record Outcome(int Winner, string? Reason, int Turns);

    private static Outcome PlayOne(StarterDeck a, StarterDeck b, int seed)
    {
        var s = Engine.CreateGame(a.ToDeckList($"{a.Name} (P1)"), b.ToDeckList($"{b.Name} (P2)"), seed);
        int actions = 0;
        while (s.Winner < 0 && actions < 8000 && s.Turn < 400)
        {
            int actor = s.CurrentActor;
            var res = Engine.Apply(s, actor, Bot.ChooseAction(s, actor));
            if (!res.Ok) throw new InvalidOperationException($"illegal bot action turn {s.Turn}: {res.Error}");
            s = res.State!;
            actions++;
        }
        return new Outcome(s.Winner, s.WinReason, s.Turn);
    }

    private static int Pair(string aKey, string bKey, int games, bool verbose)
    {
        var a = CardSets.ByKey(aKey);
        var b = CardSets.ByKey(bKey);
        int winsA = 0, winsB = 0, stalls = 0, turns = 0;
        var reasons = new Dictionary<string, int>(StringComparer.Ordinal);

        for (int g = 0; g < games; g++)
        {
            var r = PlayOne(a, b, 1000 + g * 7919);
            turns += r.Turns;
            if (r.Winner == 0) winsA++;
            else if (r.Winner == 1) winsB++;
            else stalls++;
            var key = Classify(r.Reason);
            reasons[key] = reasons.GetValueOrDefault(key) + 1;
        }

        string pct(int n) => $"{(int)Math.Round(n * 100.0 / games),3}%";
        Console.WriteLine($"{aKey,-13}{pct(winsA)}  vs  {pct(winsB)} {bKey,-13} avg {turns / (double)games:0.0} turns"
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
