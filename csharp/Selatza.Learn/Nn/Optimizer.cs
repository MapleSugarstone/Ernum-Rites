namespace Selatza.Learn.Nn;

/// <summary>One weight array and the three buffers Adam needs to move it.</summary>
public sealed class Param
{
    public required string Name { get; init; }
    public required float[] W { get; init; }
    public float[] G { get; init; } = Array.Empty<float>();
    public float[] M { get; init; } = Array.Empty<float>();
    public float[] V { get; init; } = Array.Empty<float>();
    /// <summary>Biases are left out of weight decay.</summary>
    public bool Decay { get; init; } = true;

    public static Param Make(string name, int size, bool decay = true) => new()
    {
        Name = name,
        W = new float[size],
        G = new float[size],
        M = new float[size],
        V = new float[size],
        Decay = decay,
    };

    public void ZeroGrad() => Array.Clear(G);
}

public sealed class Adam
{
    public float Lr = 2e-3f;
    public float Beta1 = 0.9f;
    public float Beta2 = 0.999f;
    public float Eps = 1e-8f;
    public float WeightDecay = 1e-5f;
    public float ClipNorm = 5f;

    private int _step;

    public int Steps
    {
        get => _step;
        set => _step = value;
    }

    public void Step(IReadOnlyList<Param> ps)
    {
        _step++;
        float scale = 1f;
        if (ClipNorm > 0)
        {
            double sum = 0;
            foreach (var p in ps)
            {
                foreach (var g in p.G) sum += (double)g * g;
            }
            double norm = Math.Sqrt(sum);
            if (norm > ClipNorm) scale = (float)(ClipNorm / norm);
        }

        float b1t = 1f - MathF.Pow(Beta1, _step);
        float b2t = 1f - MathF.Pow(Beta2, _step);

        foreach (var p in ps)
        {
            var w = p.W;
            var g = p.G;
            var m = p.M;
            var v = p.V;
            for (int i = 0; i < w.Length; i++)
            {
                float grad = g[i] * scale;
                if (p.Decay && WeightDecay > 0) grad += WeightDecay * w[i];
                m[i] = Beta1 * m[i] + (1 - Beta1) * grad;
                v[i] = Beta2 * v[i] + (1 - Beta2) * grad * grad;
                float mh = m[i] / b1t;
                float vh = v[i] / b2t;
                w[i] -= Lr * mh / (MathF.Sqrt(vh) + Eps);
            }
        }
    }

    public static void ZeroGrads(IReadOnlyList<Param> ps)
    {
        foreach (var p in ps) p.ZeroGrad();
    }
}

/// <summary>Deterministic normal noise, so a run reproduces from its seed alone.</summary>
public sealed class Gauss
{
    private readonly Rng _rng;
    private double _spare;
    private bool _hasSpare;

    public Gauss(int seed) => _rng = new Rng(seed);

    public float Next()
    {
        if (_hasSpare)
        {
            _hasSpare = false;
            return (float)_spare;
        }
        double u, v, s;
        do
        {
            u = _rng.Next() * 2 - 1;
            v = _rng.Next() * 2 - 1;
            s = u * u + v * v;
        } while (s >= 1 || s == 0);
        double mul = Math.Sqrt(-2.0 * Math.Log(s) / s);
        _spare = v * mul;
        _hasSpare = true;
        return (float)(u * mul);
    }

    public float Next(float sigma) => Next() * sigma;

    public double Uniform() => _rng.Next();

    public int NextInt(int maxExclusive) => _rng.NextInt(maxExclusive);

    /// <summary>Enough to carry the stream across a restart.</summary>
    public (int State, double Spare, bool HasSpare) Capture() => (_rng.State, _spare, _hasSpare);

    public void Restore(int state, double spare, bool hasSpare)
    {
        _rng.State = state;
        _spare = spare;
        _hasSpare = hasSpare;
    }
}
