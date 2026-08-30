using System.Globalization;
using Selatza;
using Selatza.Learn;

namespace Selatza.Train;

/// <summary>
/// Ask a recorded run a question without writing any code.
///
/// Every earlier report here was a hard-coded answer to one question, which
/// meant the next question cost a rebuild. This flattens a log into rows and
/// gives them a filter, a group-by and a metric, so a new question is a new
/// command line.
///
///   query --log runs/m1/games.szgl --select target --where power=Enthrall
///   query --log runs/m1/games.szgl --select card --where type=CastSpell --metric winrate
///   query --log runs/m1/games.szgl --from games --select colour --by reason
/// </summary>
public static class Query
{
    private sealed class Row
    {
        public readonly Dictionary<string, string> S = new(StringComparer.OrdinalIgnoreCase);
        public readonly Dictionary<string, double> N = new(StringComparer.OrdinalIgnoreCase);
        public void Put(string k, string v) => S[k] = v;
        public void Put(string k, double v)
        {
            N[k] = v;
            S[k] = v.ToString("0.##", CultureInfo.InvariantCulture);
        }
    }

    private sealed record Cond(string Field, string Op, string Value, double Num);

    private sealed class Bucket
    {
        public long Count;
        public long Wins;
        public double Sum;
        public long SumN;
    }

    private static readonly string[] EventFields =
    {
        "actor", "type", "turn", "card", "cardcol", "cardlevel", "power", "target", "targetcol",
        "targetkind", "targetside", "won", "reason", "leader", "colour", "opp", "oppcolour", "turns",
    };
    private static readonly string[] GameFields =
    {
        "leader", "colour", "opp", "oppcolour", "won", "reason", "turns", "name", "seat", "actions",
    };
    private static readonly string[] BoardFields =
    {
        "turn", "debt", "hand", "deck", "discard", "deckouts", "bodies", "slot", "slotcol",
        "supporters", "leaderhp", "leader", "colour", "won", "reason", "turns",
    };

    public static int Run(string[] args)
    {
        string path = Arg(args, "--log", "");
        string from = Arg(args, "--from", "events").ToLowerInvariant();
        string select = Arg(args, "--select", "");
        string by = Arg(args, "--by", "");
        string metric = Arg(args, "--metric", "count").ToLowerInvariant();
        string where = Arg(args, "--where", "");
        int top = ArgInt(args, "--top", 20);
        string csv = Arg(args, "--csv", "");
        bool listFields = Array.IndexOf(args, "--fields") >= 0;

        var fields = from switch
        {
            "games" => GameFields,
            "boards" => BoardFields,
            _ => EventFields,
        };
        if (listFields)
        {
            Console.WriteLine($"fields for --from {from}:");
            Console.WriteLine("  " + string.Join("  ", fields));
            Console.WriteLine("\nmetrics: count | winrate | avg:<field> | share");
            Console.WriteLine("where:   field=value, field!=value, field>n, field<n, comma-separated (all must hold)");
            return 0;
        }
        if (!File.Exists(path))
        {
            Console.Error.WriteLine("query needs --log <file written by --log-games>");
            return 2;
        }
        if (select.Length == 0)
        {
            Console.Error.WriteLine("query needs --select <field>. Try --fields to see them.");
            return 2;
        }

        var conds = ParseWhere(where);
        foreach (var c in conds.Concat(new[] { new Cond(select, "=", "", 0) })
                     .Concat(by.Length > 0 ? new[] { new Cond(by, "=", "", 0) } : Array.Empty<Cond>()))
        {
            if (!fields.Contains(c.Field, StringComparer.OrdinalIgnoreCase))
            {
                Console.Error.WriteLine($"unknown field \"{c.Field}\" for --from {from}. Try --fields.");
                return 2;
            }
        }
        string avgOf = metric.StartsWith("avg:", StringComparison.Ordinal) ? metric[4..] : "";

        using var r = new GameLogReader(path);
        var buckets = new Dictionary<(string A, string B), Bucket>();
        StreamWriter? dump = csv.Length > 0 ? new StreamWriter(csv) : null;
        if (dump is not null) dump.WriteLine(string.Join(",", fields));

        long rows = 0, kept = 0;
        foreach (var row in Rows(r, from))
        {
            rows++;
            bool ok = true;
            foreach (var c in conds)
            {
                if (!Match(row, c)) { ok = false; break; }
            }
            if (!ok) continue;
            kept++;

            if (dump is not null)
            {
                dump.WriteLine(string.Join(",", fields.Select(f => Csv(Get(row, f)))));
            }

            var key = (Get(row, select), by.Length > 0 ? Get(row, by) : "");
            if (!buckets.TryGetValue(key, out var b)) buckets[key] = b = new Bucket();
            b.Count++;
            if (row.N.TryGetValue("won", out var w) && w > 0.5) b.Wins++;
            if (avgOf.Length > 0 && row.N.TryGetValue(avgOf, out var v)) { b.Sum += v; b.SumN++; }
        }
        dump?.Dispose();

        Console.WriteLine($"{rows:N0} {from} rows, {kept:N0} matched"
            + (where.Length > 0 ? $" ({where})" : ""));
        Console.WriteLine();

        var ordered = buckets.OrderByDescending(k => metric switch
        {
            "winrate" => k.Value.Count > 0 ? (double)k.Value.Wins / k.Value.Count : 0,
            _ when avgOf.Length > 0 => k.Value.SumN > 0 ? k.Value.Sum / k.Value.SumN : 0,
            _ => k.Value.Count,
        }).Take(top).ToList();

        string head = by.Length > 0 ? $"{select} / {by}" : select;
        string metricHead = metric switch
        {
            "winrate" => "win%",
            "share" => "share",
            _ when avgOf.Length > 0 => $"avg {avgOf}",
            _ => "count",
        };
        bool plainCount = metric == "count" && avgOf.Length == 0;
        Console.WriteLine(plainCount
            ? $"  {head,-34}{"count",10}"
            : $"  {head,-34}{"count",10}{metricHead,12}");
        long total = buckets.Values.Sum(b => b.Count);
        foreach (var kv in ordered)
        {
            var b = kv.Value;
            string label = kv.Key.B.Length > 0 ? $"{kv.Key.A} / {kv.Key.B}" : kv.Key.A;
            string val = metric switch
            {
                "winrate" => b.Count > 0 ? ((double)b.Wins / b.Count).ToString("P1") : "-",
                "share" => total > 0 ? ((double)b.Count / total).ToString("P1") : "-",
                _ when avgOf.Length > 0 => b.SumN > 0
                    ? (b.Sum / b.SumN).ToString("0.00", CultureInfo.InvariantCulture) : "-",
                _ => "",
            };
            Console.WriteLine(plainCount
                ? $"  {Clip(label, 34),-34}{b.Count,10:N0}"
                : $"  {Clip(label, 34),-34}{b.Count,10:N0}{val,12}");
        }
        if (buckets.Count > ordered.Count)
        {
            Console.WriteLine($"  … {buckets.Count - ordered.Count:N0} more groups");
        }
        if (csv.Length > 0) Console.WriteLine($"\nwrote {csv}");
        return 0;
    }

    /// <summary>Flattens the log into the row shape the query asked for.</summary>
    private static IEnumerable<Row> Rows(GameLogReader r, string from)
    {
        string Name(int i) => i >= 0 && i < r.Cards.Length
            ? Registry.TryCard(r.Cards[i])?.Name ?? r.Cards[i] : "-";
        string Col(int i) => ColourOf(r.Cards, i);
        int Level(int i) => i >= 0 && i < r.Cards.Length
            ? Registry.TryCard(r.Cards[i])?.Level ?? 0 : 0;

        var pending = new List<Row>();
        var boards = new List<Row>();

        while (r.NextGame(out var head))
        {
            pending.Clear();
            boards.Clear();
            int actions = 0;

            LogItem item;
            LogEvent e;
            while ((item = r.Next(out e)) != LogItem.End)
            {
                if (item == LogItem.Snapshot)
                {
                    if (from != "boards") continue;
                    for (int seat = 0; seat < 2; seat++)
                    {
                        var snap = r.Snap[seat];
                        // One row per occupied slot, plus one for an empty board,
                        // so counting rows counts bodies.
                        var slots = snap.Slots.Where(c => c >= 0).ToArray();
                        foreach (var c in slots.DefaultIfEmpty(-1))
                        {
                            var row = new Row();
                            row.Put("turn", r.SnapTurn);
                            row.Put("debt", snap.Debt);
                            row.Put("hand", snap.Hand);
                            row.Put("deck", snap.Deck);
                            row.Put("discard", snap.Discard);
                            row.Put("deckouts", snap.DeckOuts);
                            row.Put("bodies", snap.Bodies);
                            row.Put("slot", c >= 0 ? Name(c) : "(empty)");
                            row.Put("slotcol", c >= 0 ? Col(c) : "-");
                            row.Put("supporters", snap.SupporterCount);
                            row.Put("leaderhp", snap.LeaderHp);
                            row.Put("leader", Name(seat == 0 ? head.LeaderA : head.LeaderB));
                            row.Put("colour", Col(seat == 0 ? head.LeaderA : head.LeaderB));
                            row.N["__seat"] = seat;
                            boards.Add(row);
                        }
                    }
                    continue;
                }

                actions++;
                if (from != "events") continue;
                int n = Math.Max(1, e.TargetCount);
                for (int i = 0; i < n; i++)
                {
                    bool has = i < e.TargetCount;
                    var row = new Row();
                    row.Put("actor", "p" + e.Actor);
                    row.Put("type", ((ActionType)e.Type).ToString());
                    row.Put("turn", e.Turn);
                    row.Put("card", Name(e.Card));
                    row.Put("cardcol", Col(e.Card));
                    row.Put("cardlevel", Level(e.Card));
                    row.Put("power", e.PowerSlot >= 0
                        && r.Powers.TryGetValue((e.Card, e.PowerSlot), out var pn) ? pn : "");
                    row.Put("target", has ? Name(r.Targets[i].Card) : "");
                    row.Put("targetcol", has ? Col(r.Targets[i].Card) : "-");
                    row.Put("targetkind", has ? ((TargetKind)r.Targets[i].Kind).ToString() : "");
                    row.Put("targetside", has
                        ? (r.Targets[i].Player == e.Actor ? "self" : "enemy") : "");
                    row.Put("leader", Name(e.Actor == 0 ? head.LeaderA : head.LeaderB));
                    row.Put("colour", Col(e.Actor == 0 ? head.LeaderA : head.LeaderB));
                    row.Put("opp", Name(e.Actor == 0 ? head.LeaderB : head.LeaderA));
                    row.Put("oppcolour", Col(e.Actor == 0 ? head.LeaderB : head.LeaderA));
                    row.N["__seat"] = e.Actor;
                    pending.Add(row);
                }
            }

            var tail = r.EndGame();
            string reason = tail.Reason switch
            {
                1 => "debt", 2 => "leader", 3 => "other", _ => "unfinished",
            };

            if (from == "games")
            {
                for (int seat = 0; seat < 2; seat++)
                {
                    var row = new Row();
                    row.Put("leader", Name(seat == 0 ? head.LeaderA : head.LeaderB));
                    row.Put("colour", Col(seat == 0 ? head.LeaderA : head.LeaderB));
                    row.Put("opp", Name(seat == 0 ? head.LeaderB : head.LeaderA));
                    row.Put("oppcolour", Col(seat == 0 ? head.LeaderB : head.LeaderA));
                    row.Put("name", seat == 0 ? head.NameA : head.NameB);
                    row.Put("seat", seat);
                    row.Put("won", tail.Winner == seat ? 1 : 0);
                    row.Put("reason", reason);
                    row.Put("turns", tail.Turns);
                    row.Put("actions", actions);
                    yield return row;
                }
                continue;
            }

            foreach (var row in from == "boards" ? boards : pending)
            {
                int seat = (int)row.N["__seat"];
                row.Put("won", tail.Winner == seat ? 1 : 0);
                row.Put("reason", reason);
                row.Put("turns", tail.Turns);
                yield return row;
            }
        }
    }

    private static List<Cond> ParseWhere(string where)
    {
        var list = new List<Cond>();
        if (where.Length == 0) return list;
        foreach (var part in where.Split(',', StringSplitOptions.RemoveEmptyEntries
                                             | StringSplitOptions.TrimEntries))
        {
            foreach (var op in new[] { ">=", "<=", "!=", "=", ">", "<" })
            {
                int at = part.IndexOf(op, StringComparison.Ordinal);
                if (at <= 0) continue;
                string f = part[..at].Trim();
                string v = part[(at + op.Length)..].Trim();
                double.TryParse(v, NumberStyles.Any, CultureInfo.InvariantCulture, out double num);
                list.Add(new Cond(f, op, v, num));
                break;
            }
        }
        return list;
    }

    private static bool Match(Row row, Cond c)
    {
        bool numeric = row.N.TryGetValue(c.Field, out double n);
        string s = Get(row, c.Field);
        return c.Op switch
        {
            "=" => string.Equals(s, c.Value, StringComparison.OrdinalIgnoreCase),
            "!=" => !string.Equals(s, c.Value, StringComparison.OrdinalIgnoreCase),
            ">" => numeric && n > c.Num,
            "<" => numeric && n < c.Num,
            ">=" => numeric && n >= c.Num,
            "<=" => numeric && n <= c.Num,
            _ => true,
        };
    }

    private static string Get(Row row, string field) =>
        row.S.TryGetValue(field, out var v) ? v : "";

    private static string ColourOf(string[] ids, int index)
    {
        if (index < 0 || index >= ids.Length) return "-";
        var def = Registry.TryCard(ids[index]);
        if (def is null) return "-";
        string s = "";
        foreach (var c in new[] { def.Color, def.Color2, def.Color3 })
        {
            if (c is { } col) s += col.ToString();
        }
        return s.Length == 0 ? "N" : s;
    }

    private static string Clip(string s, int n) => s.Length <= n ? s : s[..(n - 1)] + "…";

    private static string Csv(string s) =>
        s.IndexOf(',') >= 0 || s.IndexOf('"') >= 0 ? "\"" + s.Replace("\"", "\"\"") + "\"" : s;

    private static string Arg(string[] a, string name, string fallback)
    {
        int i = Array.IndexOf(a, name);
        return i >= 0 && i + 1 < a.Length ? a[i + 1] : fallback;
    }

    private static int ArgInt(string[] a, string name, int fallback) =>
        int.TryParse(Arg(a, name, ""), out var v) ? v : fallback;
}
