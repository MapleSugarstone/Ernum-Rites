using Selatza.Learn.Nn;

namespace Selatza.Learn;

/// <summary>
/// Positions kept for training, with the card plane held sparse. A full
/// observation is around 23 kB of mostly zeros; stored this way a generation of
/// self-play fits in memory without thinning it down to nothing.
/// </summary>
public sealed class SampleStore
{
    private int[] _idx = new int[1 << 16];
    private float[] _val = new float[1 << 16];
    private int _nnz;

    private int[] _start = new int[1024];
    private int[] _len = new int[1024];
    private float[] _tail = Array.Empty<float>();
    private float[] _value = new float[1024];
    private float[] _prior = new float[1024];
    private float[] _hand = Array.Empty<float>();
    private float[] _trap = new float[1024];
    private int _count;

    private readonly int _tailSize;
    private readonly int _cardPlane;
    private readonly int _sampleSize;

    public SampleStore()
    {
        CardIndex.EnsureBuilt();
        _cardPlane = Encoder.CardChannels * CardIndex.Count;
        _tailSize = Encoder.EntityChannels * Encoder.Entities + Encoder.ScalarCount;
        _sampleSize = _cardPlane + _tailSize;
        _tail = new float[1024 * _tailSize];
        _hand = new float[1024 * SelatzaNet.HandBuckets];
    }

    public int Count => _count;
    public int SampleSize => _sampleSize;
    public long Bytes => (long)_nnz * 8 + (long)_count * (_tailSize + SelatzaNet.HandBuckets + 2) * 4;

    private static void Grow<T>(ref T[] a, int need)
    {
        if (a.Length >= need) return;
        int size = Math.Max(need, a.Length * 2);
        Array.Resize(ref a, size);
    }

    /// <summary>
    /// <paramref name="prior"/> is what the hand-written evaluator thought of
    /// this position, on the same [-1, 1] scale as the value head. Training
    /// blends it with the result, so a young network has something to learn
    /// from before it has seen enough games to read an outcome.
    /// </summary>
    public void Add(ReadOnlySpan<float> sample, float value, float prior, ReadOnlySpan<float> hand, float trap)
    {
        Grow(ref _start, _count + 1);
        Grow(ref _len, _count + 1);
        Grow(ref _value, _count + 1);
        Grow(ref _prior, _count + 1);
        Grow(ref _trap, _count + 1);
        Grow(ref _tail, (_count + 1) * _tailSize);
        Grow(ref _hand, (_count + 1) * SelatzaNet.HandBuckets);

        int start = _nnz;
        for (int i = 0; i < _cardPlane; i++)
        {
            if (sample[i] == 0) continue;
            Grow(ref _idx, _nnz + 1);
            Grow(ref _val, _nnz + 1);
            _idx[_nnz] = i;
            _val[_nnz] = sample[i];
            _nnz++;
        }

        _start[_count] = start;
        _len[_count] = _nnz - start;
        _value[_count] = value;
        _prior[_count] = prior;
        _trap[_count] = trap;
        sample.Slice(_cardPlane, _tailSize).CopyTo(_tail.AsSpan(_count * _tailSize, _tailSize));
        hand.CopyTo(_hand.AsSpan(_count * SelatzaNet.HandBuckets, SelatzaNet.HandBuckets));
        _count++;
    }

    /// <summary>Rebuilds a batch of dense observations from the given sample rows.</summary>
    public void Fill(ReadOnlySpan<int> rows, float[] dest, float[] value, float[] prior, float[] hand,
        float[] trap)
    {
        Array.Clear(dest, 0, rows.Length * _sampleSize);
        for (int b = 0; b < rows.Length; b++)
        {
            int r = rows[b];
            int off = b * _sampleSize;
            int start = _start[r], len = _len[r];
            for (int i = 0; i < len; i++) dest[off + _idx[start + i]] = _val[start + i];
            Array.Copy(_tail, r * _tailSize, dest, off + _cardPlane, _tailSize);
            value[b] = _value[r];
            prior[b] = _prior[r];
            trap[b] = _trap[r];
            Array.Copy(_hand, r * SelatzaNet.HandBuckets, hand, b * SelatzaNet.HandBuckets,
                SelatzaNet.HandBuckets);
        }
    }

    public void Clear()
    {
        _count = 0;
        _nnz = 0;
    }

    /// <summary>Labels a run of rows once the game they came from has finished.</summary>
    public void SetValues(int fromRow, int count, float value)
    {
        for (int i = fromRow; i < fromRow + count && i < _count; i++) _value[i] = value;
    }

    /// <summary>Appends another store wholesale, which is how per-thread buffers come home.</summary>
    public void Merge(SampleStore other)
    {
        if (other._count == 0) return;
        Grow(ref _idx, _nnz + other._nnz);
        Grow(ref _val, _nnz + other._nnz);
        Array.Copy(other._idx, 0, _idx, _nnz, other._nnz);
        Array.Copy(other._val, 0, _val, _nnz, other._nnz);

        Grow(ref _start, _count + other._count);
        Grow(ref _len, _count + other._count);
        Grow(ref _value, _count + other._count);
        Grow(ref _prior, _count + other._count);
        Grow(ref _trap, _count + other._count);
        Grow(ref _tail, (_count + other._count) * _tailSize);
        Grow(ref _hand, (_count + other._count) * SelatzaNet.HandBuckets);

        for (int i = 0; i < other._count; i++)
        {
            _start[_count + i] = other._start[i] + _nnz;
            _len[_count + i] = other._len[i];
            _value[_count + i] = other._value[i];
            _prior[_count + i] = other._prior[i];
            _trap[_count + i] = other._trap[i];
        }
        Array.Copy(other._tail, 0, _tail, _count * _tailSize, other._count * _tailSize);
        Array.Copy(other._hand, 0, _hand, _count * SelatzaNet.HandBuckets,
            other._count * SelatzaNet.HandBuckets);
        _nnz += other._nnz;
        _count += other._count;
    }

    /// <summary>Drops the oldest half, so a run keeps a window of recent play.</summary>
    public void HalveOldest()
    {
        if (_count < 2) return;
        int keep = _count / 2;
        int from = _count - keep;
        int nnzFrom = _start[from];
        Array.Copy(_idx, nnzFrom, _idx, 0, _nnz - nnzFrom);
        Array.Copy(_val, nnzFrom, _val, 0, _nnz - nnzFrom);
        for (int i = 0; i < keep; i++)
        {
            _start[i] = _start[from + i] - nnzFrom;
            _len[i] = _len[from + i];
            _value[i] = _value[from + i];
            _prior[i] = _prior[from + i];
            _trap[i] = _trap[from + i];
        }
        Array.Copy(_tail, from * _tailSize, _tail, 0, keep * _tailSize);
        Array.Copy(_hand, from * SelatzaNet.HandBuckets, _hand, 0, keep * SelatzaNet.HandBuckets);
        _nnz -= nnzFrom;
        _count = keep;
    }
}

/// <summary>
/// What the network is asked to guess about the other side of the table on top
/// of the value. The targets come off the real position at training time, which
/// is fine: it is supervision, not something the agent may look at while
/// playing.
/// </summary>
public static class Aux
{
    public static int Bucket(CardDef d)
    {
        int type = d.Type switch
        {
            CardType.Summon => 0,
            CardType.Spell => 1,
            CardType.Trap => 2,
            CardType.Stage => 3,
            _ => 4,
        };
        return (int)d.Color * 5 + type;
    }

    public static void HandTarget(GameState state, int enemy, Span<float> dest)
    {
        dest.Clear();
        foreach (var id in state.Players[enemy].Hand)
        {
            var def = Registry.TryCard(id);
            if (def is null) continue;
            // Clamped rather than trusted: an out-of-range bucket once threw here
            // and silently dropped whole pairings from a tournament.
            int b = Math.Min(Bucket(def), dest.Length - 1);
            dest[b] += 1f / 3f;
        }
    }

    public static float TrapTarget(GameState state, int enemy)
    {
        foreach (var id in state.Players[enemy].Hand)
        {
            if (Registry.Card(id).Type == CardType.Trap) return 1f;
        }
        return 0f;
    }
}
