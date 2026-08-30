using System.Buffers.Binary;
using System.IO.Compression;
using System.Text;

namespace Selatza.Learn;

/// <summary>
/// Every action of every game, small enough to keep for a whole meta check.
///
/// A tournament plays hundreds of thousands of games and then throws the detail
/// away, which means any question nobody thought to ask beforehand needs the
/// whole run again. This writes one record per game instead: what was played,
/// by whom, on which turn, and which card each target resolved to. Targets are
/// resolved against the state before the action applies, so "the most common
/// targets of Enthrall" is a group-by rather than a replay.
///
/// The format is varints under gzip. Boards repeat heavily between games, so
/// the compressor does the work a hand-rolled bit packing would, and the file
/// carries its own card and power tables so a reader needs nothing else.
/// </summary>
public static class GameLog
{
    public const byte Version = 2;
    private const byte RecordMark = 0xA5;
    public const byte SnapshotMark = 0xFE;

    private static readonly object Gate = new();
    private static GZipStream? _gz;
    private static FileStream? _file;
    private static int _every = 1;
    private static long _seen;
    private static long _written;

    public static bool Active => _gz is not null;
    public static long GamesWritten => Interlocked.Read(ref _written);

    /// <summary>Opens the log. <paramref name="every"/> of 1 keeps every game.</summary>
    public static void Open(string path, int every = 1)
    {
        Close();
        _every = Math.Max(1, every);
        _seen = 0;
        _written = 0;
        var dir = Path.GetDirectoryName(Path.GetFullPath(path));
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        _file = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.Read, 1 << 16);
        _gz = new GZipStream(_file, CompressionLevel.Optimal, leaveOpen: false);
        WriteHeader(_gz);
    }

    public static void Close()
    {
        lock (Gate)
        {
            _gz?.Dispose();
            _gz = null;
            _file = null;
        }
    }

    private static void WriteHeader(Stream s)
    {
        s.Write("SZGL"u8);
        s.WriteByte(Version);
        CardIndex.EnsureBuilt();
        var buf = new Buf();
        int n = CardIndex.Count;
        buf.VarInt(n);
        for (int i = 0; i < n; i++) buf.Str(CardIndex.Id(i));

        // Powers are addressed as (card, slot) everywhere else, so the table
        // just names them; an analyser never has to load the card set.
        var powers = new List<(int Card, int Slot, string Name)>();
        for (int i = 0; i < n; i++)
        {
            var ps = CardIndex.Def(i).Powers;
            if (ps is null) continue;
            for (int p = 0; p < ps.Length; p++) powers.Add((i, p, ps[p].Name));
        }
        buf.VarInt(powers.Count);
        foreach (var (card, slot, name) in powers)
        {
            buf.VarInt(card);
            buf.Byte((byte)slot);
            buf.Str(name);
        }
        buf.CopyTo(s);
    }

    /// <summary>Whether this game should be recorded. Cheap, and called once per game.</summary>
    public static bool ShouldRecord()
    {
        if (_gz is null) return false;
        if (_every == 1) return true;
        return Interlocked.Increment(ref _seen) % _every == 0;
    }

    public static void Commit(Buf record)
    {
        if (_gz is null) return;
        lock (Gate)
        {
            if (_gz is null) return;
            record.CopyTo(_gz);
        }
        Interlocked.Increment(ref _written);
    }

    /// <summary>A per-game scratch buffer. One per thread, reused between games.</summary>
    public sealed class Buf
    {
        private byte[] _a = new byte[1024];
        private int _n;

        public int Length => _n;
        public void Reset() => _n = 0;

        private void Need(int extra)
        {
            if (_n + extra <= _a.Length) return;
            int cap = _a.Length;
            while (cap < _n + extra) cap <<= 1;
            Array.Resize(ref _a, cap);
        }

        public void Byte(byte b)
        {
            Need(1);
            _a[_n++] = b;
        }

        public void VarInt(long v)
        {
            ulong u = (ulong)v;
            Need(10);
            while (u >= 0x80)
            {
                _a[_n++] = (byte)(u | 0x80);
                u >>= 7;
            }
            _a[_n++] = (byte)u;
        }

        public void Str(string s)
        {
            int max = Encoding.UTF8.GetMaxByteCount(s.Length);
            Need(max + 5);
            int at = _n;
            _n += 2;
            int wrote = Encoding.UTF8.GetBytes(s, _a.AsSpan(_n));
            BinaryPrimitives.WriteUInt16LittleEndian(_a.AsSpan(at), (ushort)wrote);
            _n += wrote;
        }

        public void CopyTo(Stream s) => s.Write(_a, 0, _n);
    }

    /// <summary>What ended the game, folded to the three cases worth counting.</summary>
    public static byte ReasonCode(string? reason)
    {
        if (reason is null) return 0;
        if (reason.Contains("debt", StringComparison.OrdinalIgnoreCase)) return 1;
        if (reason.Contains("HP", StringComparison.OrdinalIgnoreCase)
            || reason.Contains("leader", StringComparison.OrdinalIgnoreCase)) return 2;
        return 3;
    }

    public static void BeginGame(Buf b, string nameA, string nameB, int leaderA, int leaderB,
        int startingPlayer, int seed)
    {
        b.Reset();
        b.Byte(RecordMark);
        b.Str(nameA);
        b.Str(nameB);
        b.VarInt(leaderA);
        b.VarInt(leaderB);
        b.VarInt(startingPlayer);
        b.VarInt(unchecked((uint)seed));
    }

    /// <summary>
    /// One action, with every target already resolved to the card that was
    /// standing there. Called with the state as it was before the action.
    /// </summary>
    public static void Event(Buf b, GameState before, int actor, GameAction a)
    {
        b.Byte((byte)((actor & 1) | ((int)a.Type << 1)));
        b.VarInt(before.Players[actor].TurnsTaken);
        b.VarInt(SourceCard(before, actor, a) + 1);
        b.Byte((byte)(a.Type == ActionType.ActivatePower ? a.PowerIndex + 1 : 0));

        // An attack and a board pick each carry exactly one ref; everything
        // else carries a list.
        if (a.Type == ActionType.DeclareAttack) WriteOne(b, before, a.Target);
        else if (a.Pick is { } pick) WriteOne(b, before, pick);
        else WriteMany(b, before, a.Targets);
    }

    private static void WriteOne(Buf b, GameState before, TargetRef t)
    {
        b.Byte(1);
        WriteTarget(b, before, t);
    }

    private static void WriteMany(Buf b, GameState before, TargetRef[] targets)
    {
        b.Byte((byte)Math.Min(targets.Length, 255));
        foreach (var t in targets) WriteTarget(b, before, t);
    }

    private static void WriteTarget(Buf b, GameState before, TargetRef t)
    {
        b.Byte((byte)(((int)t.Kind & 7) | ((t.Player & 1) << 3)));
        b.VarInt(Resolve(before, t) + 1);
    }

    /// <summary>
    /// Both boards as they stand at the top of a turn. Actions alone say what
    /// was aimed at what; this says what was still standing to aim with, which
    /// is what a question about how a deck grinds actually needs.
    /// </summary>
    public static void Snapshot(Buf b, GameState s)
    {
        b.Byte(SnapshotMark);
        b.VarInt(s.Turn);
        for (int i = 0; i < 2; i++)
        {
            var p = s.Players[i];
            b.VarInt(p.DebtCount);
            b.VarInt(p.Hand.Count);
            b.VarInt(p.Deck.Count);
            b.VarInt(p.Discard.Count);
            b.VarInt(p.DeckOuts);
            // Three slots then the leader, so a fixed shape needs no count.
            for (int k = 0; k < p.Slots.Length; k++)
            {
                var body = p.Slots[k];
                b.VarInt((body is null ? -1 : CardIndex.Of(body.CardId)) + 1);
                b.VarInt(body?.RemainingHp ?? 0);
            }
            b.VarInt((p.Leader is null ? -1 : CardIndex.Of(p.Leader.CardId)) + 1);
            b.VarInt(p.Leader?.RemainingHp ?? 0);
            b.VarInt(p.Supporters.Count);
            foreach (var sup in p.Supporters) b.VarInt(CardIndex.Of(sup.CardId) + 1);
        }
    }

    public static void EndGame(Buf b, int winner, string? reason, int turns, int events)
    {
        b.Byte(0xFF); // event terminator
        b.VarInt(events);
        b.Byte((byte)((winner + 1) & 3));
        b.Byte(ReasonCode(reason));
        b.VarInt(turns);
    }

    /// <summary>The card an action came from: the one leaving hand, or the body acting.</summary>
    private static int SourceCard(GameState s, int actor, GameAction a)
    {
        var p = s.Players[actor];
        switch (a.Type)
        {
            case ActionType.PlaySupporter:
            case ActionType.PlaySummon:
            case ActionType.CastSpell:
            case ActionType.PlayStage:
            case ActionType.CastTrap:
            case ActionType.ReplaceSummon:
            case ActionType.PayFlip:
                return a.HandIndex >= 0 && a.HandIndex < p.Hand.Count
                    ? CardIndex.Of(p.Hand[a.HandIndex]) : -1;
            case ActionType.SapSupporter:
                return a.Index >= 0 && a.Index < p.Supporters.Count
                    ? CardIndex.Of(p.Supporters[a.Index].CardId) : -1;
            case ActionType.ActivatePower:
            case ActionType.DeclareAttack:
                return Resolve(s, a.Source);
            default:
                return -1;
        }
    }

    /// <summary>Which card is standing at a ref right now, or -1 for nothing.</summary>
    private static int Resolve(GameState s, TargetRef t)
    {
        if (t.Player < 0 || t.Player > 1) return -1;
        var p = s.Players[t.Player];
        string? id = t.Kind switch
        {
            TargetKind.Summon => t.Index >= 0 && t.Index < p.Slots.Length
                ? p.Slots[t.Index]?.CardId : null,
            TargetKind.Leader => p.Leader?.CardId,
            TargetKind.Hand => t.Index >= 0 && t.Index < p.Hand.Count ? p.Hand[t.Index] : null,
            TargetKind.Supporter => t.Index >= 0 && t.Index < p.Supporters.Count
                ? p.Supporters[t.Index].CardId : null,
            TargetKind.Debt => t.Index >= 0 && t.Index < p.DebtZone.Count ? p.DebtZone[t.Index] : null,
            TargetKind.Discard => t.Index >= 0 && t.Index < p.Discard.Count ? p.Discard[t.Index] : null,
            _ => null,
        };
        return id is null ? -1 : CardIndex.Of(id);
    }
}
