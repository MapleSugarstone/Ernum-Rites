namespace Selatza;

public static class Identity
{
    /// <summary>
    /// A card's colour identity. Dual cards carry both of theirs and triples all
    /// three; a card may declare a wider identity than its frame, which is how the
    /// test leader plays anything.
    /// </summary>
    public static Color[] ColorsOf(CardDef def)
    {
        // A neutral card drags in no colour, so the subset test passes under any
        // leader and every deck may run it.
        if (def.Color == Color.N || def.Neutral) return Array.Empty<Color>();
        if (def.Identity is { Length: > 0 }) return def.Identity;
        // Ernum is not one of the six, so a card printed in it brings whatever
        // identity it spells out and nothing more.
        if (def.Color == Color.E) return Array.Empty<Color>();
        var out_ = new List<Color> { def.Color };
        if (def.Color2 is { } c2) out_.Add(c2);
        if (def.Color3 is { } c3) out_.Add(c3);
        return out_.ToArray();
    }

    /// <summary>
    /// The colours a deck may play, taken from whatever is standing as its leader.
    ///
    /// A leader brings its own colours plus every colour its costs are written in.
    /// The Maestro is Solar and its power is paid in Pepper: without this it could
    /// never legally run a card that pays for its own power. The rule reads off
    /// the card, so a leader cannot demand mana its deck is forbidden to supply.
    /// </summary>
    public static Color[] DeckIdentity(string leaderId)
    {
        var def = Registry.TryCard(leaderId);
        if (def is null) return Array.Empty<Color>();
        var identity = new List<Color>(ColorsOf(def));

        void Add(Cost cost)
        {
            foreach (var c in Colors.All)
            {
                if (cost[c] > 0 && !identity.Contains(c)) identity.Add(c);
            }
        }

        Add(def.Cost);
        foreach (var power in def.Powers ?? Array.Empty<Power>()) Add(power.Cost);
        return identity.ToArray();
    }

    /// <summary>
    /// Identity works like a subset, not an overlap: every colour on a card has
    /// to be one the leader already brings. A mono leader cannot play dual cards.
    /// </summary>
    public static bool IsLegalUnder(CardDef def, IReadOnlyList<Color> identity)
    {
        foreach (var c in ColorsOf(def)) if (!identity.Contains(c)) return false;
        return true;
    }

    public static (bool Ok, Color[] Identity, List<string> OffColor) CheckDeckColors(
        string leaderId, IEnumerable<string> cards)
    {
        var identity = DeckIdentity(leaderId);
        var off = new List<string>();
        foreach (var id in cards.Distinct(StringComparer.Ordinal))
        {
            var def = Registry.TryCard(id);
            if (def is null) continue;
            if (!IsLegalUnder(def, identity)) off.Add(id);
        }
        return (off.Count == 0, identity, off);
    }

    /// <summary>Anything with a body can stand as a leader, not just leader cards.</summary>
    public static bool CanBeLeader(string cardId)
    {
        var def = Registry.TryCard(cardId);
        if (def is null) return false;
        return def.Type == CardType.Summon && def.Hp > 0;
    }
}
