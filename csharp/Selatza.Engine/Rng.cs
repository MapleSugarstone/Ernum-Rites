namespace Selatza;

/// <summary>
/// mulberry32, matching the TypeScript engine bit for bit so a seed produces the
/// same shuffle in both. All arithmetic is deliberately unchecked 32-bit.
/// </summary>
public sealed class Rng
{
    public int State;

    public Rng(int seed) => State = seed;

    public double Next()
    {
        unchecked
        {
            State = State + 0x6d2b79f5;
            int r = State;
            r = Imul(r ^ (int)((uint)r >> 15), r | 1);
            r ^= r + Imul(r ^ (int)((uint)r >> 7), r | 61);
            uint v = (uint)(r ^ (int)((uint)r >> 14));
            return v / 4294967296.0;
        }
    }

    /// <summary>JavaScript Math.imul: 32-bit signed multiply with wraparound.</summary>
    private static int Imul(int a, int b)
    {
        unchecked { return a * b; }
    }

    public int NextInt(int maxExclusive) => (int)Math.Floor(Next() * maxExclusive);

    public void Shuffle<T>(IList<T> list)
    {
        for (int i = list.Count - 1; i > 0; i--)
        {
            int j = NextInt(i + 1);
            (list[i], list[j]) = (list[j], list[i]);
        }
    }
}
