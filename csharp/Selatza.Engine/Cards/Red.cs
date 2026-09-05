using static Selatza.Cards.Kit;

namespace Selatza.Cards;

/// <summary>Red is Pepper: burn, spell recursion, bodies that cash themselves in.</summary>
public static class Red
{
    private static readonly ColorKit K = new(Color.P, "p", "Red", "Red/spells");

    public static CardDef[] Build() => new[]
    {
        K.Starter("archlife", "Archlife", F(Faction.Spirit, Faction.Star), str: 2, hp: 3,
            effectDamage: 1,
            text: "Effect Damage +1. At the start of your turn, loses 1 HP.",
            triggers: new Triggers
            {
                // Raw, so its own Effect Damage does not double the burn it pays.
                OnAwake = c =>
                {
                    if (c.Self is { } me) c.RawDamage(me, 1);
                },
            },
            powers: Powers(
                new Power
                {
                    Name = "Kindle",
                    Cost = new Cost(P: 1),
                    Text = "Deal 1 to an enemy summon.",
                    Targets = Specs(Enemy()),
                    Effect = c => c.Damage(c.Target(0), 1),
                },
                new Power
                {
                    Name = "Rekindle",
                    Cost = new Cost(P: 2),
                    Text = "Shuffle your discard pile, then Scry 3 of it for a spell.",
                    SapSelf = true,
                    Effect = c => c.ScryDiscard(c.Me, 3, d => d.Type == CardType.Spell),
                })),

        // --- level 1 ---------------------------------------------------------
        K.Summon(1, "beast", "Red Beast", F(Faction.Beast), str: 3, hp: 2),

        K.Summon(1, "beetle", "Ember Beetle", F(Faction.Beast), str: 1, hp: 2,
            flipText: "Deal 1 to an enemy summon.",
            flip: c =>
            {
                c.Choose("deal-1", c.SummonsOf(c.Opp), "Deal 1 to which enemy summon?");
            }),

        K.Summon(1, "bugbert", "Bugbert", F(Faction.Beast),
            text: "Deathrattle: Costs no debt.",
            triggers: new Triggers { OnDeath = c => c.ClearDebt(c.Me, 1) }, str: 1, hp: 3),

        K.Summon(1, "bunny", "Cinder Bunny", F(Faction.Beast),
            text: "Battlecry: Deal 1 to an enemy summon.",
            targets: Specs(Enemy()),
            triggers: new Triggers { OnEnter = c => { if (c.TargetOrNull(0) is { } t) c.Damage(t, 1); } }, str: 2, hp: 2,
            flipText: "Deal 1 to the enemy leader.",
            flipCost: new FlipCost { Mana = new Cost(P: 1) },
            flip: c => c.Damage(TargetRef.Leader(c.Opp), 1)),

        K.Summon(1, "devil", "Little Devil", F(Faction.Spirit), str: 1, hp: 2,
            text: "Battlecry: Deal 1 to both leaders.",
            triggers: new Triggers { OnEnter = c =>
            {
                c.Damage(TargetRef.Leader(c.Opp), 1);
                c.Damage(TargetRef.Leader(c.Me), 1);
            } },
            flipText: "Deal 1 to both leaders.",
            flipCost: new FlipCost { Mana = new Cost(P: 1) },
            flip: c =>
            {
                c.Damage(TargetRef.Leader(c.Opp), 1);
                c.Damage(TargetRef.Leader(c.Me), 1);
            }),

        K.Summon(1, "firebat", "Firebat", F(Faction.Beast),
            str: 1,
            hp: 2,
            text: "Strike: Deal 1 to the defender first.",
            triggers: new Triggers
            {
                OnAttack = c => { if (c.State.BattleDefender is { } d) c.Damage(d, 1); },
            },
            flipText: "Deal 1 to an enemy summon.",
            flip: c =>
            {
                c.Choose("deal-1", c.SummonsOf(c.Opp), "Deal 1 to which enemy summon?");
            }),

        K.Summon(1, "firesprite", "Fire Sprite", F(Faction.Spirit), str: 1,
            hp: 2,
            powers: Powers(new Power
            {
                Name = "Spark",
                Cost = new Cost(P: 1),
                Text = "Deal 1 to an enemy summon.",
                Targets = Specs(Enemy()),
                Effect = c => c.Damage(c.Target(0), 1),
            }),
            flipText: "Deal 1 to the enemy leader.",
            flipCost: new FlipCost { Mana = new Cost(P: 1) },
            flip: c => c.Damage(TargetRef.Leader(c.Opp), 1)),

        K.Summon(1, "minimage", "Minimage", F(Faction.Mortal, Faction.Scholar), str: 1,
            hp: 2,
            powers: Powers(new Power
            {
                Name = "Cantrip",
                Cost = new Cost(P: 1),
                Text = "Scry 3 for a spell.",
                SapSelf = true,
                Effect = c =>
                {
                    c.Dig(c.Me, 3, d => d.Type == CardType.Spell);
                },
            }),
            flipText: "Deal 1 to an enemy summon.",
            flip: c =>
            {
                c.Choose("deal-1", c.SummonsOf(c.Opp), "Deal 1 to which enemy summon?");
            }),

        K.Summon(1, "moonkrag", "Moonkrag", F(Faction.Star), str: 2, hp: 4,
            text: "",
            flipText: "Deal 1 to the enemy leader.",
            flipCost: new FlipCost { Mana = new Cost(P: 1) },
            flip: c => c.Damage(TargetRef.Leader(c.Opp), 1)),

        K.Summon(1, "thinker", "The Thinker", F(Faction.Mortal, Faction.Scholar), str: 1, hp: 3,
            text: "At the start of your turn, draw a card.",
            triggers: new Triggers { OnAwake = c => c.Draw(c.Me, 1) }),

        // --- level 2 ---------------------------------------------------------
        K.Summon(2, "ash demon", "Ash Demon", F(Faction.Spirit), str: 2, hp: 2,
            text: "Deathrattle: Deal 1 to every enemy summon.",
            triggers: new Triggers
            {
                OnDeath = c => { foreach (var r in c.SummonsOf(c.Opp)) c.Damage(r, 1); },
            },
            powers: Powers(new Power
            {
                Name = "Cinders",
                Cost = new Cost(P: 1),
                Text = "Deal 1 to an enemy character.",
                Targets = Specs(EnemyOrLeader()),
                Effect = c => c.Damage(c.Target(0), 1),
            })),

        K.Summon(2, "burnflayer", "Burnflayer", F(Faction.Spirit),
            str: 2,
            hp: 4,
            powers: Powers(new Power
            {
                Name = "Flay",
                Cost = new Cost(P: 1),
                Text = "Deal 2 to an enemy summon, then 1 to this one.",
                Targets = Specs(Enemy()),
                Effect = c =>
                {
                    c.Damage(c.Target(0), 2);
                    if (c.Self is { } me) c.Damage(me, 1);
                },
            })),

        K.Summon(2, "deathknight", "Death Knight", F(Faction.Mortal, Faction.Spirit), str: 3,
            hp: 3,
            text: "Strike: Gains 1 HP off your deck. When an enemy summon dies, heal your leader 1.",
            triggers: new Triggers
            {
                OnAttack = c => { if (c.Self is { } me) c.Reinforce(me, 1); },
                OnOtherDeath = c =>
                {
                    if (c.State.DyingOwner == c.Me) return;
                    c.Unflip(TargetRef.Leader(c.Me), 1);
                },
            }),

        K.Summon(2, "dragon", "Dragon", F(Faction.Beast), str: 3, hp: 2,
            text: "Strike: Deal 1 to every enemy summon.",
            triggers: new Triggers
            {
                OnAttack = c => { foreach (var r in c.SummonsOf(c.Opp)) c.Damage(r, 1); },
            },
            flipText: "Deal 2 to the enemy leader.",
            flipCost: new FlipCost { Mana = new Cost(P: 1) },
            flipUseful: c => c.SummonAt(TargetRef.Leader(c.Opp)) is not null,
            flip: c => c.Damage(TargetRef.Leader(c.Opp), 2)),

        K.Summon(2, "evil squire", "Evil Squire", F(Faction.Mortal),
            str: 2,
            hp: 3,
            text: "Battlecry: An ally gains +3 attack until end of turn.",
            targets: Specs(Ally()),
            triggers: new Triggers
            {
                OnEnter = c =>
                {
                    if (c.TargetOrNull(0) is { } t) c.BuffStrength(t, 3, ModDuration.Turn);
                },
            }),

        K.Summon(2, "lazylord", "Lazy Lord", F(Faction.Mortal), str: 4, hp: 3,
            text: "Arrives sapped.",
            triggers: new Triggers { OnEnter = c => { if (c.Self is { } me) c.Sap(me); } }),

        K.Summon(2, "livingfort", "Living Fort", F(Faction.Living), str: 1, hp: 6,
            stationary: true, redirect: true,
            text: "Redirection. Stationary."),

        K.Summon(2, "pinelyte", "Pinelyte", F(Faction.Living), str: 2, hp: 5,
            powers: Powers(new Power
            {
                Name = "Sap Burst",
                Cost = new Cost(),
                SapSelf = true,
                HpCost = 2,
                Text = "Spend 2 HP off this: deal 3 to an enemy summon.",
                Targets = Specs(Enemy()),
                Effect = c =>
                {
                    if (c.Self is not { } me) return;
                    c.RawDamage(me, 2);
                    c.Damage(c.Target(0), 3);
                },
            }),
            flipText: "Deal 1 to an enemy summon.",
            flip: c =>
            {
                c.Choose("deal-1", c.SummonsOf(c.Opp), "Deal 1 to which enemy summon?");
            }),

        K.Summon(2, "warmateer", "Warmateer", F(Faction.Mortal),
            str: 2,
            hp: 3,
            powers: Powers(new Power
            {
                Name = "Rally",
                Cost = new Cost(P: 1),
                Text = "An ally character gains +4 attack until end of turn.",
                Targets = Specs(AllyOrLeader()),
                Effect = c => c.BuffStrength(c.Target(0), 4, ModDuration.Turn),
            }),
            flipText: "Deal 1 to an enemy summon.",
            flip: c =>
            {
                c.Choose("deal-1", c.SummonsOf(c.Opp), "Deal 1 to which enemy summon?");
            }),

        K.Summon(2, "wizard", "Red Wizard", F(Faction.Mortal, Faction.Scholar), str: 2,
            hp: 3,
            powers: Powers(
                new Power
                {
                    Name = "Ember",
                    Cost = new Cost(P: 1),
                    Text = "Deal 1 to an enemy summon.",
                    Targets = Specs(Enemy()),
                    Effect = c => c.Damage(c.Target(0), 1),
                },
                new Power
                {
                    Name = "Conflagrate",
                    Cost = new Cost(P: 2),
                    Text = "Deal 2 to every enemy summon.",
                    SapSelf = true,
                    Effect = c =>
                    {
                        foreach (var r in c.SummonsOf(c.Opp)) c.Damage(r, 2);
                    },
                })),

        // --- level 3 ---------------------------------------------------------
        K.Summon(3, "classe", "Classe", F(Faction.Mortal, Faction.Scholar), str: 2, hp: 5,
            powers: Powers(new Power
            {
                Name = "Burning Heart",
                Cost = new Cost(P: 1),
                Text = "Draw a card and deal 1 to your leader.",
                Effect = c =>
                {
                    c.Draw(c.Me, 1);
                    c.Damage(TargetRef.Leader(c.Me), 1);
                },
            })),

        K.Summon(3, "heavenknows", "Heaven Knows", F(Faction.Star, Faction.Spirit),
            str: 3, hp: 5,
            text: "At the end of your turn, deal 1 to every character.",
            triggers: new Triggers
            {
                OnEndTurn = c =>
                {
                    foreach (var r in c.SummonsOf(c.Me, true)) c.Damage(r, 1);
                    foreach (var r in c.SummonsOf(c.Opp, true)) c.Damage(r, 1);
                },
            }),

        K.Summon(3, "helaks", "Helaks", F(Faction.Spirit), str: 3, hp: 6,
            text: "Cannot be healed."),

        K.Summon(3, "helemy", "Helemy", F(Faction.Spirit, Faction.Scholar), str: 2, hp: 5,
            powers: Powers(new Power
            {
                Name = "Alchemize",
                Cost = new Cost(P: 2),
                Text = "Destroy one of your unsapped summons, then deal its attack to an enemy character.",
                // A sapped body has already spent its turn, so feeding it in was
                // a free second use of it.
                Targets = Specs(
                    new TargetSpec
                    {
                        Kind = TargetKind.Summon,
                        Side = Side.Ally,
                        Label = "one of your unsapped summons",
                        Filter = a => a.Summon is { Sapped: false },
                    },
                    EnemyOrLeader()),
                Effect = c =>
                {
                    var victim = c.SummonAt(c.Target(0));
                    if (victim is null) return;
                    int paid = Effects.EffectiveStrength(c.State, victim);
                    c.Destroy(c.Target(0));
                    c.Damage(c.Target(1), paid);
                },
            })),

        K.Summon(3, "Looker", "The Looker", F(Faction.Spirit), str: 2, hp: 5,
            text: "At the start of your turn, Scry 3 for any card.",
            triggers: new Triggers { OnAwake = c => c.Dig(c.Me, 3, _ => true) }),

        K.Summon(3, "Pod", "The Pod", F(Faction.Living), str: 2, hp: 7,
            text: "Deathrattle: Return 2 spells from your discard pile to your hand.",
            triggers: new Triggers
            {
                OnDeath = c => c.Choose("pod-revive", c.DiscardSpells(c.Me),
                    "Return which spell to hand?"),
            }),

        K.Summon(3, "Slicer", "Slicer", F(Faction.Machine), str: 2, hp: 4,
            effectDamage: 1,
            text: "Effect Damage +1. Battlecry: You take 2 debt.",
            triggers: new Triggers
            {
                OnEnter = c => c.AddDebt(c.Me, 2, "The Slicer bills its owner up front."),
            }),

        K.Summon(3, "stareater", "Star Eater", F(Faction.Beast, Faction.Star),
            str: 4, hp: 4,
            powers: Powers(new Power
            {
                Name = "Devour",
                Cost = default,
                SapSelf = true,
                Text = "Eat one of your other summons. It becomes HP on this one and costs no debt.",
                Targets = Specs(Ally("one of your summons")),
                Effect = c => c.Devour(c.Target(0)),
            })),

        K.Summon(3, "Tryybus", "Tryybus", F(Faction.Star), str: 2, hp: 3,
            text: "All allies have +1 attack. At the start of your turn, loses 1 HP.",
            triggers: new Triggers
            {
                StrengthBonus = a => a.Summon.Owner == a.Controller
                    && a.Summon.CardId != "p3-Tryybus" ? 1 : 0,
                // Raw, so no Effect Damage bonus inflates the upkeep it pays.
                OnAwake = c => { if (c.Self is { } me) c.RawDamage(me, 1); },
            }),

        // --- spells, traps and stages ----------------------------------------
        K.Spell("firebolt", "Firebolt", new Cost(P: 1), "Deal 2 to an enemy summon.",
            Specs(Enemy()), c => c.Damage(c.Target(0), 2)),

        K.Spell("planetblast", "Planet Blast", new Cost(P: 1, C: 1),
            "Deal 1 to every character.", null, c =>
            {
                foreach (var r in c.SummonsOf(c.Me, true)) c.Damage(r, 1);
                foreach (var r in c.SummonsOf(c.Opp, true)) c.Damage(r, 1);
            }),

        K.Spell("vaporize", "Vaporize", new Cost(P: 3), "Deal 4 to an enemy summon.",
            Specs(Enemy()), c => c.Damage(c.Target(0), 4),
            flipText: "Deal 2 to the enemy leader.",
            flipCost: new FlipCost { Mana = new Cost(P: 1) },
            flipUseful: c => c.SummonAt(TargetRef.Leader(c.Opp)) is not null,
            flip: c => c.Damage(TargetRef.Leader(c.Opp), 2)),

        K.Spell("poisondagger", "Dagger Dance", new Cost(P: 1),
            "Deal 1 to an enemy summon, 2 times.",
            Specs(Enemy()), c =>
            {
                for (int i = 0; i < 2; i++) c.Damage(c.Target(0), 1);
            }),

        K.Spell("potion", "Ember Tonic", new Cost(P: 1, C: 1),
            "Deal 1 to the enemy leader and draw a card.",
            null, c =>
            {
                c.Damage(TargetRef.Leader(c.Opp), 1);
                c.Draw(c.Me, 1);
            }),

        K.Spell("treasure", "Treasure", new Cost(P: 1), "Draw 2 cards.",
            null, c => c.Draw(c.Me, 2)),

        K.Spell("flower", "Ember Flower", new Cost(P: 1),
            "Deal 1 to every enemy summon.",
            null, c =>
            {
                foreach (var r in c.SummonsOf(c.Opp)) c.Damage(r, 1);
            }),

        K.Trap("banner", "Trap: Backdraft", new Cost(P: 1),
            "Deal 4 to the attacking summon.", null, c =>
            {
                if (c.State.BattleAttacker is { } a) c.Damage(a, 4);
            }),

        K.Stage("castle", "Field: The Castle", new Cost(P: 1, C: 1),
            "When you set it, and at the start of your turn, deal 1 to an enemy summon.",
            new StageHooks
            {
                OnAwake = c =>
                {
                    c.Choose("deal-1", c.SummonsOf(c.Opp), "Deal 1 to which enemy summon?");
                },
            },
            effect: c =>
            {
                c.Choose("deal-1", c.SummonsOf(c.Opp), "Deal 1 to which enemy summon?");
            },
            flipText: "Deal 3 to every enemy summon.",
            flipCost: new FlipCost { Mana = new Cost(P: 2) },
            flipUseful: c => c.SummonsOf(c.Opp).Length > 0,
            flip: c =>
            {
                foreach (var t in c.SummonsOf(c.Opp)) c.Damage(t, 3);
            }),

        K.Stage("towerofmystery", "Field: Tower of Mystery", new Cost(P: 1, C: 1),
            "Your Scholars have +2 attack.",
            new StageHooks
            {
                StrengthBonus = a => a.Summon.Owner == a.Controller
                    && a.Def.HasFaction(Faction.Scholar) ? 2 : 0,
            }),
    };
}
