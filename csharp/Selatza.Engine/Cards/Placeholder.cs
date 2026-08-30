namespace Selatza.Cards;

/// <summary>
/// Vanilla cards with no text, for testing combat maths. Always common so a lab
/// deck can run four of anything, and the leader is every colour so lab decks may
/// mix freely.
/// </summary>
public static class Placeholder
{
    private static readonly (int Strength, int Hp, string Roman)[] Stats =
    {
        default, (1, 1, "I"), (2, 3, "II"), (3, 5, "III"),
    };

    private static CardDef Dummy(Color c, int level)
    {
        var (str, hp, roman) = Stats[level];
        return new CardDef
        {
            Id = $"x-{Colors.Letter(c).ToLowerInvariant()}-dummy-{level}",
            Name = $"{Colors.Name(c)} Dummy {roman}",
            Color = c,
            Type = CardType.Summon,
            Level = level,
            Strength = str,
            Hp = hp,
            Num = $"T{level}{Colors.Letter(c)}",
            Text = "No abilities.",
        };
    }

    private static CardDef TestBolt(Color c) => new()
    {
        Id = $"x-{Colors.Letter(c).ToLowerInvariant()}-bolt",
        Name = $"{Colors.Name(c)} Test Bolt",
        Color = c,
        Type = CardType.Spell,
        Cost = c switch
        {
            Color.P => new Cost(P: 1),
            Color.O => new Cost(O: 1),
            Color.R => new Cost(R: 1),
            Color.F => new Cost(F: 1),
            _ => new Cost(S: 1),
        },
        Num = $"TX{Colors.Letter(c)}",
        Text = "Deal 2 to an enemy summon.",
        Targets = new[] { Kit.Enemy() },
        Effect = ctx => ctx.Damage(ctx.Target(0), 2),
    };

    /// <summary>
    /// Oil's curses. They carry no art because they are never in anyone's deck
    /// to begin with: Oil puts them there mid-game, and from then on they are
    /// drawn like any other card and turn up as face-down HP like any other
    /// card. Each one is a bad thing waiting for the moment it flips.
    /// </summary>
    private static CardDef Curse(string file, string name, string flipText,
        Action<FlipCtx> flip, string? art = null) => new()
    {
        Id = $"o-curse-{file}",
        Name = name,
        Color = Color.O,
        Type = CardType.Spell,
        Level = 1,
        Uncollectible = true,
        Num = $"C{file[..2].ToUpperInvariant()}",
        Text = "Does nothing in your hand.",
        FlipText = flipText,
        Flip = flip,
        Art = art,
    };

    public static CardDef[] Curses() => new[]
    {
        Curse("rot", "Rot", "You take 1 debt.", c => c.AddDebt(c.Me, Potent(c) ? 2 : 1),
            "Cardgame/Extras/Rot.png"),
        Curse("dread", "Dread", "The attached character takes a Wound.",
            c => c.Wound(c.HolderRef, Potent(c) ? 2 : 1), "Cardgame/Extras/Dread.png"),
        Curse("ruin", "Ruin", "Mill 1.", c => c.Mill(c.Me, Potent(c) ? 2 : 1)),
        Curse("spite", "Spite", "The enemy draws a card.", c => c.Draw(c.Opp, Potent(c) ? 2 : 1)),
    };

    /// <summary>Whether the victim's opponent fields a card that doubles curse effects.</summary>
    private static bool Potent(FlipCtx c)
    {
        var foe = c.State.Players[GameState.Other(c.Me)];
        foreach (var s in foe.Slots)
        {
            if (s is not null && Registry.Card(s.CardId).CursePotency) return true;
        }
        return foe.Leader is not null && Registry.Card(foe.Leader.CardId).CursePotency;
    }

    /// <summary>Bodies that carry one keyword and nothing else, for testing it.</summary>
    private static CardDef Keyworded(string file, string name, string text,
        bool redirect = false, bool spellImmune = false, bool starter = false) => new()
    {
        Id = $"x-n-{file}",
        Name = name,
        Color = Color.R,
        Type = CardType.Summon,
        Starter = starter,
        Level = starter ? 3 : 2,
        Strength = 1,
        Hp = 3,
        Num = $"TK{file[..2].ToUpperInvariant()}",
        Identity = Colors.All,
        Text = text,
        Redirect = redirect,
        SpellImmune = spellImmune,
    };

    public static CardDef[] Build()
    {
        var list = new List<CardDef>();
        list.AddRange(Curses());
        list.Add(Keyworded("redirect", "Lightning Rod", "Redirection.", redirect: true));
        list.Add(Keyworded("redirect-leader", "Rod Warden", "Redirection.", redirect: true, starter: true));
        list.Add(Keyworded("immune", "Warded Dummy", "Spell Immunity.", spellImmune: true));
        list.AddRange(new List<CardDef>
        {
            new()
            {
                // The "hero" in the id predates the rename to leaders and stays:
                // changing it would orphan saved decks and recorded replays.
                Id = "x-hero-dummy-warden",
                Name = "Dummy Warden",
                Color = Color.R,
                Starter = true,
                Strength = 1,
                Hp = 3,
                Level = 3,
                Num = "T000",
                Identity = Colors.All,
                Text = "No powers. Every color.",
            },
        });
        foreach (var c in Colors.All)
        {
            list.Add(Dummy(c, 1));
            list.Add(Dummy(c, 2));
            list.Add(Dummy(c, 3));
        }
        foreach (var c in Colors.All) list.Add(TestBolt(c));
        return list.ToArray();
    }
}
