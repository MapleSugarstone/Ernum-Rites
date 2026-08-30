using System.Buffers.Binary;
using System.IO.Compression;
using System.Text;

namespace Selatza.Learn;

public readonly record struct LogEvent(
    int Actor, int Type, int Turn, int Card, int PowerSlot,
    int TargetCount, int FirstTarget);

public readonly record struct LogTarget(int Kind, int Player, int Card);

public readonly record struct GameHead(
    string NameA, string NameB, int LeaderA, int LeaderB, int StartingPlayer, int Seed);

public readonly record struct GameTail(int Winner, int Reason, int Turns, int Events);

/// <summary>One player's zones at the top of a turn.</summary>
public sealed class SideSnap
{
    public int Debt, Hand, Deck, Discard, DeckOuts, LeaderCard, LeaderHp, SupporterCount;
    public readonly int[] Slots = new int[3];
    public readonly int[] SlotHp = new int[3];
    public readonly List<int> Supporters = new();

    /// <summary>Bodies standing in slots, leader excluded.</summary>
    public int Bodies
    {
        get
        {
            int n = 0;
            foreach (var c in Slots) if (c >= 0) n++;
            return n;
        }
    }
}

public enum LogItem { Event, Snapshot, End }

/// <summary>
/// Streams a <see cref="GameLog"/> back. The file names its own cards and
/// powers, so nothing here needs the card set loaded.
/// </summary>
public sealed class GameLogReader : IDisposable
{
    private readonly Stream _in;
    private readonly byte[] _buf = new byte[1 << 16];
    private int _n, _at;
    private bool _eof;

    public string[] Cards { get; }
    /// <summary>(card index, power slot) to the printed power name.</summary>
    public Dictionary<(int Card, int Slot), string> Powers { get; } = new();

    /// <summary>Targets of the event most recently returned by <see cref="NextEvent"/>.</summary>
    public LogTarget[] Targets = new LogTarget[8];

    public GameLogReader(string path)
    {
        _in = new GZipStream(new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read,
            1 << 16), CompressionMode.Decompress);
        Span<byte> magic = stackalloc byte[5];
        for (int i = 0; i < 5; i++) magic[i] = ReadByte();
        if (magic[0] != (byte)'S' || magic[1] != (byte)'Z' || magic[2] != (byte)'G' || magic[3] != (byte)'L')
            throw new InvalidDataException("not a game log");
        if (magic[4] != GameLog.Version)
            throw new InvalidDataException($"game log version {magic[4]}, expected {GameLog.Version}");

        int cards = (int)VarInt();
        Cards = new string[cards];
        for (int i = 0; i < cards; i++) Cards[i] = Str();
        int powers = (int)VarInt();
        for (int i = 0; i < powers; i++)
        {
            int card = (int)VarInt();
            int slot = ReadByte();
            Powers[(card, slot)] = Str();
        }
    }

    private int Fill()
    {
        _n = _in.Read(_buf, 0, _buf.Length);
        _at = 0;
        if (_n <= 0) _eof = true;
        return _n;
    }

    private byte ReadByte()
    {
        if (_at >= _n && Fill() <= 0) throw new EndOfStreamException();
        return _buf[_at++];
    }

    private bool TryReadByte(out byte b)
    {
        if (_at >= _n && Fill() <= 0) { b = 0; return false; }
        b = _buf[_at++];
        return true;
    }

    private long VarInt()
    {
        ulong v = 0;
        int shift = 0;
        while (true)
        {
            byte b = ReadByte();
            v |= (ulong)(b & 0x7F) << shift;
            if ((b & 0x80) == 0) return (long)v;
            shift += 7;
        }
    }

    private string Str()
    {
        int lo = ReadByte(), hi = ReadByte();
        int len = lo | (hi << 8);
        if (len == 0) return string.Empty;
        var bytes = len <= 256 ? stackalloc byte[len] : new byte[len];
        for (int i = 0; i < len; i++) bytes[i] = ReadByte();
        return Encoding.UTF8.GetString(bytes);
    }

    public bool NextGame(out GameHead head)
    {
        head = default;
        if (_eof && _at >= _n) return false;
        if (!TryReadByte(out byte mark)) return false;
        if (mark != 0xA5) throw new InvalidDataException($"lost sync: expected record mark, got {mark:X2}");
        head = new GameHead(Str(), Str(), (int)VarInt(), (int)VarInt(), (int)VarInt(),
            unchecked((int)(uint)VarInt()));
        return true;
    }

    /// <summary>The turn a snapshot describes, valid after <see cref="LogItem.Snapshot"/>.</summary>
    public int SnapTurn { get; private set; }

    /// <summary>Both sides of the most recent snapshot, indexed by seat.</summary>
    public SideSnap[] Snap { get; } = { new(), new() };

    /// <summary>
    /// Walks a game one item at a time. Snapshots and actions are interleaved
    /// in the order they happened, so a reader can follow a board forward.
    /// </summary>
    public LogItem Next(out LogEvent e)
    {
        e = default;
        byte b0 = ReadByte();
        if (b0 == 0xFF) return LogItem.End;
        if (b0 == GameLog.SnapshotMark)
        {
            SnapTurn = (int)VarInt();
            for (int i = 0; i < 2; i++)
            {
                var p = Snap[i];
                p.Debt = (int)VarInt();
                p.Hand = (int)VarInt();
                p.Deck = (int)VarInt();
                p.Discard = (int)VarInt();
                p.DeckOuts = (int)VarInt();
                for (int k = 0; k < 3; k++)
                {
                    p.Slots[k] = (int)VarInt() - 1;
                    p.SlotHp[k] = (int)VarInt();
                }
                p.LeaderCard = (int)VarInt() - 1;
                p.LeaderHp = (int)VarInt();
                p.SupporterCount = (int)VarInt();
                p.Supporters.Clear();
                for (int k = 0; k < p.SupporterCount; k++) p.Supporters.Add((int)VarInt() - 1);
            }
            return LogItem.Snapshot;
        }
        ReadEventBody(b0, out e);
        return LogItem.Event;
    }

    /// <summary>Actions only, skipping snapshots. Kept for readers that want the old shape.</summary>
    public bool NextEvent(out LogEvent e)
    {
        while (true)
        {
            var item = Next(out e);
            if (item == LogItem.End) return false;
            if (item == LogItem.Event) return true;
        }
    }

    private void ReadEventBody(byte b0, out LogEvent e)
    {
        int actor = b0 & 1, type = b0 >> 1;
        int turn = (int)VarInt();
        int card = (int)VarInt() - 1;
        int power = ReadByte() - 1;
        int n = ReadByte();
        if (Targets.Length < n) Targets = new LogTarget[n];
        for (int i = 0; i < n; i++)
        {
            byte t = ReadByte();
            Targets[i] = new LogTarget(t & 7, (t >> 3) & 1, (int)VarInt() - 1);
        }
        e = new LogEvent(actor, type, turn, card, power, n, n > 0 ? Targets[0].Card : -1);
    }

    /// <summary>Call once <see cref="NextEvent"/> has returned false.</summary>
    public GameTail EndGame()
    {
        int events = (int)VarInt();
        int winner = ReadByte() - 1;
        int reason = ReadByte();
        int turns = (int)VarInt();
        return new GameTail(winner, reason, turns, events);
    }

    public void Dispose() => _in.Dispose();
}
