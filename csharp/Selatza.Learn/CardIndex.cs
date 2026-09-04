using Selatza.Cards;

namespace Selatza.Learn;

/// <summary>
/// What a card looks like once the rules text has been read for you. Effects are
/// functions rather than data, so the only machine-readable account of what a
/// card does is the text it prints; these tags are keyword matches over that
/// text plus the structural facts the definition already carries.
/// </summary>
[Flags]
public enum CardTag
{
    None = 0,
    Damage = 1 << 0,
    Wound = 1 << 1,
    Draw = 1 << 2,
    Debt = 1 << 3,
    Heal = 1 << 4,
    Buff = 1 << 5,
    Steal = 1 << 6,
    Mill = 1 << 7,
    Sap = 1 << 8,
    Revive = 1 << 9,
    Ramp = 1 << 10,
    Reach = 1 << 11,
    /// <summary>Prints a Store line, so the body sells an effect for debt.</summary>
    Store = 1 << 12,
    /// <summary>Gains or spends Love.</summary>
    Love = 1 << 13,
}

/// <summary>
/// A stable ordering of every registered card, plus the constant features that
/// hang off each one.
///
/// The order is the axis a convolution runs along, so it is grouped by colour,
/// then type, then level and cost. Neighbouring positions are cards that compete
/// for the same slot in a deck, which is what makes a kernel over three of them
/// mean anything.
/// </summary>
public static class CardIndex
{
    // The identity mask writes one channel per entry of Colors.All, so this
    // grew with the sixth colour, and by three more for the Store and Love
    // tags and the Store surcharge.
    public const int StaticChannels = 36;

    private static string[] _ids = Array.Empty<string>();
    private static CardDef[] _defs = Array.Empty<CardDef>();
    private static Dictionary<string, int> _lookup = new(StringComparer.Ordinal);
    private static byte[] _masks = Array.Empty<byte>();
    private static int[] _limits = Array.Empty<int>();
    private static CardTag[] _tags = Array.Empty<CardTag>();
    private static float[] _static = Array.Empty<float>();
    private static bool _built;

    public static int Count
    {
        get
        {
            EnsureBuilt();
            return _ids.Length;
        }
    }

    /// <summary>Idempotent. Registers the card sets first if nobody else has.</summary>
    public static void EnsureBuilt()
    {
        if (_built) return;
        CardSets.RegisterAll();
        Build();
        _built = true;
    }

    public static int Of(string cardId)
    {
        EnsureBuilt();
        return _lookup.TryGetValue(cardId, out var i) ? i : -1;
    }

    public static string Id(int index) => _ids[index];
    public static CardDef Def(int index) => _defs[index];
    public static byte Mask(int index) => _masks[index];
    public static int CopyLimit(int index) => _limits[index];
    public static CardTag Tags(int index) => _tags[index];

    /// <summary>Channel-major: <c>[channel * Count + card]</c>, matching a tensor plane.</summary>
    public static float[] StaticPlane
    {
        get
        {
            EnsureBuilt();
            return _static;
        }
    }

    public static IReadOnlyList<CardDef> Defs
    {
        get
        {
            EnsureBuilt();
            return _defs;
        }
    }

    /// <summary>Identity is a subset test, so a card is legal when it drags in no new colour.</summary>
    public static bool LegalUnder(int index, byte identity) => (_masks[index] & ~identity) == 0;

    public static byte MaskOf(IEnumerable<Color> colors)
    {
        byte m = 0;
        foreach (var c in colors) m |= (byte)(1 << (int)c);
        return m;
    }

    public static byte IdentityOf(string leaderId) => MaskOf(Identity.DeckIdentity(leaderId));

    private static int TypeRank(CardType t) => t switch
    {
        CardType.Summon => 1,
        CardType.Spell => 2,
        CardType.Trap => 3,
        _ => 4,
    };

    private static void Build()
    {
        var defs = Registry.All
            .OrderBy(c => (int)c.Color)
            .ThenBy(c => c.Color2 is { } c2 ? (int)c2 + 1 : 0)
            .ThenBy(c => TypeRank(c.Type))
            .ThenBy(c => c.Level)
            .ThenBy(c => c.Cost.Total)
            .ThenBy(c => c.Id, StringComparer.Ordinal)
            .ToArray();

        _defs = defs;
        _ids = defs.Select(d => d.Id).ToArray();
        _lookup = new Dictionary<string, int>(defs.Length, StringComparer.Ordinal);
        for (int i = 0; i < defs.Length; i++) _lookup[defs[i].Id] = i;

        _masks = new byte[defs.Length];
        _limits = new int[defs.Length];
        _tags = new CardTag[defs.Length];
        for (int i = 0; i < defs.Length; i++)
        {
            _masks[i] = MaskOf(Identity.ColorsOf(defs[i]));
            _limits[i] = Rarities.Limit(defs[i].Rarity);
            _tags[i] = TagsFor(defs[i]);
        }

        _static = new float[StaticChannels * defs.Length];
        for (int i = 0; i < defs.Length; i++) WriteStatic(defs[i], i, defs.Length);
    }

    /// <summary>Everything a card prints, powers and flip included.</summary>
    public static string AllText(CardDef d)
    {
        var sb = new System.Text.StringBuilder();
        if (d.Text is not null) sb.Append(d.Text).Append(' ');
        if (d.FlipText is not null) sb.Append(d.FlipText).Append(' ');
        foreach (var p in d.Powers ?? Array.Empty<Power>()) sb.Append(p.Text).Append(' ');
        return sb.ToString().ToLowerInvariant();
    }

    private static bool Any(string text, params string[] needles)
    {
        foreach (var n in needles)
        {
            if (text.Contains(n, StringComparison.Ordinal)) return true;
        }
        return false;
    }

    private static CardTag TagsFor(CardDef d)
    {
        var t = AllText(d);
        var tags = CardTag.None;
        if (Any(t, "deal ", "damage", "destroy", "flip a", "flip one", "flips")) tags |= CardTag.Damage;
        if (Any(t, "wound")) tags |= CardTag.Wound;
        if (Any(t, "draw", "look at", "search", "reveal")) tags |= CardTag.Draw;
        if (Any(t, "debt")) tags |= CardTag.Debt;
        if (Any(t, "unflip", "face down", "heal", "reinforce")) tags |= CardTag.Heal;
        if (Any(t, "strength", "gets +", "gains +", "permanently")) tags |= CardTag.Buff;
        if (Any(t, "take control", "seize", "return", "bounce", "becomes", "transform", "move ", "steal"))
        {
            tags |= CardTag.Steal;
        }
        if (Any(t, "mill", "discard")) tags |= CardTag.Mill;
        if (Any(t, "sap")) tags |= CardTag.Sap;
        if (Any(t, "from your debt", "from the debt", "out of debt", "revive")) tags |= CardTag.Revive;
        if (Any(t, "supporter", "mana", "extra card")) tags |= CardTag.Ramp;
        if (Any(t, "store:")) tags |= CardTag.Store;
        if (Any(t, "love")) tags |= CardTag.Love;
        // Reach is damage that arrives without a clash, which is what stops a
        // board of blockers from being an answer.
        if (d.Type != CardType.Summon && tags.HasFlag(CardTag.Damage)) tags |= CardTag.Reach;
        if (d.Type == CardType.Summon && tags.HasFlag(CardTag.Damage) && (d.Powers?.Length ?? 0) > 0)
        {
            tags |= CardTag.Reach;
        }
        return tags;
    }

    private static void WriteStatic(CardDef d, int card, int n)
    {
        int c = 0;
        void Put(float v) => _static[c++ * n + card] = v;

        Put(d.Type == CardType.Summon ? 1 : 0);
        Put(d.Type == CardType.Spell ? 1 : 0);
        Put(d.Type == CardType.Trap ? 1 : 0);
        Put(d.Type == CardType.Stage ? 1 : 0);
        Put(d.Starter ? 1 : 0);

        byte mask = _masks[card];
        foreach (var col in Colors.All) Put((mask & (1 << (int)col)) != 0 ? 1 : 0);
        Put(d.Color2 is not null ? 1 : 0);

        Put(d.Level / 3f);
        Put(d.Strength / 6f);
        Put(d.Hp / 8f);
        Put(d.Cost.Total / 4f);
        int maxColor = 0;
        foreach (var col in Colors.All) maxColor = Math.Max(maxColor, d.Cost[col]);
        Put(maxColor / 3f);
        Put(_limits[card] / 4f);

        Put(d.Flip is not null ? 1 : 0);
        Put(d.FlipCost is not null ? 1 : 0);
        Put((d.Powers?.Length ?? 0) / 3f);
        Put(d.Triggers is not null ? 1 : 0);
        Put((d.Targets?.Length ?? 0) / 2f);

        var tags = _tags[card];
        Put(tags.HasFlag(CardTag.Damage) ? 1 : 0);
        Put(tags.HasFlag(CardTag.Wound) ? 1 : 0);
        Put(tags.HasFlag(CardTag.Draw) ? 1 : 0);
        Put(tags.HasFlag(CardTag.Debt) ? 1 : 0);
        Put(tags.HasFlag(CardTag.Heal) ? 1 : 0);
        Put(tags.HasFlag(CardTag.Buff) ? 1 : 0);
        Put(tags.HasFlag(CardTag.Steal) ? 1 : 0);
        Put(tags.HasFlag(CardTag.Mill) ? 1 : 0);
        Put(tags.HasFlag(CardTag.Revive) ? 1 : 0);
        Put(tags.HasFlag(CardTag.Reach) ? 1 : 0);
        Put(tags.HasFlag(CardTag.Store) ? 1 : 0);
        Put(tags.HasFlag(CardTag.Love) ? 1 : 0);
        Put((d.Store?.Surcharge ?? 0) / 2f);

        if (c != StaticChannels)
        {
            throw new InvalidOperationException($"static channel count is {c}, declared {StaticChannels}");
        }
    }
}
