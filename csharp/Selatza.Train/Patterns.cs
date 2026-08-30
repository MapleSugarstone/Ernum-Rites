using Selatza;
using Selatza.Cards;
using Selatza.Learn;

namespace Selatza.Train;

/// <summary>
/// Why a colour wins, read off a recorded run.
///
/// The ladder says which decks are strong and the card report says which cards
/// correlate with winning. Neither says what the deck is doing. These walk the
/// board snapshots instead: how long bodies stay up, how many attacks they eat
/// before they go, how much debt that costs, and how far into the game the
/// board is still full.
/// </summary>
public static class Patterns
{
    private const int MaxTurn = 24;

    private sealed class Side
    {
        public long Games, Wins, Turns, Debt, DeckOuts, DebtWins, LeaderWins;
        public readonly long[] BodiesByTurn = new long[MaxTurn];
        public readonly long[] SeenByTurn = new long[MaxTurn];
        public long HandSum, DeckSum, Samples;
    }

    private sealed class CardStat
    {
        public long BoardTurns;      // turns this card spent standing in a slot
        public long Appearances;     // games it stood in a slot at all
        public long Spans;           // separate stints on the board
        public long AttacksTaken;    // times it was the target of an attack
        public long Enthralled;      // times it was the target of any power
        public long Played;
    }

    public static int Run(string[] args)
    {
        string path = Arg(args, "--log", "");
        if (!File.Exists(path))
        {
            Console.Error.WriteLine("patterns needs --log <file written by --log-games>");
            return 2;
        }
        int top = ArgInt(args, "--top", 18);
        string only = Arg(args, "--colour", Arg(args, "--color", ""));

        using var r = new GameLogReader(path);
        string Name(int i) => i >= 0 && i < r.Cards.Length
            ? Registry.Card(r.Cards[i])?.Name ?? r.Cards[i] : "-";

        // A game is attributed to each seat's leader colour, so a game between
        // an Oil deck and a Robot deck counts once for each.
        var byColour = new Dictionary<string, Side>(StringComparer.Ordinal);
        var cards = new Dictionary<int, CardStat>();
        var cardColour = new Dictionary<int, string>();

        // Tracked per slot, not per card. A Slime that dies and is replaced by
        // the Slime its deathrattle makes occupies the slot again as a new body,
        // and counting that as one long stint would hide the whole mechanic.
        var standing = new Dictionary<(int Seat, int Slot), int>();
        var seenThisGame = new HashSet<(int Seat, int Card)>();
        long games = 0;

        while (r.NextGame(out var head))
        {
            games++;
            string colA = ColourOf(r.Cards, head.LeaderA);
            string colB = ColourOf(r.Cards, head.LeaderB);
            standing.Clear();
            seenThisGame.Clear();
            var perSide = new[] { new Side(), new Side() };
            var localCards = new Dictionary<(int Seat, int Card), CardStat>();

            LogItem item;
            LogEvent e;
            while ((item = r.Next(out e)) != LogItem.End)
            {
                if (item == LogItem.Snapshot)
                {
                    int t = Math.Min(r.SnapTurn, MaxTurn - 1);
                    for (int seat = 0; seat < 2; seat++)
                    {
                        var snap = r.Snap[seat];
                        perSide[seat].BodiesByTurn[t] += snap.Bodies;
                        perSide[seat].SeenByTurn[t]++;
                        perSide[seat].HandSum += snap.Hand;
                        perSide[seat].DeckSum += snap.Deck;
                        perSide[seat].Samples++;
                        perSide[seat].Debt = snap.Debt;
                        perSide[seat].DeckOuts = snap.DeckOuts;

                        for (int slot = 0; slot < snap.Slots.Length; slot++)
                        {
                            int c = snap.Slots[slot];
                            var where = (seat, slot);
                            standing.TryGetValue(where, out int wasThere);
                            if (c < 0)
                            {
                                standing.Remove(where);
                                continue;
                            }
                            var cs = Get(cards, c);
                            cs.BoardTurns++;
                            if (seenThisGame.Add((seat, c))) cs.Appearances++;
                            // A different card in this slot, or an empty slot
                            // last turn, means a body arrived.
                            if (!standing.ContainsKey(where) || wasThere != c) cs.Spans++;
                            standing[where] = c;
                        }
                    }
                    continue;
                }

                if (e.Card >= 0 && IsPlay(e.Type)) Get(cards, e.Card).Played++;
                if (e.Type == (int)ActionType.DeclareAttack && e.TargetCount > 0
                    && r.Targets[0].Card >= 0)
                {
                    Get(cards, r.Targets[0].Card).AttacksTaken++;
                }
                if (e.Type == (int)ActionType.ActivatePower)
                {
                    for (int i = 0; i < e.TargetCount; i++)
                    {
                        if (r.Targets[i].Card >= 0) Get(cards, r.Targets[i].Card).Enthralled++;
                    }
                }
            }

            var tail = r.EndGame();
            for (int seat = 0; seat < 2; seat++)
            {
                string col = seat == 0 ? colA : colB;
                if (only.Length > 0 && !col.Contains(only, StringComparison.OrdinalIgnoreCase)) continue;
                var side = SideFor(byColour, col);
                side.Games++;
                side.Turns += tail.Turns;
                side.Debt += perSide[seat].Debt;
                side.DeckOuts += perSide[seat].DeckOuts;
                side.HandSum += perSide[seat].HandSum;
                side.DeckSum += perSide[seat].DeckSum;
                side.Samples += perSide[seat].Samples;
                for (int t = 0; t < MaxTurn; t++)
                {
                    side.BodiesByTurn[t] += perSide[seat].BodiesByTurn[t];
                    side.SeenByTurn[t] += perSide[seat].SeenByTurn[t];
                }
                if (tail.Winner == seat)
                {
                    side.Wins++;
                    if (tail.Reason == 1) side.DebtWins++;
                    else if (tail.Reason == 2) side.LeaderWins++;
                }
            }
            _ = localCards;
        }

        Console.WriteLine($"{games:N0} games\n");
        Console.WriteLine($"  {"colour",-8}{"games",9}{"win",8}{"turns",8}{"end debt",10}{"deck-outs",11}{"hand",7}{"deck",7}");
        foreach (var kv in byColour.OrderByDescending(k => (double)k.Value.Wins / Math.Max(1, k.Value.Games)))
        {
            var s = kv.Value;
            double g = Math.Max(1, s.Games), n = Math.Max(1, s.Samples);
            Console.WriteLine($"  {kv.Key,-8}{s.Games,9:N0}{(double)s.Wins / g,8:P1}{s.Turns / g,8:F1}"
                + $"{s.Debt / g,10:F1}{s.DeckOuts / g,11:F2}{s.HandSum / n,7:F1}{s.DeckSum / n,7:F1}");
        }

        Console.WriteLine($"\n  bodies standing, by turn");
        Console.Write($"  {"colour",-8}");
        for (int t = 1; t <= 10; t++) Console.Write($"{"t" + t,6}");
        Console.WriteLine();
        foreach (var kv in byColour.OrderBy(k => k.Key, StringComparer.Ordinal))
        {
            Console.Write($"  {kv.Key,-8}");
            for (int t = 1; t <= 10; t++)
            {
                var s = kv.Value;
                double d = s.SeenByTurn[t] > 0 ? (double)s.BodiesByTurn[t] / s.SeenByTurn[t] : 0;
                Console.Write($"{d,6:F2}");
            }
            Console.WriteLine();
        }

        // Persistence is the whole question behind "free delay": a body that
        // keeps coming back shows up as many stints over few games.
        Console.WriteLine($"\n  {"card",-24}{"col",5}{"board-turns",12}{"stints/game",13}{"turns/stint",13}{"attacks eaten",15}");
        var ranked = cards.Where(c => c.Value.Appearances >= Math.Max(20, games / 500))
            .OrderByDescending(c => (double)c.Value.BoardTurns / Math.Max(1, c.Value.Appearances))
            .Take(top);
        foreach (var kv in ranked)
        {
            var c = kv.Value;
            double app = Math.Max(1, c.Appearances);
            Console.WriteLine($"  {Name(kv.Key),-24}{ColourOf(r.Cards, kv.Key),5}{c.BoardTurns,12:N0}"
                + $"{c.Spans / app,13:F2}{(double)c.BoardTurns / Math.Max(1, c.Spans),13:F2}"
                + $"{c.AttacksTaken / app,15:F2}");
        }

        string[] suspects = Arg(args, "--suspects", "Slime,Skeleton").Split(',',
            StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (suspects.Length > 0)
        {
            Console.WriteLine($"\n  {"suspect",-24}{"games seen",12}{"board-turns",13}{"stints/game",13}{"turns/stint",13}{"attacks eaten",15}");
            foreach (var want in suspects)
            {
                foreach (var kv in cards)
                {
                    if (!string.Equals(Name(kv.Key), want, StringComparison.OrdinalIgnoreCase)) continue;
                    var c = kv.Value;
                    double app = Math.Max(1, c.Appearances);
                    Console.WriteLine($"  {Name(kv.Key),-24}{c.Appearances,12:N0}{c.BoardTurns,13:N0}"
                        + $"{c.Spans / app,13:F2}{(double)c.BoardTurns / Math.Max(1, c.Spans),13:F2}"
                        + $"{c.AttacksTaken / app,15:F2}");
                }
            }
        }
        return 0;
    }

    private static CardStat Get(Dictionary<int, CardStat> d, int k)
    {
        if (!d.TryGetValue(k, out var v)) d[k] = v = new CardStat();
        return v;
    }

    private static Side SideFor(Dictionary<string, Side> d, string k)
    {
        if (!d.TryGetValue(k, out var v)) d[k] = v = new Side();
        return v;
    }

    /// <summary>The colour letters a card carries, as printed on it.</summary>
    private static string ColourOf(string[] ids, int index)
    {
        if (index < 0 || index >= ids.Length) return "-";
        var def = Registry.TryCard(ids[index]);
        if (def is null) return "-";
        var s = "";
        foreach (var c in new[] { def.Color, def.Color2, def.Color3 })
        {
            if (c is { } col) s += col.ToString();
        }
        return s.Length == 0 ? "N" : s;
    }

    private static bool IsPlay(int t) =>
        t == (int)ActionType.PlaySummon || t == (int)ActionType.CastSpell
        || t == (int)ActionType.PlayStage || t == (int)ActionType.CastTrap
        || t == (int)ActionType.PlaySupporter || t == (int)ActionType.ReplaceSummon;

    private static string Arg(string[] a, string name, string fallback)
    {
        int i = Array.IndexOf(a, name);
        return i >= 0 && i + 1 < a.Length ? a[i + 1] : fallback;
    }

    private static int ArgInt(string[] a, string name, int fallback) =>
        int.TryParse(Arg(a, name, ""), out var v) ? v : fallback;
}
