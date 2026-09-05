namespace Selatza.Learn.Nn;

/// <summary>Reshapes a feature map into a flat vector. No data moves.</summary>
public sealed class Flatten : Layer
{
    private int _c, _l;

    public override Tensor Forward(Tensor x, bool training)
    {
        _c = x.Channels;
        _l = x.Length;
        Out.Fit(x.Batch, x.Channels * x.Length, 1);
        Array.Copy(x.Data, Out.Data, x.Count);
        return Out;
    }

    public override Tensor Backward(Tensor dy)
    {
        Grad.Fit(dy.Batch, _c, _l);
        Array.Copy(dy.Data, Grad.Data, Grad.Count);
        return Grad;
    }
}

/// <summary>Joins the three towers into one vector per position.</summary>
public sealed class Concat3
{
    private readonly Tensor _out = new(1, 1, 1);
    private readonly Tensor _da = new(1, 1, 1);
    private readonly Tensor _db = new(1, 1, 1);
    private readonly Tensor _dc = new(1, 1, 1);
    private int _na, _nb, _nc;

    public Tensor Forward(Tensor a, Tensor b, Tensor c)
    {
        _na = a.Channels * a.Length;
        _nb = b.Channels * b.Length;
        _nc = c.Channels * c.Length;
        int total = _na + _nb + _nc;
        _out.Fit(a.Batch, total, 1);
        for (int i = 0; i < a.Batch; i++)
        {
            Array.Copy(a.Data, i * _na, _out.Data, i * total, _na);
            Array.Copy(b.Data, i * _nb, _out.Data, i * total + _na, _nb);
            Array.Copy(c.Data, i * _nc, _out.Data, i * total + _na + _nb, _nc);
        }
        return _out;
    }

    public (Tensor A, Tensor B, Tensor C) Backward(Tensor dy)
    {
        int total = _na + _nb + _nc;
        _da.Fit(dy.Batch, _na, 1);
        _db.Fit(dy.Batch, _nb, 1);
        _dc.Fit(dy.Batch, _nc, 1);
        for (int i = 0; i < dy.Batch; i++)
        {
            Array.Copy(dy.Data, i * total, _da.Data, i * _na, _na);
            Array.Copy(dy.Data, i * total + _na, _db.Data, i * _nb, _nb);
            Array.Copy(dy.Data, i * total + _na + _nb, _dc.Data, i * _nc, _nc);
        }
        return (_da, _db, _dc);
    }
}

/// <summary>Widths of every tower, so a run can be made smaller without editing code.</summary>
public sealed class NetShape
{
    public int CardStem { get; init; } = 24;
    public int CardMid { get; init; } = 32;
    public int EntityWidth { get; init; } = 16;
    public int EntityHead { get; init; } = 48;
    public int ScalarWidth { get; init; } = 64;
    public int TrunkWidth { get; init; } = 128;
    public int HeadWidth { get; init; } = 64;

    public static NetShape Default => new();

    public static NetShape Small => new()
    {
        CardStem = 16,
        CardMid = 24,
        EntityWidth = 12,
        EntityHead = 32,
        ScalarWidth = 48,
        TrunkWidth = 80,
        HeadWidth = 48,
    };

    public override string ToString() =>
        $"stem {CardStem} mid {CardMid} ent {EntityWidth}/{EntityHead} sca {ScalarWidth} trunk {TrunkWidth}/{HeadWidth}";
}

/// <summary>
/// Three convolutional towers over one position, fused into a value.
///
/// The card tower is the point of the whole design: one column per card in a
/// fixed ordering, so a kernel of three reads a card next to the cards that
/// compete with it, and the static half of every column tells the network what
/// the card at that position actually does. The other two towers carry the six
/// bodies on the table and the clocks.
///
/// Two auxiliary heads hang off the trunk, guessing what the opponent is
/// holding. Nothing consults them at play time; they exist because a trunk that
/// can answer them is a trunk that has learned to read a card-counting plane
/// rather than ignore it.
/// </summary>
public sealed class SelatzaNet
{
    public const int Magic = 0x314E4E53; // "SNN1"
    /// <summary>
    /// One bucket per colour per card type. Sized off the Color enum itself,
    /// Neutral included, because the hardcoded "five colours" this replaced
    /// silently overflowed when Neutral and then Candy pushed the enum past it.
    /// </summary>
    public static readonly int HandBuckets = Enum.GetValues<Color>().Length * 5;

    private readonly List<Layer> _cardTower = new();
    private readonly List<Layer> _entityTower = new();
    private readonly List<Layer> _scalarTower = new();
    private readonly List<Layer> _trunk = new();
    private readonly Concat3 _concat = new();
    private readonly Dense _headValue;
    private readonly TanhLayer _valueAct = new();
    private readonly Dense _headHand;
    private readonly Dense _headTrap;
    private readonly List<Param> _params = new();

    private readonly Tensor _cardIn = new(1, 1, 1);
    private readonly Tensor _entIn = new(1, 1, 1);
    private readonly Tensor _scaIn = new(1, 1, 1);
    private readonly Tensor _dTrunk = new(1, 1, 1);
    private readonly Tensor _dValue = new(1, 1, 1);
    private readonly Tensor _dHand = new(1, 1, 1);
    private readonly Tensor _dTrap = new(1, 1, 1);

    public NetShape Shape { get; }
    public int CardCount { get; }
    public int SampleSize { get; }

    public SelatzaNet(NetShape shape, int seed)
    {
        CardIndex.EnsureBuilt();
        Shape = shape;
        CardCount = CardIndex.Count;
        SampleSize = Encoder.CardChannels * CardCount
            + Encoder.EntityChannels * Encoder.Entities
            + Encoder.ScalarCount;

        var g = new Gauss(seed);

        _cardTower.Add(new CardStem("stem", Encoder.CardChannels, shape.CardStem,
            CardIndex.StaticPlane, CardIndex.StaticChannels, CardCount, g));
        _cardTower.Add(new Relu());
        _cardTower.Add(new MaxPool1D());
        _cardTower.Add(new Conv1D("c1.dw", shape.CardStem, shape.CardStem, 3, shape.CardStem, g));
        _cardTower.Add(new Relu());
        _cardTower.Add(new Conv1D("c1.pw", shape.CardStem, shape.CardMid, 1, 1, g));
        _cardTower.Add(new Relu());
        _cardTower.Add(new MaxPool1D());
        _cardTower.Add(new Conv1D("c2.dw", shape.CardMid, shape.CardMid, 3, shape.CardMid, g));
        _cardTower.Add(new Relu());
        _cardTower.Add(new Conv1D("c2.pw", shape.CardMid, shape.CardMid, 1, 1, g));
        _cardTower.Add(new Relu());
        _cardTower.Add(new GlobalPool());

        _entityTower.Add(new Conv1D("e0", Encoder.EntityChannels, shape.EntityWidth, 1, 1, g));
        _entityTower.Add(new Relu());
        _entityTower.Add(new Conv1D("e1", shape.EntityWidth, shape.EntityWidth, 3, 1, g));
        _entityTower.Add(new Relu());
        _entityTower.Add(new Flatten());
        _entityTower.Add(new Dense("e2", shape.EntityWidth * Encoder.Entities, shape.EntityHead, g));
        _entityTower.Add(new Relu());

        _scalarTower.Add(new Dense("s0", Encoder.ScalarCount, shape.ScalarWidth, g));
        _scalarTower.Add(new Relu());

        int fused = shape.CardMid * 2 + shape.EntityHead + shape.ScalarWidth;
        _trunk.Add(new Dense("t0", fused, shape.TrunkWidth, g));
        _trunk.Add(new Relu());
        _trunk.Add(new Dense("t1", shape.TrunkWidth, shape.HeadWidth, g));
        _trunk.Add(new Relu());

        _headValue = new Dense("h.value", shape.HeadWidth, 1, g, gain: 0.5f);
        _headHand = new Dense("h.hand", shape.HeadWidth, HandBuckets, g, gain: 0.5f);
        _headTrap = new Dense("h.trap", shape.HeadWidth, 1, g, gain: 0.5f);

        foreach (var l in AllLayers()) l.Collect(_params);
    }

    private IEnumerable<Layer> AllLayers()
    {
        foreach (var l in _cardTower) yield return l;
        foreach (var l in _entityTower) yield return l;
        foreach (var l in _scalarTower) yield return l;
        foreach (var l in _trunk) yield return l;
        yield return _headValue;
        yield return _headHand;
        yield return _headTrap;
    }

    public IReadOnlyList<Param> Parameters => _params;

    public int ParameterCount
    {
        get
        {
            int n = 0;
            foreach (var p in _params) n += p.W.Length;
            return n;
        }
    }

    public void AfterStep()
    {
        foreach (var l in AllLayers()) l.AfterStep();
    }

    /// <summary>Values for a batch of packed observations. One float per sample.</summary>
    public float[] Value(float[] samples, int batch)
    {
        Forward(samples, batch, training: false);
        var outv = new float[batch];
        Array.Copy(_valueAct.LastOutput.Data, outv, batch);
        return outv;
    }

    /// <summary>Values written into a caller-owned buffer, so a search allocates nothing.</summary>
    public void ValueInto(float[] samples, int batch, float[] dest)
    {
        Forward(samples, batch, training: false);
        Array.Copy(_valueAct.LastOutput.Data, dest, batch);
    }

    public Tensor Forward(float[] samples, int batch, bool training) =>
        Forward(samples, 0, batch, training);

    /// <summary>Reads <paramref name="batch"/> samples starting at a sample offset.</summary>
    public Tensor Forward(float[] samples, int firstSample, int batch, bool training)
    {
        int cardPlane = Encoder.CardChannels * CardCount;
        int entPlane = Encoder.EntityChannels * Encoder.Entities;
        _cardIn.Fit(batch, Encoder.CardChannels, CardCount);
        _entIn.Fit(batch, Encoder.EntityChannels, Encoder.Entities);
        _scaIn.Fit(batch, Encoder.ScalarCount, 1);
        for (int b = 0; b < batch; b++)
        {
            int src = (firstSample + b) * SampleSize;
            Array.Copy(samples, src, _cardIn.Data, b * cardPlane, cardPlane);
            Array.Copy(samples, src + cardPlane, _entIn.Data, b * entPlane, entPlane);
            Array.Copy(samples, src + cardPlane + entPlane, _scaIn.Data, b * Encoder.ScalarCount,
                Encoder.ScalarCount);
        }

        var c = Run(_cardTower, _cardIn, training);
        var e = Run(_entityTower, _entIn, training);
        var s = Run(_scalarTower, _scaIn, training);
        var t = Run(_trunk, _concat.Forward(c, e, s), training);

        _valueAct.Forward(_headValue.Forward(t, training), training);
        _headHand.Forward(t, training);
        _headTrap.Forward(t, training);
        return _valueAct.LastOutput;
    }

    public Tensor LastValue => _valueAct.LastOutput;
    public Tensor LastHand => _headHand.LastOutput;
    public Tensor LastTrap => _headTrap.LastOutput;

    private static Tensor Run(List<Layer> stack, Tensor x, bool training)
    {
        foreach (var l in stack) x = l.Forward(x, training);
        return x;
    }

    private static Tensor RunBack(List<Layer> stack, Tensor dy)
    {
        for (int i = stack.Count - 1; i >= 0; i--) dy = stack[i].Backward(dy);
        return dy;
    }

    /// <summary>
    /// Gradients for one batch. The three deltas are by the loss, already scaled
    /// by whatever weight the caller gives each head.
    /// </summary>
    public void Backward(float[] dValue, float[] dHand, float[] dTrap, int batch)
    {
        _dValue.Fit(batch, 1, 1);
        Array.Copy(dValue, _dValue.Data, batch);
        _dHand.Fit(batch, HandBuckets, 1);
        Array.Copy(dHand, _dHand.Data, batch * HandBuckets);
        _dTrap.Fit(batch, 1, 1);
        Array.Copy(dTrap, _dTrap.Data, batch);

        var dv = _headValue.Backward(_valueAct.Backward(_dValue));
        _dTrunk.Fit(batch, Shape.HeadWidth, 1);
        Array.Copy(dv.Data, _dTrunk.Data, batch * Shape.HeadWidth);

        var dh = _headHand.Backward(_dHand);
        for (int i = 0; i < batch * Shape.HeadWidth; i++) _dTrunk.Data[i] += dh.Data[i];
        var dt = _headTrap.Backward(_dTrap);
        for (int i = 0; i < batch * Shape.HeadWidth; i++) _dTrunk.Data[i] += dt.Data[i];

        var dFused = RunBack(_trunk, _dTrunk);
        var (dc, de, ds) = _concat.Backward(dFused);
        RunBack(_cardTower, dc);
        RunBack(_entityTower, de);
        RunBack(_scalarTower, ds);
    }

    // --- persistence ---------------------------------------------------------

    public void Save(string path)
    {
        using var fs = File.Create(path);
        using var w = new BinaryWriter(fs);
        w.Write(Magic);
        w.Write(CardCount);
        w.Write(Encoder.CardChannels);
        w.Write(Encoder.EntityChannels);
        w.Write(Encoder.ScalarCount);
        w.Write(Shape.CardStem);
        w.Write(Shape.CardMid);
        w.Write(Shape.EntityWidth);
        w.Write(Shape.EntityHead);
        w.Write(Shape.ScalarWidth);
        w.Write(Shape.TrunkWidth);
        w.Write(Shape.HeadWidth);
        w.Write(_params.Count);
        foreach (var p in _params)
        {
            w.Write(p.Name);
            w.Write(p.W.Length);
            foreach (var v in p.W) w.Write(v);
        }
    }

    public static SelatzaNet Load(string path)
    {
        using var fs = File.OpenRead(path);
        using var r = new BinaryReader(fs);
        if (r.ReadInt32() != Magic) throw new InvalidDataException($"{path} is not a Selatza network");
        int cards = r.ReadInt32();
        int cardCh = r.ReadInt32();
        int entCh = r.ReadInt32();
        int scalars = r.ReadInt32();
        CardIndex.EnsureBuilt();
        if (cards != CardIndex.Count || cardCh != Encoder.CardChannels
            || entCh != Encoder.EntityChannels || scalars != Encoder.ScalarCount)
        {
            throw new InvalidDataException(
                $"{path} was trained against a different feature set "
                + $"({cards}/{cardCh}/{entCh}/{scalars} vs "
                + $"{CardIndex.Count}/{Encoder.CardChannels}/{Encoder.EntityChannels}/{Encoder.ScalarCount})");
        }
        var shape = new NetShape
        {
            CardStem = r.ReadInt32(),
            CardMid = r.ReadInt32(),
            EntityWidth = r.ReadInt32(),
            EntityHead = r.ReadInt32(),
            ScalarWidth = r.ReadInt32(),
            TrunkWidth = r.ReadInt32(),
            HeadWidth = r.ReadInt32(),
        };
        var net = new SelatzaNet(shape, 1);
        int count = r.ReadInt32();
        if (count != net._params.Count)
        {
            throw new InvalidDataException($"{path} holds {count} tensors, this build wants {net._params.Count}");
        }
        foreach (var p in net._params)
        {
            string name = r.ReadString();
            int len = r.ReadInt32();
            if (name != p.Name || len != p.W.Length)
            {
                throw new InvalidDataException($"{path}: expected {p.Name}[{p.W.Length}], found {name}[{len}]");
            }
            for (int i = 0; i < len; i++) p.W[i] = r.ReadSingle();
        }
        net.AfterStep();
        return net;
    }

    /// <summary>
    /// The network as the client reads it: the card order, the constant facts
    /// the observation needs per column, the widths, and every tensor as base64
    /// float32, with the card stem's static half already folded into its
    /// per-column bias so the client never needs the static plane.
    /// </summary>
    public void ExportJson(string path)
    {
        int n = CardCount;
        var cards = new string[n];
        var masks = new int[n];
        var limits = new int[n];
        var tags = new int[n];
        for (int i = 0; i < n; i++)
        {
            cards[i] = CardIndex.Id(i);
            masks[i] = CardIndex.Mask(i);
            limits[i] = CardIndex.CopyLimit(i);
            tags[i] = (int)CardIndex.Tags(i);
        }
        var ps = new Dictionary<string, string>();
        foreach (var p in _params) ps[p.Name] = Base64(p.W);
        ps["stem.bias"] = Base64(((CardStem)_cardTower[0]).FoldedBias);
        var doc = new Dictionary<string, object>
        {
            ["format"] = 1,
            ["cards"] = cards,
            ["masks"] = masks,
            ["limits"] = limits,
            ["tags"] = tags,
            ["channels"] = new Dictionary<string, int>
            {
                ["card"] = Encoder.CardChannels,
                ["entity"] = Encoder.EntityChannels,
                ["scalar"] = Encoder.ScalarCount,
                ["entities"] = Encoder.Entities,
                ["perSide"] = Encoder.PerSide,
            },
            ["shape"] = new Dictionary<string, int>
            {
                ["cardStem"] = Shape.CardStem,
                ["cardMid"] = Shape.CardMid,
                ["entityWidth"] = Shape.EntityWidth,
                ["entityHead"] = Shape.EntityHead,
                ["scalarWidth"] = Shape.ScalarWidth,
                ["trunkWidth"] = Shape.TrunkWidth,
                ["headWidth"] = Shape.HeadWidth,
            },
            ["params"] = ps,
        };
        File.WriteAllText(path, System.Text.Json.JsonSerializer.Serialize(doc));
    }

    private static string Base64(float[] v) =>
        Convert.ToBase64String(System.Runtime.InteropServices.MemoryMarshal.AsBytes(v.AsSpan()));

    /// <summary>A copy with the same weights, for a rival that will train away from it.</summary>
    public SelatzaNet CloneWeights(int seed)
    {
        var copy = new SelatzaNet(Shape, seed);
        for (int i = 0; i < _params.Count; i++)
        {
            Array.Copy(_params[i].W, copy._params[i].W, _params[i].W.Length);
        }
        copy.AfterStep();
        return copy;
    }

    /// <summary>
    /// Overwrites this network's weights from another of the same shape. Play is
    /// parallel and the layer buffers are not shared, so each worker holds a
    /// replica that is refreshed from the master between rounds.
    /// </summary>
    public void CopyWeightsFrom(SelatzaNet src)
    {
        if (src._params.Count != _params.Count) throw new ArgumentException("shape mismatch");
        for (int i = 0; i < _params.Count; i++)
        {
            if (src._params[i].W.Length != _params[i].W.Length) throw new ArgumentException("shape mismatch");
            Array.Copy(src._params[i].W, _params[i].W, _params[i].W.Length);
        }
        AfterStep();
    }

    /// <summary>Shakes the weights, which is how a losing agent gets a different opinion.</summary>
    public void Perturb(float sigma, Gauss g)
    {
        foreach (var p in _params)
        {
            for (int i = 0; i < p.W.Length; i++) p.W[i] += g.Next(sigma);
        }
        AfterStep();
    }
}
