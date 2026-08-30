namespace Selatza;

/// <summary>
/// Cards minted during a match. Each builder derives a deterministic id from
/// its inputs and registers a full CardDef, so the product renders, inspects
/// and plays like any printed card, and both engines agree on it move for move.
/// </summary>
public static class Generated
{
    private static int ColoredTotal(Cost cost) => cost.Colored;

    /// <summary>A copy of any card rebuilt in Robot: same rules text, every colour pip now R.</summary>
    public static string RobotCopy(string sourceId)
    {
        var src = Registry.Card(sourceId);
        var cost = new Cost(R: ColoredTotal(src.Cost), C: src.Cost.C);
        return Registry.RegisterGenerated(new CardDef
        {
            Id = $"gen-hack-{sourceId}",
            Name = src.Name,
            Color = Color.R,
            Color2 = null,
            Color3 = null,
            Identity = null,
            Type = src.Type,
            Text = src.Text,
            Cost = cost,
            Strength = src.Strength,
            Hp = src.Hp,
            Level = src.Level,
            Factions = src.Factions,
            Neutral = src.Neutral,
            Redirect = src.Redirect,
            SpellImmune = src.SpellImmune,
            EffectDamage = src.EffectDamage,
            WoundAmplify = src.WoundAmplify,
            SupporterLock = src.SupporterLock,
            SpellTrap = src.SpellTrap,
            SpellEcho = src.SpellEcho,
            CursePotency = src.CursePotency,
            MuffleFlips = src.MuffleFlips,
            Stationary = src.Stationary,
            Uncollectible = true,
            Art = src.Art,
            Artist = src.Artist,
            Num = "GEN",
            Powers = src.Powers,
            Triggers = src.Triggers,
            Targets = src.Targets,
            Effect = src.Effect,
            Flip = src.Flip,
            FlipText = src.FlipText,
            FlipCost = src.FlipCost,
            StageHooks = src.StageHooks,
        });
    }

    /// <summary>
    /// The Banana recoloured to match whoever is being handed it, so the gift pays
    /// the colour that player actually spends rather than filling colourless.
    /// </summary>
    public static string ColoredBanana(string bananaId, Color color)
    {
        var src = Registry.Card(bananaId);
        return Registry.RegisterGenerated(new CardDef
        {
            Id = $"gen-banana-{color}",
            Name = src.Name,
            Color = color,
            Neutral = false,
            Type = src.Type,
            Level = src.Level,
            Text = src.Text,
            Uncollectible = true,
            Art = src.Art,
            Artist = src.Artist,
            Num = "GEN",
        });
    }

    /// <summary>A copy of a spell rebuilt in Oil, for a body that lends it out as a Power.</summary>
    public static string OilCopy(string sourceId)
    {
        var src = Registry.Card(sourceId);
        return Registry.RegisterGenerated(new CardDef
        {
            Id = $"gen-oil-{sourceId}",
            Name = src.Name,
            Color = Color.O,
            Color2 = null,
            Color3 = null,
            Identity = null,
            Type = src.Type,
            Text = src.Text,
            Cost = OiledCost(src.Cost),
            Strength = src.Strength,
            Hp = src.Hp,
            Level = src.Level,
            Factions = src.Factions,
            Neutral = src.Neutral,
            Redirect = src.Redirect,
            SpellImmune = src.SpellImmune,
            EffectDamage = src.EffectDamage,
            WoundAmplify = src.WoundAmplify,
            SupporterLock = src.SupporterLock,
            SpellTrap = src.SpellTrap,
            SpellEcho = src.SpellEcho,
            CursePotency = src.CursePotency,
            MuffleFlips = src.MuffleFlips,
            Stationary = src.Stationary,
            Uncollectible = true,
            Art = src.Art,
            Artist = src.Artist,
            Num = "GEN",
            // A body's Powers and flip price are costs too. Leaving them in
            // their old colours hands a mono-Oil deck a button it can never pay.
            Powers = Repriced(src.Powers, OiledCost),
            Triggers = src.Triggers,
            Targets = src.Targets,
            Effect = src.Effect,
            Flip = src.Flip,
            FlipText = src.FlipText,
            FlipCost = Repriced(src.FlipCost, OiledCost),
            StageHooks = src.StageHooks,
        });
    }

    /// <summary>Rebuilds every Power's price with <paramref name="reprice"/>, leaving the rest of the Power alone.</summary>
    private static Power[]? Repriced(Power[]? powers, Func<Cost, Cost> reprice)
    {
        if (powers is null) return null;
        var outList = new Power[powers.Length];
        for (int i = 0; i < powers.Length; i++)
        {
            var p = powers[i];
            outList[i] = new Power
            {
                Name = p.Name,
                Cost = reprice(p.Cost),
                Text = p.Text,
                Targets = p.Targets,
                OncePerTurn = p.OncePerTurn,
                SapSelf = p.SapSelf,
                Effect = p.Effect,
            };
        }
        return outList;
    }

    private static FlipCost? Repriced(FlipCost? flip, Func<Cost, Cost> reprice) =>
        flip is null ? null : new FlipCost
        {
            Mana = reprice(flip.Mana),
            Mill = flip.Mill,
            Discard = flip.Discard,
        };

    /// <summary>A copy of a card rebuilt in Oil with its colour pips spread across Oil, Robot and Pepper. Oil takes the odd pips, so a one-pip spell costs one Oil.</summary>
    public static string MalwareCopy(string sourceId)
    {
        var src = Registry.Card(sourceId);
        return Registry.RegisterGenerated(new CardDef
        {
            Id = $"gen-malware-{sourceId}",
            Name = src.Name,
            Color = Color.O,
            Color2 = Color.R,
            Color3 = Color.P,
            Identity = null,
            Type = src.Type,
            Text = src.Text,
            Cost = SplitThreeWays(src.Cost),
            Strength = src.Strength,
            Hp = src.Hp,
            Level = src.Level,
            Factions = src.Factions,
            Neutral = src.Neutral,
            Redirect = src.Redirect,
            SpellImmune = src.SpellImmune,
            EffectDamage = src.EffectDamage,
            WoundAmplify = src.WoundAmplify,
            SupporterLock = src.SupporterLock,
            SpellTrap = src.SpellTrap,
            SpellEcho = src.SpellEcho,
            CursePotency = src.CursePotency,
            MuffleFlips = src.MuffleFlips,
            Stationary = src.Stationary,
            Uncollectible = true,
            Art = src.Art,
            Artist = src.Artist,
            Num = "GEN",
            Powers = Repriced(src.Powers, SplitThreeWays),
            Triggers = src.Triggers,
            Targets = src.Targets,
            Effect = src.Effect,
            Flip = src.Flip,
            FlipText = src.FlipText,
            FlipCost = Repriced(src.FlipCost, SplitThreeWays),
            StageHooks = src.StageHooks,
        });
    }

    private static Cost SplitThreeWays(Cost cost)
    {
        int colored = ColoredTotal(cost);
        int b = colored / 3;
        int rem = colored % 3;
        return new Cost(O: b + (rem > 0 ? 1 : 0), R: b + (rem > 1 ? 1 : 0), P: b, C: cost.C);
    }

    /// <summary>Every colour pip on a cost rewritten as Oil, colourless left alone.</summary>
    private static Cost OiledCost(Cost cost) => new(O: ColoredTotal(cost), C: cost.C);

    /// <summary>
    /// A body pulled out of a debt pile and rebuilt in Oil: two bigger in both
    /// stats, Spirit added to its faction line, and Power pips now O.
    /// </summary>
    public static string OilRaise(string sourceId)
    {
        var src = Registry.Card(sourceId);
        var factions = (src.Factions ?? Array.Empty<Faction>()).ToList();
        if (!factions.Contains(Faction.Spirit)) factions.Add(Faction.Spirit);
        var powers = src.Powers is null || src.Powers.Length == 0
            ? src.Powers
            : src.Powers.Select(p => new Power
            {
                Name = p.Name,
                Cost = OiledCost(p.Cost),
                Text = p.Text,
                Targets = p.Targets,
                OncePerTurn = p.OncePerTurn,
                SapSelf = p.SapSelf,
                Effect = p.Effect,
            }).ToArray();
        return Registry.RegisterGenerated(new CardDef
        {
            Id = $"gen-raise-{sourceId}",
            Name = src.Name,
            Color = Color.O,
            Color2 = null,
            Color3 = null,
            Identity = null,
            Type = src.Type,
            Text = src.Text,
            Cost = src.Cost,
            Strength = src.Strength + 2,
            Hp = src.Hp + 2,
            Level = src.Level,
            Factions = factions.ToArray(),
            Neutral = src.Neutral,
            Redirect = src.Redirect,
            SpellImmune = src.SpellImmune,
            EffectDamage = src.EffectDamage,
            WoundAmplify = src.WoundAmplify,
            SupporterLock = src.SupporterLock,
            SpellTrap = src.SpellTrap,
            SpellEcho = src.SpellEcho,
            CursePotency = src.CursePotency,
            MuffleFlips = src.MuffleFlips,
            Stationary = src.Stationary,
            Uncollectible = true,
            Art = src.Art,
            Artist = src.Artist,
            Num = "GEN",
            Powers = powers,
            Triggers = src.Triggers,
            Targets = src.Targets,
            Effect = src.Effect,
            Flip = src.Flip,
            FlipText = src.FlipText,
            FlipCost = src.FlipCost,
            StageHooks = src.StageHooks,
        });
    }

    /// <summary>Every colour pip split between Robot and Pepper, Robot taking the odd one.</summary>
    private static Cost RecompiledCost(Cost cost)
    {
        int colored = ColoredTotal(cost);
        return new Cost(
            P: colored / 2,
            R: (colored + 1) / 2,
            C: cost.C);
    }

    /// <summary>
    /// A card rebuilt as a Pepper-Robot Machine: red frame, Robot second colour,
    /// Machine as its whole faction line, Power costs split half Robot half Pepper.
    /// </summary>
    public static string PepperRobotCopy(string sourceId)
    {
        var src = Registry.Card(sourceId);
        var powers = src.Powers is null || src.Powers.Length == 0
            ? src.Powers
            : src.Powers.Select(p => new Power
            {
                Name = p.Name,
                Cost = RecompiledCost(p.Cost),
                Text = p.Text,
                Targets = p.Targets,
                OncePerTurn = p.OncePerTurn,
                SapSelf = p.SapSelf,
                Effect = p.Effect,
            }).ToArray();
        return Registry.RegisterGenerated(new CardDef
        {
            Id = $"gen-virus-{sourceId}",
            // Rebuilding a neutral card in Pepper and Robot gives it colours, so it
            // must stop claiming neutrality or it keeps the colourless frame.
            Neutral = false,
            Name = src.Name,
            Color = Color.P,
            Color2 = Color.R,
            Color3 = null,
            Identity = null,
            Type = src.Type,
            Text = src.Text,
            Cost = src.Cost,
            Strength = src.Strength,
            Hp = src.Hp,
            Level = src.Level,
            Factions = new[] { Faction.Machine },
            Redirect = src.Redirect,
            SpellImmune = src.SpellImmune,
            EffectDamage = src.EffectDamage,
            WoundAmplify = src.WoundAmplify,
            SupporterLock = src.SupporterLock,
            SpellTrap = src.SpellTrap,
            SpellEcho = src.SpellEcho,
            CursePotency = src.CursePotency,
            MuffleFlips = src.MuffleFlips,
            Stationary = src.Stationary,
            Uncollectible = true,
            Art = src.Art,
            Artist = src.Artist,
            Num = "GEN",
            Powers = powers,
            Triggers = src.Triggers,
            Targets = src.Targets,
            Effect = src.Effect,
            Flip = src.Flip,
            FlipText = src.FlipText,
            FlipCost = src.FlipCost,
            StageHooks = src.StageHooks,
        });
    }

    /// <summary>
    /// A body wearing another card's whole text side: its Powers, its triggers,
    /// its keyword line and its factions. Minted rather than tracked on the
    /// instance, so the printed face shows what the body actually does: a borrowed
    /// Power that only exists in game state is a Power the player cannot read.
    ///
    /// A spell lends one sap-cost cast of itself; a summon lends its Power list.
    /// The host's own stats are baked in because an instance that was already
    /// playing as something else has no printed line of its own to fall back on.
    /// </summary>
    public static string GraftedCopy(
        string hostId, string sourceId, int strength, Color color, int level, Power[] basePowers)
    {
        var host = Registry.Card(hostId);
        var src = Registry.Card(sourceId);
        var lent = src.Type == CardType.Spell && src.Effect is not null
            ? new[]
            {
                new Power
                {
                    Name = src.Name,
                    Cost = src.Cost,
                    Text = src.Text ?? "",
                    Targets = src.Targets,
                    SapSelf = true,
                    Effect = src.Effect,
                },
            }
            : src.Powers ?? Array.Empty<Power>();
        string genId = $"gen-graft-{hostId}+{sourceId}-{strength}L{level}{color}";
        var factions = (host.Factions ?? Array.Empty<Faction>()).ToList();
        foreach (var f in src.Factions ?? Array.Empty<Faction>())
        {
            if (!factions.Contains(f)) factions.Add(f);
        }
        // A graft lends the whole text side, so the source's own triggers come
        // across on top of the host's rather than being dropped.
        var lentTriggers = src.Type == CardType.Spell ? null : src.Triggers;
        var lines = new List<string>();
        if (!string.IsNullOrWhiteSpace(host.Text)) lines.Add(host.Text!);
        if (lentTriggers is not null && !string.IsNullOrWhiteSpace(src.Text)) lines.Add(src.Text!);
        return Registry.RegisterGenerated(new CardDef
        {
            Id = genId,
            Name = host.Name,
            Color = color,
            Color2 = host.Color2,
            Color3 = host.Color3,
            Identity = host.Identity,
            Type = host.Type,
            Text = lines.Count > 0 ? string.Join(" ", lines) : null,
            Cost = host.Cost,
            Strength = strength,
            Hp = host.Hp,
            Level = level,
            Factions = factions.ToArray(),
            Neutral = host.Neutral,
            Redirect = host.Redirect || src.Redirect,
            SpellImmune = host.SpellImmune || src.SpellImmune,
            EffectDamage = Math.Max(host.EffectDamage, src.EffectDamage),
            WoundAmplify = host.WoundAmplify || src.WoundAmplify,
            SupporterLock = host.SupporterLock || src.SupporterLock,
            SpellTrap = host.SpellTrap,
            SpellEcho = host.SpellEcho || src.SpellEcho,
            CursePotency = host.CursePotency || src.CursePotency,
            MuffleFlips = host.MuffleFlips || src.MuffleFlips,
            Stationary = host.Stationary || src.Stationary,
            Uncollectible = true,
            Art = host.Art,
            Artist = host.Artist,
            Num = "GEN",
            // A grafted Power arrives on a body the host paid for, so its pips
            // are rewritten as Oil rather than the colour it was printed in.
            Powers = basePowers.Concat(Repriced(lent, OiledCost) ?? lent).ToArray(),
            Triggers = MergeTriggers(host.Triggers, lentTriggers, genId),
            Targets = host.Targets,
            Effect = host.Effect,
            Flip = host.Flip,
            FlipText = host.FlipText,
            FlipCost = host.FlipCost,
            StageHooks = host.StageHooks,
        });
    }

    private static Action<EffectCtx>? Chain(Action<EffectCtx>? x, Action<EffectCtx>? y) =>
        x is null ? y : y is null ? x : c => { x(c); y(c); };

    private static Func<T, int>? Sum<T>(Func<T, int>? x, Func<T, int>? y) =>
        x is null ? y : y is null ? x : a => x(a) + y(a);

    /// <summary>
    /// Both parents' triggers on one body, each slot firing the first card's
    /// half before the second's. Without this a fusion silently dropped every
    /// Deathrattle, Battlecry and aura it was built from.
    /// </summary>
    private static Triggers? MergeTriggers(Triggers? a, Triggers? b, string selfId)
    {
        if (a is null && b is null) return null;
        var bonus = Sum(a?.StrengthBonus, b?.StrengthBonus);
        if (a is null || b is null)
        {
            var only = a ?? b!;
            if (only.StrengthBonus is null) return only;
            a ??= new Triggers();
            b ??= new Triggers();
        }
        return new Triggers
        {
            OnEnter = Chain(a.OnEnter, b.OnEnter),
            OnDeath = Chain(a.OnDeath, b.OnDeath),
            OnAttack = Chain(a.OnAttack, b.OnAttack),
            OnDefend = Chain(a.OnDefend, b.OnDefend),
            OnAwake = Chain(a.OnAwake, b.OnAwake),
            OnEndTurn = Chain(a.OnEndTurn, b.OnEndTurn),
            OnOtherDeath = Chain(a.OnOtherDeath, b.OnOtherDeath),
            OnSpellCast = Chain(a.OnSpellCast, b.OnSpellCast),
            OnEnemySpellCast = Chain(a.OnEnemySpellCast, b.OnEnemySpellCast),
            OnSummonPlayed = Chain(a.OnSummonPlayed, b.OnSummonPlayed),
            // An aura names itself by id to stay off its own buff. The fusion
            // carries a different id, so it has to be excluded by hand.
            StrengthBonus = bonus is null
                ? null
                : args => args.Summon.CardId == selfId ? 0 : bonus(args),
            EffectDamageBonus = Sum(a.EffectDamageBonus, b.EffectDamageBonus),
        };
    }

    /// <summary>
    /// The fusion of two summons: the higher of each stat, both faction lines,
    /// both Power sets, both trigger sets and both keyword lines. The first
    /// summon lends its flip, since only one card can turn over.
    /// </summary>
    public static string FusedRecomp(string aId, string bId, int strength, int hp, int level)
    {
        var a = Registry.Card(aId);
        var b = Registry.Card(bId);
        var factions = new List<Faction>();
        foreach (var f in a.Factions.Concat(b.Factions))
        {
            if (!factions.Contains(f)) factions.Add(f);
        }
        if (!factions.Contains(Faction.Machine)) factions.Add(Faction.Machine);
        var powers = (a.Powers ?? Array.Empty<Power>())
            .Concat(b.Powers ?? Array.Empty<Power>())
            .Select(p => new Power
            {
                Name = p.Name,
                Cost = RecompiledCost(p.Cost),
                Text = p.Text,
                Targets = p.Targets,
                OncePerTurn = p.OncePerTurn,
                SapSelf = p.SapSelf,
                Effect = p.Effect,
            })
            .ToArray();
        string genId = $"gen-fuse-{aId}+{bId}-{strength}x{hp}L{level}";
        var lines = new List<string> { $"Recompiled from {a.Name} and {b.Name}." };
        if (!string.IsNullOrWhiteSpace(a.Text)) lines.Add(a.Text!);
        if (!string.IsNullOrWhiteSpace(b.Text)) lines.Add(b.Text!);
        return Registry.RegisterGenerated(new CardDef
        {
            Id = genId,
            Name = "Recomp",
            Color = Color.P,
            Color2 = Color.R,
            Color3 = null,
            Type = CardType.Summon,
            Level = level,
            Strength = strength,
            Hp = hp,
            Uncollectible = true,
            Factions = factions.ToArray(),
            Text = string.Join(" ", lines),
            Redirect = a.Redirect || b.Redirect,
            SpellImmune = a.SpellImmune || b.SpellImmune,
            EffectDamage = Math.Max(a.EffectDamage, b.EffectDamage),
            WoundAmplify = a.WoundAmplify || b.WoundAmplify,
            SupporterLock = a.SupporterLock || b.SupporterLock,
            SpellEcho = a.SpellEcho || b.SpellEcho,
            CursePotency = a.CursePotency || b.CursePotency,
            MuffleFlips = a.MuffleFlips || b.MuffleFlips,
            Stationary = a.Stationary || b.Stationary,
            Powers = powers.Length > 0 ? powers : null,
            Triggers = MergeTriggers(a.Triggers, b.Triggers, genId),
            Targets = a.Targets,
            Flip = a.Flip,
            FlipText = a.FlipText,
            FlipCost = a.FlipCost,
            Art = "Cardgame/Extras/Recomp.png",
            Artist = "klabss",
            Num = "GEN",
        });
    }

    /// <summary>
    /// A spell walking around as a summon. It wears the spell's name and art,
    /// and carries one sap-cost Power that casts the spell's effect.
    /// </summary>
    public static string LivingSummon(string spellId, int strength, int hp, int level, bool free = false)
    {
        var src = Registry.Card(spellId);
        var factions = new List<Faction> { Faction.Living };
        foreach (var f in src.Factions)
        {
            if (!factions.Contains(f)) factions.Add(f);
        }
        var powers = src.Effect is null
            ? null
            : new[]
            {
                new Power
                {
                    Name = "Cast",
                    Cost = free ? new Cost() : src.Cost,
                    SapSelf = true,
                    Text = src.Text ?? "",
                    Targets = src.Targets,
                    Effect = src.Effect,
                },
            };
        return Registry.RegisterGenerated(new CardDef
        {
            Id = $"gen-live-{spellId}-{strength}x{hp}L{level}{(free ? "f" : "")}",
            Name = src.Name,
            Color = src.Color,
            Color2 = src.Color2,
            Color3 = src.Color3,
            Type = CardType.Summon,
            Level = level,
            Strength = strength,
            Hp = hp,
            Uncollectible = true,
            Factions = factions.ToArray(),
            Text = powers is null ? "A spell with legs and nothing to say." : null,
            Powers = powers,
            Art = src.Art,
            Artist = src.Artist,
            Num = "GEN",
        });
    }
}
