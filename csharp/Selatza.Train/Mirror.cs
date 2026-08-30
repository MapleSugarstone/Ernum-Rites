using Selatza;
using Selatza.Ai;
using Selatza.Cards;
using Selatza.Learn;

namespace Selatza.Train;

/// <summary>
/// The same deck on both sides, to isolate the seat from the cards.
///
/// Any difference in a mirror is the turn order and nothing else, so this is
/// the only clean read on what going first is worth. It also counts the two
/// things that are easy to assume and hard to see: how often a leader actually
/// swings, and how often anyone attacks on their own first turn.
///
///   mirror --deck starter:emberchoir --games 4000
/// </summary>
public static class Mirror
{
    public static int Run(string[] args)
    {
        string spec = Arg(args, "--deck", "");
        int games = ArgInt(args, "--games", 4000);
        int seed = ArgInt(args, "--seed", 1);
        int threads = ArgInt(args, "--threads", Math.Max(1, Environment.ProcessorCount - 1));
        bool everyStarter = Array.IndexOf(args, "--every-deck") >= 0;

        CardSets.RegisterAll();
        CardIndex.EnsureBuilt();

        var decks = new List<Experiment.Deck>();
        if (everyStarter || spec.Length == 0)
        {
            foreach (var d in CardSets.All)
            {
                decks.Add(new Experiment.Deck { Name = d.Name, LeaderId = d.LeaderId, Cards = d.Cards.ToList() });
            }
        }
        else
        {
            try { decks.Add(Experiment.Load(spec)); }
            catch (Exception ex) when (ex is FileNotFoundException or InvalidDataException or KeyNotFoundException)
            {
                Console.Error.WriteLine(ex.Message);
                return 1;
            }
        }

        Console.WriteLine($"{decks.Count} deck(s), {games:N0} mirror games each\n");
        Console.WriteLine($"  {"deck",-24}{"P1 win",10}{"P2 win",10}{"turns",8}"
            + $"{"leader swings",15}{"1st-turn swings",17}");

        long totFirst = 0, totGames = 0, totLeader = 0, totOpening = 0, totAttacks = 0;
        foreach (var deck in decks)
        {
            var res = PlayMirror(deck, games, seed, threads);
            totFirst += res.FirstWins;
            totGames += res.Games;
            totLeader += res.LeaderAttacks;
            totOpening += res.OpeningAttacks;
            totAttacks += res.Attacks;
            Console.WriteLine($"  {Clip(deck.Name, 24),-24}{(double)res.FirstWins / res.Games,10:P1}"
                + $"{1 - (double)res.FirstWins / res.Games,10:P1}{(double)res.Turns / res.Games,8:F1}"
                + $"{(double)res.LeaderAttacks / res.Games,15:F2}{(double)res.OpeningAttacks / res.Games,17:F2}");
        }

        if (decks.Count > 1)
        {
            Console.WriteLine($"\n  {"all decks",-24}{(double)totFirst / totGames,10:P1}"
                + $"{1 - (double)totFirst / totGames,10:P1}{"",8}"
                + $"{(double)totLeader / totGames,15:F2}{(double)totOpening / totGames,17:F2}");
        }

        Console.WriteLine($"\n  {totAttacks:N0} attacks in total, {totLeader:N0} of them by a leader "
            + $"({(totAttacks > 0 ? (double)totLeader / totAttacks : 0):P1})");
        Console.WriteLine($"  {totOpening:N0} attacks on a player's own first turn "
            + $"({(totAttacks > 0 ? (double)totOpening / totAttacks : 0):P1})");
        double p1 = (double)totFirst / totGames;
        double se = Math.Sqrt(p1 * (1 - p1) / totGames);
        Console.WriteLine($"\n  going first is worth {p1:P2}, 95% interval "
            + $"{p1 - 1.96 * se:P2} to {p1 + 1.96 * se:P2} over {totGames:N0} games");
        return 0;
    }

    private readonly record struct Tally(long Games, long FirstWins, long Turns,
        long LeaderAttacks, long OpeningAttacks, long Attacks);

    private static Tally PlayMirror(Experiment.Deck deck, int games, int seed, int threads)
    {
        long firstWins = 0, turns = 0, leaderAttacks = 0, openingAttacks = 0, attacks = 0, decided = 0;
        var gate = new object();
        var opts = new ParallelOptions { MaxDegreeOfParallelism = Math.Max(1, threads) };

        Parallel.For(0, games, opts, g =>
        {
            // Alternate which seat starts so the seat, not the seed, is the variable.
            int starting = g % 2;
            var list = deck.ToList();
            var state = Engine.CreateGame(list, list, unchecked(seed + g * 104729), starting);

            long lAtk = 0, oAtk = 0, atk = 0;
            int steps = 0;
            while (!state.IsOver && steps++ < 4000)
            {
                int actor = state.CurrentActor;
                var action = Bot.ChooseAction(state, actor);
                if (action.Type == ActionType.DeclareAttack)
                {
                    atk++;
                    if (action.Source.Kind == TargetKind.Leader) lAtk++;
                    if (state.Players[actor].TurnsTaken <= 1) oAtk++;
                }
                var res = Engine.Apply(state, actor, action);
                if (!res.Ok) break;
                state = res.State!;
            }
            if (state.Winner < 0) return;

            lock (gate)
            {
                decided++;
                turns += state.Turn;
                attacks += atk;
                leaderAttacks += lAtk;
                openingAttacks += oAtk;
                // "First" means whoever was on the play in this game.
                if (state.Winner == starting) firstWins++;
            }
        });

        return new Tally(decided, firstWins, turns, leaderAttacks, openingAttacks, attacks);
    }

    private static string Clip(string s, int n) => s.Length <= n ? s : s[..(n - 1)] + "…";

    private static string Arg(string[] a, string name, string fallback)
    {
        int i = Array.IndexOf(a, name);
        return i >= 0 && i + 1 < a.Length ? a[i + 1] : fallback;
    }

    private static int ArgInt(string[] a, string name, int fallback) =>
        int.TryParse(Arg(a, name, ""), out var v) ? v : fallback;
}
