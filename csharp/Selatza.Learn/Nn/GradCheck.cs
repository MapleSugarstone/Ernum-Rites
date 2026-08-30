namespace Selatza.Learn.Nn;

public readonly record struct GradResult(string Name, double WorstInput, double WorstParam, string Detail)
{
    public double Worst => Math.Max(WorstInput, WorstParam);
    public override string ToString() =>
        $"{Name,-12} input {WorstInput:E2}  params {WorstParam:E2}" + (Detail.Length > 0 ? $"  {Detail}" : "");
}

/// <summary>
/// Numeric gradient checks, one layer at a time.
///
/// The loss is a fixed linear functional of the layer's output, so the only
/// non-linearity in the check is whatever the layer itself contains, and the
/// finite difference is exact rather than an approximation of a kinked surface.
/// Checking the whole network end to end does not work for bias terms: a bias
/// shifts every position of a channel at once, so a two-sided difference walks
/// hundreds of positions across the ReLU hinge and measures a slope that the
/// analytic gradient, correctly, does not have.
/// </summary>
public static class GradCheck
{
    public static GradResult Check(string name, Layer layer, int batch, int channels, int length,
        Gauss rng, float bias = 0f, float step = 1e-3f)
    {
        var x = new Tensor(batch, channels, length);
        for (int i = 0; i < x.Count; i++)
        {
            float v = rng.Next(0.7f);
            // A hinge layer is only differentiable away from zero, so the check
            // keeps the inputs off it.
            x.Data[i] = bias == 0 ? v : (v > 0 ? v + bias : v - bias);
        }

        var y = layer.Forward(x, training: true);
        var dy = new Tensor(y.Batch, y.Channels, y.Length);
        for (int i = 0; i < dy.Count; i++) dy.Data[i] = rng.Next(1f);

        var ps = new List<Param>();
        layer.Collect(ps);
        foreach (var p in ps) p.ZeroGrad();

        var dxTensor = layer.Backward(dy);
        var dx = new float[dxTensor.Count];
        Array.Copy(dxTensor.Data, dx, dx.Length);
        var pg = ps.Select(p => (float[])p.G.Clone()).ToArray();

        double Loss()
        {
            var o = layer.Forward(x, training: false);
            double sum = 0;
            for (int i = 0; i < dy.Count; i++) sum += (double)o.Data[i] * dy.Data[i];
            return sum;
        }

        double worstInput = 0, worstParam = 0;
        string detail = "";

        for (int t = 0; t < Math.Min(24, x.Count); t++)
        {
            int i = rng.NextInt(x.Count);
            float orig = x.Data[i];
            x.Data[i] = orig + step;
            double up = Loss();
            x.Data[i] = orig - step;
            double down = Loss();
            x.Data[i] = orig;
            double numeric = (up - down) / (2 * step);
            double rel = Rel(numeric, dx[i]);
            if (rel > worstInput)
            {
                worstInput = rel;
                detail = $"x[{i}] numeric {numeric:E3} analytic {dx[i]:E3}";
            }
        }

        for (int k = 0; k < ps.Count; k++)
        {
            var p = ps[k];
            for (int t = 0; t < Math.Min(16, p.W.Length); t++)
            {
                int i = rng.NextInt(p.W.Length);
                float orig = p.W[i];
                p.W[i] = orig + step;
                layer.AfterStep();
                double up = Loss();
                p.W[i] = orig - step;
                layer.AfterStep();
                double down = Loss();
                p.W[i] = orig;
                layer.AfterStep();
                double numeric = (up - down) / (2 * step);
                double rel = Rel(numeric, pg[k][i]);
                if (rel > worstParam)
                {
                    worstParam = rel;
                    detail = $"{p.Name}[{i}] numeric {numeric:E3} analytic {pg[k][i]:E3}";
                }
            }
        }

        return new GradResult(name, worstInput, worstParam, detail);
    }

    private static double Rel(double numeric, double analytic)
    {
        // The floor makes this "relatively close, or absolutely tiny". Without
        // it a gradient of 3e-3 against 3.5e-3 reads as a 2% failure when the
        // difference is float32 noise on a number that barely matters.
        double scale = Math.Max(1e-2, Math.Abs(numeric) + Math.Abs(analytic));
        return Math.Abs(numeric - analytic) / scale;
    }

    /// <summary>Every layer the network is made of, at the shapes it uses them.</summary>
    public static List<GradResult> All(int seed = 17)
    {
        var rng = new Gauss(seed);
        // The stem used to be built from the live card table, which made this
        // check depend on how many cards exist and what is printed on them:
        // adding a card or reprinting a rarity moved the numeric gradient and
        // failed a layer whose maths had not changed. A fixed synthetic plane
        // tests the layer itself. It still goes last because it eats randomness
        // in proportion to its size.
        const int cards = 64;
        var staticPlane = new float[CardIndex.StaticChannels * cards];
        for (int i = 0; i < staticPlane.Length; i++)
        {
            staticPlane[i] = ((i * 37) % 17) / 17f - 0.5f;
        }
        var fixedSize = new List<GradResult>
        {
            Check("conv1x1", new Conv1D("pw", 5, 7, 1, 1, rng), 2, 5, 11, rng),
            Check("conv3", new Conv1D("c3", 5, 4, 3, 1, rng), 2, 5, 11, rng),
            Check("depthwise", new Conv1D("dw", 6, 6, 3, 6, rng), 2, 6, 9, rng),
            Check("grouped", new Conv1D("gp", 6, 4, 3, 2, rng), 2, 6, 9, rng),
            Check("dense", new Dense("d", 12, 5, rng), 3, 12, 1, rng),
            Check("relu", new Relu(), 2, 4, 7, rng, bias: 0.2f),
            Check("maxpool", new MaxPool1D(), 2, 4, 9, rng, bias: 0.05f),
            Check("globalpool", new GlobalPool(), 2, 4, 9, rng, bias: 0.05f),
            Check("flatten", new Flatten(), 2, 4, 5, rng),
            Check("tanh", new TanhLayer(), 2, 3, 5, rng),
        };
        fixedSize.Add(Check("stem", new CardStem("stem", Encoder.CardChannels, 6,
            staticPlane, CardIndex.StaticChannels, cards, rng),
            2, Encoder.CardChannels, cards, rng));
        return fixedSize;
    }
}
