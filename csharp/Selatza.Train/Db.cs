using System.Data;
using Microsoft.Data.Sqlite;
using Selatza;
using Selatza.Learn;

namespace Selatza.Train;

/// <summary>
/// A recorded run as a database, so a question is SQL rather than a rebuild.
///
/// The log is a stream and answers stream-shaped questions well, but anything
/// that needs a join or a second pass ("which cards were out when this deck
/// lost") wants a relational shape. This loads one into SQLite once, after
/// which every question is a query somebody can write without touching C#.
///
///   db   --log runs/m1/games.szgl --db runs/m1/games.db
///   sql  --db runs/m1/games.db --q "select target, count(*) c from ev where power='Enthrall' group by 1 order by c desc limit 10"
/// </summary>
public static class Db
{
    public static int Build(string[] args)
    {
        string log = Arg(args, "--log", "");
        string dbPath = Arg(args, "--db", "");
        int sample = Math.Max(1, ArgInt(args, "--sample", 1));
        bool noEvents = Array.IndexOf(args, "--no-events") >= 0;
        bool noBoards = Array.IndexOf(args, "--no-boards") >= 0;

        if (!File.Exists(log))
        {
            Console.Error.WriteLine("db needs --log <file written by --log-games>");
            return 2;
        }
        if (dbPath.Length == 0) dbPath = Path.ChangeExtension(log, ".db");
        if (File.Exists(dbPath)) File.Delete(dbPath);

        using var con = new SqliteConnection($"Data Source={dbPath}");
        con.Open();
        Exec(con, "PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-200000;");
        Exec(con, Schema);

        using var r = new GameLogReader(log);
        string CardName(int i) => i >= 0 && i < r.Cards.Length
            ? Registry.TryCard(r.Cards[i])?.Name ?? r.Cards[i] : "";

        // Cards are stored once and referenced by index everywhere else, which
        // keeps eleven million event rows to a size that still queries quickly.
        using (var tx = con.BeginTransaction())
        {
            using var ins = con.CreateCommand();
            ins.CommandText = "insert into card (id, cid, name, colour, level, type, neutral) "
                + "values ($i, $cid, $n, $c, $l, $t, $u)";
            for (int i = 0; i < r.Cards.Length; i++)
            {
                var def = Registry.TryCard(r.Cards[i]);
                ins.Parameters.Clear();
                ins.Parameters.AddWithValue("$i", i);
                ins.Parameters.AddWithValue("$cid", r.Cards[i]);
                ins.Parameters.AddWithValue("$n", CardName(i));
                ins.Parameters.AddWithValue("$c", ColourOf(def));
                ins.Parameters.AddWithValue("$l", def?.Level ?? 0);
                ins.Parameters.AddWithValue("$t", def?.Type.ToString() ?? "");
                ins.Parameters.AddWithValue("$u", def?.Neutral == true ? 1 : 0);
                ins.ExecuteNonQuery();
            }
            tx.Commit();
        }

        var tx2 = con.BeginTransaction();
        var g = Prep(con, "insert into game (id, seed, nameA, nameB, leaderA, leaderB, "
            + "colourA, colourB, starter, winner, reason, turns, actions) values "
            + "($id,$sd,$na,$nb,$la,$lb,$ca,$cb,$st,$w,$r,$t,$ac)");
        var e = Prep(con, "insert into ev_raw (game, seat, type, turn, card, power, target, "
            + "targetkind, targetside, won) values ($g,$s,$ty,$tu,$c,$p,$tg,$tk,$ts,$w)");
        var b = Prep(con, "insert into board (game, seat, turn, debt, hand, deck, discard, "
            + "deckouts, bodies, supporters, leaderhp, slot, card, hp, love, stock, won) values "
            + "($g,$s,$tu,$d,$h,$dk,$di,$do,$bo,$su,$lh,$sl,$c,$hp,$lv,$sk,$w)");

        long games = 0, evRows = 0, boardRows = 0, seen = 0;
        var pendEv = new List<(int Seat, string Type, int Turn, int Card, string Power,
            int Target, string Kind, string Side)>();
        var pendBoard = new List<(int Seat, int Turn, int Debt, int Hand, int Deck, int Discard,
            int DeckOuts, int Bodies, int Sup, int LeaderHp, int Slot, int Card, int Hp,
            int Love, int Stock)>();

        while (r.NextGame(out var head))
        {
            seen++;
            bool keep = seen % sample == 0;
            pendEv.Clear();
            pendBoard.Clear();
            int actions = 0;

            LogItem item;
            LogEvent le;
            while ((item = r.Next(out le)) != LogItem.End)
            {
                if (item == LogItem.Snapshot)
                {
                    if (!keep || noBoards) continue;
                    for (int seat = 0; seat < 2; seat++)
                    {
                        var s = r.Snap[seat];
                        for (int slot = 0; slot < s.Slots.Length; slot++)
                        {
                            pendBoard.Add((seat, r.SnapTurn, s.Debt, s.Hand, s.Deck, s.Discard,
                                s.DeckOuts, s.Bodies, s.SupporterCount, s.LeaderHp,
                                slot, s.Slots[slot], s.SlotHp[slot], s.Love, s.SlotStock[slot]));
                        }
                    }
                    continue;
                }
                actions++;
                if (!keep || noEvents) continue;
                string power = le.PowerSlot >= 0
                    && r.Powers.TryGetValue((le.Card, le.PowerSlot), out var pn) ? pn : "";
                if (le.TargetCount == 0)
                {
                    pendEv.Add((le.Actor, ((ActionType)le.Type).ToString(), le.Turn, le.Card,
                        power, -1, "", ""));
                }
                else
                {
                    for (int i = 0; i < le.TargetCount; i++)
                    {
                        pendEv.Add((le.Actor, ((ActionType)le.Type).ToString(), le.Turn, le.Card,
                            power, r.Targets[i].Card, ((TargetKind)r.Targets[i].Kind).ToString(),
                            r.Targets[i].Player == le.Actor ? "self" : "enemy"));
                    }
                }
            }

            var tail = r.EndGame();
            if (!keep) continue;
            games++;
            string reason = tail.Reason switch
            { 1 => "debt", 2 => "leader", 3 => "other", _ => "unfinished" };

            Set(g, "$id", games); Set(g, "$sd", head.Seed);
            Set(g, "$na", head.NameA); Set(g, "$nb", head.NameB);
            Set(g, "$la", CardName(head.LeaderA)); Set(g, "$lb", CardName(head.LeaderB));
            Set(g, "$ca", ColourOf(Registry.TryCard(r.Cards[Math.Max(0, head.LeaderA)])));
            Set(g, "$cb", ColourOf(Registry.TryCard(r.Cards[Math.Max(0, head.LeaderB)])));
            Set(g, "$st", head.StartingPlayer); Set(g, "$w", tail.Winner);
            Set(g, "$r", reason); Set(g, "$t", tail.Turns); Set(g, "$ac", actions);
            g.ExecuteNonQuery();

            foreach (var row in pendEv)
            {
                Set(e, "$g", games); Set(e, "$s", row.Seat); Set(e, "$ty", row.Type);
                Set(e, "$tu", row.Turn); Set(e, "$c", row.Card); Set(e, "$p", row.Power);
                Set(e, "$tg", row.Target); Set(e, "$tk", row.Kind); Set(e, "$ts", row.Side);
                Set(e, "$w", tail.Winner == row.Seat ? 1 : 0);
                e.ExecuteNonQuery();
                evRows++;
            }
            foreach (var row in pendBoard)
            {
                Set(b, "$g", games); Set(b, "$s", row.Seat); Set(b, "$tu", row.Turn);
                Set(b, "$d", row.Debt); Set(b, "$h", row.Hand); Set(b, "$dk", row.Deck);
                Set(b, "$di", row.Discard); Set(b, "$do", row.DeckOuts); Set(b, "$bo", row.Bodies);
                Set(b, "$su", row.Sup); Set(b, "$lh", row.LeaderHp); Set(b, "$sl", row.Slot);
                Set(b, "$c", row.Card); Set(b, "$hp", row.Hp);
                Set(b, "$lv", row.Love); Set(b, "$sk", row.Stock);
                Set(b, "$w", tail.Winner == row.Seat ? 1 : 0);
                b.ExecuteNonQuery();
                boardRows++;
            }

            if (games % 20000 == 0)
            {
                tx2.Commit();
                tx2.Dispose();
                Console.WriteLine($"  {games:N0} games, {evRows:N0} events, {boardRows:N0} board rows");
                tx2 = con.BeginTransaction();
                g.Transaction = tx2; e.Transaction = tx2; b.Transaction = tx2;
            }
        }
        tx2.Commit();
        tx2.Dispose();

        Console.WriteLine("indexing…");
        Exec(con, Indexes);
        Exec(con, "PRAGMA optimize;");
        con.Close();
        SqliteConnection.ClearAllPools();

        double mb = new FileInfo(dbPath).Length / 1024.0 / 1024.0;
        Console.WriteLine($"{games:N0} games, {evRows:N0} events, {boardRows:N0} board rows "
            + $"-> {dbPath} ({mb:F0} MB)");
        Console.WriteLine("\nviews: ev (events with card names), bd (boards with card names), game");
        return 0;
    }

    public static int Sql(string[] args)
    {
        string dbPath = Arg(args, "--db", "");
        string q = Arg(args, "--q", "");
        string file = Arg(args, "--file", "");
        if (file.Length > 0 && File.Exists(file)) q = File.ReadAllText(file);
        if (!File.Exists(dbPath))
        {
            Console.Error.WriteLine("sql needs --db <file built by the db command>");
            return 2;
        }
        if (q.Trim().Length == 0)
        {
            Console.Error.WriteLine("sql needs --q \"select …\" or --file <path>");
            return 2;
        }

        using var con = new SqliteConnection($"Data Source={dbPath};Mode=ReadOnly");
        con.Open();
        using var cmd = con.CreateCommand();
        cmd.CommandText = q;
        using var rd = cmd.ExecuteReader();

        int n = rd.FieldCount;
        var names = new string[n];
        for (int i = 0; i < n; i++) names[i] = rd.GetName(i);
        var rows = new List<string[]>();
        while (rd.Read())
        {
            var row = new string[n];
            for (int i = 0; i < n; i++)
            {
                row[i] = rd.IsDBNull(i) ? "" : rd.GetValue(i) switch
                {
                    double d => d.ToString("0.###"),
                    var v => v.ToString() ?? "",
                };
            }
            rows.Add(row);
        }

        var width = new int[n];
        for (int i = 0; i < n; i++)
        {
            width[i] = names[i].Length;
            foreach (var row in rows) width[i] = Math.Max(width[i], row[i].Length);
            width[i] = Math.Min(width[i], 40);
        }
        Console.WriteLine("  " + string.Join("  ", names.Select((s, i) => s.PadRight(width[i]))));
        Console.WriteLine("  " + string.Join("  ", width.Select(w => new string('-', w))));
        foreach (var row in rows)
        {
            Console.WriteLine("  " + string.Join("  ",
                row.Select((s, i) => Clip(s, width[i]).PadRight(width[i]))));
        }
        Console.WriteLine($"\n  {rows.Count:N0} rows");
        return 0;
    }

    private const string Schema = @"
create table card (id integer primary key, cid text, name text, colour text,
                   level integer, type text, neutral integer);
create table game (id integer primary key, seed integer, nameA text, nameB text,
                   leaderA text, leaderB text, colourA text, colourB text,
                   starter integer, winner integer, reason text, turns integer, actions integer);
create table ev_raw (game integer, seat integer, type text, turn integer, card integer,
                 power text, target integer, targetkind text, targetside text, won integer);
create table board (game integer, seat integer, turn integer, debt integer, hand integer,
                    deck integer, discard integer, deckouts integer, bodies integer,
                    supporters integer, leaderhp integer, slot integer, card integer,
                    hp integer, love integer, stock integer, won integer);

create view ev as select e.game, e.seat, e.type, e.turn,
       c.name as card, c.colour as cardcol, c.level as cardlevel,
       e.power, t.name as target, t.colour as targetcol,
       e.targetkind, e.targetside, e.won,
       case when e.seat = 0 then g.colourA else g.colourB end as colour,
       case when e.seat = 0 then g.colourB else g.colourA end as oppcolour,
       case when e.seat = 0 then g.leaderA else g.leaderB end as leader,
       g.reason, g.turns
  from ev_raw e join game g on g.id = e.game
  left join card c on c.id = e.card
  left join card t on t.id = e.target;

create view bd as select b.game, b.seat, b.turn, b.debt, b.hand, b.deck, b.discard,
       b.deckouts, b.bodies, b.supporters, b.leaderhp, b.slot,
       c.name as card, c.colour as cardcol, c.level as cardlevel, b.hp, b.love, b.stock, b.won,
       case when b.seat = 0 then g.colourA else g.colourB end as colour,
       case when b.seat = 0 then g.leaderA else g.leaderB end as leader,
       g.reason, g.turns
  from board b join game g on g.id = b.game
  left join card c on c.id = b.card;

-- One row per player per game, which is the shape almost every question wants:
-- 'how does this colour do', 'how does this leader do', 'who beat whom'. Without
-- it every such query has to union the game table onto itself by seat.
create view pg as
select g.id as game, 0 as seat, g.seed,
       g.leaderA as leader, g.colourA as colour,
       g.leaderB as oppleader, g.colourB as oppcolour,
       case when g.winner = 0 then 1 else 0 end as won,
       case when g.starter = 0 then 1 else 0 end as onplay,
       g.reason, g.turns, g.actions
  from game g
union all
select g.id, 1, g.seed,
       g.leaderB, g.colourB, g.leaderA, g.colourA,
       case when g.winner = 1 then 1 else 0 end,
       case when g.starter = 1 then 1 else 0 end,
       g.reason, g.turns, g.actions
  from game g;
";

    private const string Indexes = @"
create index ev_card on ev_raw (card);
create index ev_target on ev_raw (target);
create index ev_type on ev_raw (type);
create index ev_power on ev_raw (power);
create index ev_game on ev_raw (game);
create index bd_card on board (card);
create index bd_game on board (game);
create index bd_turn on board (turn);
create index game_colour on game (colourA, colourB);
create index game_leader on game (leaderA, leaderB);
-- 'did this player use that card or power in this game' is the join behind most
-- of the per-card analysis, and it is a scan without this.
create index ev_gst on ev_raw (game, seat, type);
create index bd_gs on board (game, seat);
";

    private static void Exec(SqliteConnection con, string sql)
    {
        using var cmd = con.CreateCommand();
        cmd.CommandText = sql;
        cmd.ExecuteNonQuery();
    }

    private static SqliteCommand Prep(SqliteConnection con, string sql)
    {
        var cmd = con.CreateCommand();
        cmd.CommandText = sql;
        return cmd;
    }

    private static void Set(SqliteCommand cmd, string name, object value)
    {
        if (cmd.Parameters.Contains(name)) cmd.Parameters[name].Value = value;
        else cmd.Parameters.AddWithValue(name, value);
    }

    private static string ColourOf(CardDef? def)
    {
        if (def is null) return "-";
        string s = "";
        foreach (var c in new[] { def.Color, def.Color2, def.Color3 })
        {
            if (c is { } col) s += col.ToString();
        }
        return s.Length == 0 ? "N" : s;
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
