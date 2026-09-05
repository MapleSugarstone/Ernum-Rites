namespace Selatza.Learn.Nn;

public abstract class Layer
{
    protected Tensor Out = new(1, 1, 1);
    protected Tensor Grad = new(1, 1, 1);

    /// <summary>Valid until the next forward pass through this layer.</summary>
    public Tensor LastOutput => Out;

    public abstract Tensor Forward(Tensor x, bool training);

    /// <summary>Takes the gradient of the loss by this layer's output, returns it by its input.</summary>
    public abstract Tensor Backward(Tensor dy);

    public virtual void Collect(List<Param> ps)
    {
    }

    /// <summary>Called once after the optimiser moves the weights, for cached derived state.</summary>
    public virtual void AfterStep()
    {
    }
}

/// <summary>
/// Convolution along the card axis, with groups so the same class covers a
/// depthwise pass (groups == channels) and a pointwise one (kernel 1). Padding
/// is always SAME: the ends of the card ordering are real boundaries between
/// colours, and zero-padding says so.
/// </summary>
public sealed class Conv1D : Layer
{
    private readonly int _inC, _outC, _k, _groups, _pad, _inPer, _outPer;
    private readonly Param _w, _b;
    private Tensor? _x;

    public Conv1D(string name, int inC, int outC, int k, int groups, Gauss init, float gain = 2f)
    {
        if (inC % groups != 0 || outC % groups != 0)
        {
            throw new ArgumentException($"{name}: {inC}->{outC} does not split into {groups} groups");
        }
        _inC = inC;
        _outC = outC;
        _k = k;
        _groups = groups;
        _pad = (k - 1) / 2;
        _inPer = inC / groups;
        _outPer = outC / groups;
        _w = Param.Make($"{name}.w", outC * _inPer * k);
        _b = Param.Make($"{name}.b", outC, decay: false);
        float sigma = MathF.Sqrt(gain / (_inPer * k));
        for (int i = 0; i < _w.W.Length; i++) _w.W[i] = init.Next(sigma);
    }

    public override void Collect(List<Param> ps)
    {
        ps.Add(_w);
        ps.Add(_b);
    }

    public override Tensor Forward(Tensor x, bool training)
    {
        if (training) _x = x;
        int L = x.Length;
        Out.Fit(x.Batch, _outC, L);
        var y = Out.Data;
        var xs = x.Data;
        var w = _w.W;
        var bias = _b.W;

        for (int b = 0; b < x.Batch; b++)
        {
            int xb = b * _inC * L;
            int yb = b * _outC * L;
            if (_k == 1 && _groups == 1)
            {
                Vec.Pointwise(w, xs.AsSpan(xb, _inC * L), y.AsSpan(yb, _outC * L),
                    ReadOnlySpan<float>.Empty, bias, _inC, _outC, L);
                continue;
            }
            for (int oc = 0; oc < _outC; oc++)
            {
                var row = y.AsSpan(yb + oc * L, L);
                row.Fill(bias[oc]);
                int g = oc / _outPer;
                int icBase = g * _inPer;
                for (int ic = 0; ic < _inPer; ic++)
                {
                    var xrow = xs.AsSpan(xb + (icBase + ic) * L, L);
                    int wbase = (oc * _inPer + ic) * _k;
                    for (int kk = 0; kk < _k; kk++)
                    {
                        float wv = w[wbase + kk];
                        if (wv == 0) continue;
                        int shift = kk - _pad;
                        if (shift == 0)
                        {
                            Vec.Axpy(wv, xrow, row, L);
                        }
                        else if (shift > 0)
                        {
                            int n = L - shift;
                            if (n > 0) Vec.Axpy(wv, xrow.Slice(shift, n), row[..n], n);
                        }
                        else
                        {
                            int n = L + shift;
                            if (n > 0) Vec.Axpy(wv, xrow[..n], row.Slice(-shift, n), n);
                        }
                    }
                }
            }
        }
        return Out;
    }

    public override Tensor Backward(Tensor dy)
    {
        var x = _x ?? throw new InvalidOperationException("backward before forward");
        int L = x.Length;
        Grad.Fit(x.Batch, _inC, L);
        Grad.Zero();
        var dx = Grad.Data;
        var xs = x.Data;
        var w = _w.W;
        var dw = _w.G;
        var db = _b.G;
        var dys = dy.Data;

        for (int b = 0; b < x.Batch; b++)
        {
            int xb = b * _inC * L;
            int yb = b * _outC * L;
            if (_k == 1 && _groups == 1)
            {
                Vec.PointwiseDx(w, dys.AsSpan(yb, _outC * L), dx.AsSpan(xb, _inC * L), _inC, _outC, L);
            }
            for (int oc = 0; oc < _outC; oc++)
            {
                var drow = dys.AsSpan(yb + oc * L, L);
                float sum = 0;
                for (int l = 0; l < L; l++) sum += drow[l];
                db[oc] += sum;

                if (_k == 1 && _groups == 1)
                {
                    for (int ic = 0; ic < _inC; ic++)
                    {
                        dw[oc * _inC + ic] += Vec.Dot(drow, xs.AsSpan(xb + ic * L, L), L);
                    }
                    continue;
                }

                int g = oc / _outPer;
                int icBase = g * _inPer;
                for (int ic = 0; ic < _inPer; ic++)
                {
                    var xrow = xs.AsSpan(xb + (icBase + ic) * L, L);
                    var dxrow = dx.AsSpan(xb + (icBase + ic) * L, L);
                    int wbase = (oc * _inPer + ic) * _k;
                    for (int kk = 0; kk < _k; kk++)
                    {
                        int shift = kk - _pad;
                        float wv = w[wbase + kk];
                        if (shift == 0)
                        {
                            dw[wbase + kk] += Vec.Dot(drow, xrow, L);
                            Vec.Axpy(wv, drow, dxrow, L);
                        }
                        else if (shift > 0)
                        {
                            int n = L - shift;
                            if (n <= 0) continue;
                            dw[wbase + kk] += Vec.Dot(drow[..n], xrow.Slice(shift, n), n);
                            Vec.Axpy(wv, drow[..n], dxrow.Slice(shift, n), n);
                        }
                        else
                        {
                            int n = L + shift;
                            if (n <= 0) continue;
                            dw[wbase + kk] += Vec.Dot(drow.Slice(-shift, n), xrow[..n], n);
                            Vec.Axpy(wv, drow.Slice(-shift, n), dxrow[..n], n);
                        }
                    }
                }
            }
        }
        return Grad;
    }
}

/// <summary>
/// The first layer of the card tower. Half its input is the same for every
/// position in every game, the printed stats and derived tags of the card that
/// sits at that column, so that half is folded into a per-column bias and
/// recomputed only when the weights move. It is the difference between paying
/// for fifty-one input channels on every evaluation and paying for twenty-one.
/// </summary>
public sealed class CardStem : Layer
{
    private readonly int _inC, _staticC, _outC, _len;
    private readonly float[] _staticPlane;
    private readonly Param _wd, _ws, _b;
    private readonly float[] _bias;
    private Tensor? _x;

    public CardStem(string name, int inC, int outC, float[] staticPlane, int staticC, int len, Gauss init)
    {
        _inC = inC;
        _staticC = staticC;
        _outC = outC;
        _len = len;
        _staticPlane = staticPlane;
        _wd = Param.Make($"{name}.wd", outC * inC);
        _ws = Param.Make($"{name}.ws", outC * staticC);
        _b = Param.Make($"{name}.b", outC, decay: false);
        _bias = new float[outC * len];
        float sd = MathF.Sqrt(2f / (inC + staticC));
        for (int i = 0; i < _wd.W.Length; i++) _wd.W[i] = init.Next(sd);
        for (int i = 0; i < _ws.W.Length; i++) _ws.W[i] = init.Next(sd);
        AfterStep();
    }

    public override void Collect(List<Param> ps)
    {
        ps.Add(_wd);
        ps.Add(_ws);
        ps.Add(_b);
    }

    /// <summary>The static half already folded in, <c>[channel * cards + card]</c>, for export.</summary>
    public float[] FoldedBias => _bias;

    public override void AfterStep()
    {
        Array.Clear(_bias);
        for (int oc = 0; oc < _outC; oc++)
        {
            var row = _bias.AsSpan(oc * _len, _len);
            row.Fill(_b.W[oc]);
            for (int sc = 0; sc < _staticC; sc++)
            {
                float wv = _ws.W[oc * _staticC + sc];
                if (wv != 0) Vec.Axpy(wv, _staticPlane.AsSpan(sc * _len, _len), row, _len);
            }
        }
    }

    public override Tensor Forward(Tensor x, bool training)
    {
        if (training) _x = x;
        int L = _len;
        Out.Fit(x.Batch, _outC, L);
        var y = Out.Data;
        var xs = x.Data;
        for (int b = 0; b < x.Batch; b++)
        {
            Vec.Pointwise(_wd.W, xs.AsSpan(b * _inC * L, _inC * L), y.AsSpan(b * _outC * L, _outC * L),
                _bias, ReadOnlySpan<float>.Empty, _inC, _outC, L);
        }
        return Out;
    }

    public override Tensor Backward(Tensor dy)
    {
        var x = _x ?? throw new InvalidOperationException("backward before forward");
        int L = _len;
        Grad.Fit(x.Batch, _inC, L);
        Grad.Zero();
        var dx = Grad.Data;
        var xs = x.Data;
        var dys = dy.Data;

        for (int b = 0; b < x.Batch; b++)
        {
            int xb = b * _inC * L;
            int yb = b * _outC * L;
            Vec.PointwiseDx(_wd.W, dys.AsSpan(yb, _outC * L), dx.AsSpan(xb, _inC * L), _inC, _outC, L);
            for (int oc = 0; oc < _outC; oc++)
            {
                var drow = dys.AsSpan(yb + oc * L, L);
                float sum = 0;
                for (int l = 0; l < L; l++) sum += drow[l];
                _b.G[oc] += sum;
                for (int ic = 0; ic < _inC; ic++)
                {
                    _wd.G[oc * _inC + ic] += Vec.Dot(drow, xs.AsSpan(xb + ic * L, L), L);
                }
                for (int sc = 0; sc < _staticC; sc++)
                {
                    _ws.G[oc * _staticC + sc] += Vec.Dot(drow, _staticPlane.AsSpan(sc * L, L), L);
                }
            }
        }
        return Grad;
    }
}

public sealed class Relu : Layer
{
    private Tensor? _y;

    public override Tensor Forward(Tensor x, bool training)
    {
        Out.Fit(x.Batch, x.Channels, x.Length);
        var y = Out.Data;
        var xs = x.Data;
        int n = x.Count;
        for (int i = 0; i < n; i++) y[i] = xs[i] > 0 ? xs[i] : 0;
        if (training) _y = Out;
        return Out;
    }

    public override Tensor Backward(Tensor dy)
    {
        var y = _y ?? throw new InvalidOperationException("backward before forward");
        Grad.Fit(dy.Batch, dy.Channels, dy.Length);
        var dx = Grad.Data;
        var ys = y.Data;
        var d = dy.Data;
        int n = dy.Count;
        for (int i = 0; i < n; i++) dx[i] = ys[i] > 0 ? d[i] : 0;
        return Grad;
    }
}

/// <summary>Halves the card axis, keeping whichever neighbour spoke loudest.</summary>
public sealed class MaxPool1D : Layer
{
    private int[] _arg = Array.Empty<int>();
    private int _inLen;
    private int _batch;
    private int _channels;

    public override Tensor Forward(Tensor x, bool training)
    {
        int outLen = (x.Length + 1) / 2;
        _inLen = x.Length;
        _batch = x.Batch;
        _channels = x.Channels;
        Out.Fit(x.Batch, x.Channels, outLen);
        int need = x.Batch * x.Channels * outLen;
        if (_arg.Length < need) _arg = new int[need];

        var y = Out.Data;
        var xs = x.Data;
        for (int b = 0; b < x.Batch; b++)
        {
            for (int c = 0; c < x.Channels; c++)
            {
                int xb = (b * x.Channels + c) * x.Length;
                int yb = (b * x.Channels + c) * outLen;
                for (int l = 0; l < outLen; l++)
                {
                    int i0 = l * 2;
                    int i1 = Math.Min(i0 + 1, x.Length - 1);
                    bool second = xs[xb + i1] > xs[xb + i0];
                    y[yb + l] = second ? xs[xb + i1] : xs[xb + i0];
                    _arg[yb + l] = second ? i1 : i0;
                }
            }
        }
        return Out;
    }

    public override Tensor Backward(Tensor dy)
    {
        Grad.Fit(_batch, _channels, _inLen);
        Grad.Zero();
        var dx = Grad.Data;
        var d = dy.Data;
        int outLen = dy.Length;
        for (int b = 0; b < _batch; b++)
        {
            for (int c = 0; c < _channels; c++)
            {
                int xb = (b * _channels + c) * _inLen;
                int yb = (b * _channels + c) * outLen;
                for (int l = 0; l < outLen; l++) dx[xb + _arg[yb + l]] += d[yb + l];
            }
        }
        return Grad;
    }
}

/// <summary>
/// Collapses the card axis to a mean and a max per channel. The mean says how
/// much of something a deck holds, the max says whether it holds any at all,
/// and both questions come up.
/// </summary>
public sealed class GlobalPool : Layer
{
    private int[] _arg = Array.Empty<int>();
    private int _len, _batch, _channels;

    public override Tensor Forward(Tensor x, bool training)
    {
        _len = x.Length;
        _batch = x.Batch;
        _channels = x.Channels;
        Out.Fit(x.Batch, x.Channels * 2, 1);
        int need = x.Batch * x.Channels;
        if (_arg.Length < need) _arg = new int[need];

        var y = Out.Data;
        var xs = x.Data;
        for (int b = 0; b < x.Batch; b++)
        {
            for (int c = 0; c < x.Channels; c++)
            {
                var row = xs.AsSpan((b * x.Channels + c) * x.Length, x.Length);
                float sum = 0, max = float.NegativeInfinity;
                int arg = 0;
                for (int l = 0; l < row.Length; l++)
                {
                    sum += row[l];
                    if (row[l] > max)
                    {
                        max = row[l];
                        arg = l;
                    }
                }
                y[b * x.Channels * 2 + c] = sum / x.Length;
                y[b * x.Channels * 2 + x.Channels + c] = max;
                _arg[b * x.Channels + c] = arg;
            }
        }
        return Out;
    }

    public override Tensor Backward(Tensor dy)
    {
        Grad.Fit(_batch, _channels, _len);
        Grad.Zero();
        var dx = Grad.Data;
        var d = dy.Data;
        float inv = 1f / _len;
        for (int b = 0; b < _batch; b++)
        {
            for (int c = 0; c < _channels; c++)
            {
                float dmean = d[b * _channels * 2 + c] * inv;
                var row = dx.AsSpan((b * _channels + c) * _len, _len);
                for (int l = 0; l < _len; l++) row[l] += dmean;
                row[_arg[b * _channels + c]] += d[b * _channels * 2 + _channels + c];
            }
        }
        return Grad;
    }
}

public sealed class Dense : Layer
{
    private readonly int _in, _out;
    private readonly Param _w, _b;
    private Tensor? _x;

    public Dense(string name, int inF, int outF, Gauss init, float gain = 2f)
    {
        _in = inF;
        _out = outF;
        _w = Param.Make($"{name}.w", outF * inF);
        _b = Param.Make($"{name}.b", outF, decay: false);
        float sigma = MathF.Sqrt(gain / inF);
        for (int i = 0; i < _w.W.Length; i++) _w.W[i] = init.Next(sigma);
    }

    public override void Collect(List<Param> ps)
    {
        ps.Add(_w);
        ps.Add(_b);
    }

    public override Tensor Forward(Tensor x, bool training)
    {
        if (training) _x = x;
        Out.Fit(x.Batch, _out, 1);
        var y = Out.Data;
        for (int b = 0; b < x.Batch; b++)
        {
            var xr = x.Data.AsSpan(b * _in, _in);
            for (int o = 0; o < _out; o++)
            {
                y[b * _out + o] = _b.W[o] + Vec.Dot(_w.W.AsSpan(o * _in, _in), xr, _in);
            }
        }
        return Out;
    }

    public override Tensor Backward(Tensor dy)
    {
        var x = _x ?? throw new InvalidOperationException("backward before forward");
        Grad.Fit(x.Batch, _in, 1);
        Grad.Zero();
        for (int b = 0; b < x.Batch; b++)
        {
            var xr = x.Data.AsSpan(b * _in, _in);
            var dxr = Grad.Data.AsSpan(b * _in, _in);
            for (int o = 0; o < _out; o++)
            {
                float g = dy.Data[b * _out + o];
                if (g == 0) continue;
                _b.G[o] += g;
                Vec.Axpy(g, xr, _w.G.AsSpan(o * _in, _in), _in);
                Vec.Axpy(g, _w.W.AsSpan(o * _in, _in), dxr, _in);
            }
        }
        return Grad;
    }
}

public sealed class TanhLayer : Layer
{
    private Tensor? _y;

    public override Tensor Forward(Tensor x, bool training)
    {
        Out.Fit(x.Batch, x.Channels, x.Length);
        int n = x.Count;
        for (int i = 0; i < n; i++) Out.Data[i] = MathF.Tanh(x.Data[i]);
        if (training) _y = Out;
        return Out;
    }

    public override Tensor Backward(Tensor dy)
    {
        var y = _y ?? throw new InvalidOperationException("backward before forward");
        Grad.Fit(dy.Batch, dy.Channels, dy.Length);
        int n = dy.Count;
        for (int i = 0; i < n; i++)
        {
            float t = y.Data[i];
            Grad.Data[i] = dy.Data[i] * (1 - t * t);
        }
        return Grad;
    }
}
