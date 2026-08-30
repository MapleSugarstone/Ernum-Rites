using System.Numerics;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

namespace Selatza.Learn.Nn;

/// <summary>
/// A batch of 1-D feature maps: <c>[batch][channel][length]</c>, flat and
/// reused between passes so a forward sweep allocates nothing.
/// </summary>
public sealed class Tensor
{
    public float[] Data;
    public int Batch;
    public int Channels;
    public int Length;

    public Tensor(int batch, int channels, int length)
    {
        Batch = batch;
        Channels = channels;
        Length = length;
        Data = new float[batch * channels * length];
    }

    public int Stride => Channels * Length;
    public int Count => Batch * Channels * Length;

    public int Index(int b, int c, int l) => (b * Channels + c) * Length + l;

    public Span<float> Row(int b, int c) => Data.AsSpan((b * Channels + c) * Length, Length);

    public Span<float> Sample(int b) => Data.AsSpan(b * Stride, Stride);

    /// <summary>Resizes in place when the batch grows, so buffers settle after a few calls.</summary>
    public Tensor Fit(int batch, int channels, int length)
    {
        int need = batch * channels * length;
        if (Data.Length < need) Data = new float[need];
        Batch = batch;
        Channels = channels;
        Length = length;
        return this;
    }

    public void Zero() => Array.Clear(Data, 0, Count);

    public static Tensor Like(Tensor t) => new(t.Batch, t.Channels, t.Length);
}

public static class Vec
{
    /// <summary>y += a * x, over n floats.</summary>
    public static void Axpy(float a, ReadOnlySpan<float> x, Span<float> y, int n)
    {
        int i = 0;
        int w = Vector<float>.Count;
        if (w > 1 && n >= w)
        {
            var va = new Vector<float>(a);
            for (; i <= n - w; i += w)
            {
                var vx = new Vector<float>(x.Slice(i, w));
                var vy = new Vector<float>(y.Slice(i, w));
                (vy + va * vx).CopyTo(y.Slice(i, w));
            }
        }
        for (; i < n; i++) y[i] += a * x[i];
    }

    /// <summary>
    /// y[o] = bias[o] + sum over inputs of w[o, i] * x[i], for every position at
    /// once. Written this way round because the accumulator then stays in a
    /// register across the input channels: the obvious version, an axpy per
    /// (output, input) pair, moves the output row through memory once per input
    /// channel and spends most of its time doing that rather than arithmetic.
    /// </summary>
    public static void Pointwise(ReadOnlySpan<float> w, ReadOnlySpan<float> x, Span<float> y,
        ReadOnlySpan<float> biasPlane, ReadOnlySpan<float> biasPerChannel, int inC, int outC, int L)
    {
        int width = Vector<float>.Count;
        ref float xr = ref MemoryMarshal.GetReference(x);
        ref float yr = ref MemoryMarshal.GetReference(y);
        ref float wr = ref MemoryMarshal.GetReference(w);
        bool plane = !biasPlane.IsEmpty;
        ref float br = ref plane
            ? ref MemoryMarshal.GetReference(biasPlane)
            : ref MemoryMarshal.GetReference(y);

        for (int oc = 0; oc < outC; oc++)
        {
            float scalarBias = biasPerChannel.IsEmpty ? 0 : biasPerChannel[oc];
            int l = 0;
            for (; l <= L - width; l += width)
            {
                var acc = plane
                    ? Vector.LoadUnsafe(ref br, (nuint)(oc * L + l))
                    : new Vector<float>(scalarBias);
                for (int ic = 0; ic < inC; ic++)
                {
                    float wv = Unsafe.Add(ref wr, oc * inC + ic);
                    if (wv == 0) continue;
                    acc += new Vector<float>(wv) * Vector.LoadUnsafe(ref xr, (nuint)(ic * L + l));
                }
                acc.StoreUnsafe(ref yr, (nuint)(oc * L + l));
            }
            for (; l < L; l++)
            {
                float acc = plane ? biasPlane[oc * L + l] : scalarBias;
                for (int ic = 0; ic < inC; ic++) acc += w[oc * inC + ic] * x[ic * L + l];
                y[oc * L + l] = acc;
            }
        }
    }

    /// <summary>dx[i] += sum over outputs of w[o, i] * dy[o], the transpose of the above.</summary>
    public static void PointwiseDx(ReadOnlySpan<float> w, ReadOnlySpan<float> dy, Span<float> dx,
        int inC, int outC, int L)
    {
        int width = Vector<float>.Count;
        ref float dyr = ref MemoryMarshal.GetReference(dy);
        ref float dxr = ref MemoryMarshal.GetReference(dx);
        ref float wr = ref MemoryMarshal.GetReference(w);

        for (int ic = 0; ic < inC; ic++)
        {
            int l = 0;
            for (; l <= L - width; l += width)
            {
                var acc = Vector.LoadUnsafe(ref dxr, (nuint)(ic * L + l));
                for (int oc = 0; oc < outC; oc++)
                {
                    float wv = Unsafe.Add(ref wr, oc * inC + ic);
                    if (wv == 0) continue;
                    acc += new Vector<float>(wv) * Vector.LoadUnsafe(ref dyr, (nuint)(oc * L + l));
                }
                acc.StoreUnsafe(ref dxr, (nuint)(ic * L + l));
            }
            for (; l < L; l++)
            {
                float acc = dx[ic * L + l];
                for (int oc = 0; oc < outC; oc++) acc += w[oc * inC + ic] * dy[oc * L + l];
                dx[ic * L + l] = acc;
            }
        }
    }

    public static float Dot(ReadOnlySpan<float> a, ReadOnlySpan<float> b, int n)
    {
        int i = 0;
        float sum = 0;
        int w = Vector<float>.Count;
        if (w > 1 && n >= w)
        {
            var acc = Vector<float>.Zero;
            for (; i <= n - w; i += w)
            {
                acc += new Vector<float>(a.Slice(i, w)) * new Vector<float>(b.Slice(i, w));
            }
            sum = Vector.Dot(acc, Vector<float>.One);
        }
        for (; i < n; i++) sum += a[i] * b[i];
        return sum;
    }
}
