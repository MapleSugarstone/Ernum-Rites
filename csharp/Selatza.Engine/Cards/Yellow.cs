using static Selatza.Cards.Kit;

namespace Selatza.Cards;

/// <summary>Yellow is Solar: Living things, Stars, ramp, and buffs that stick.</summary>
public static class Yellow
{
    private static readonly ColorKit K = new(Color.S, "s", "Yellow", "Yellow/spells");

    public static CardDef[] Build() => new[]
    {
        K.Starter("thejudge", "The Judge", F(Faction.Star, Faction.Mortal), str: 5, hp: 3,
            text: "",
            powers: Powers(
                new Power
                {
                    Name = "Reincarnate",
                    Cost = new Cost(S: 1),
                    Text = "Draw a card.",
                    SapSelf = true,
                    Effect = c => c.Draw(c.Me, 1),
                },
                new Power
                {
                    Name = "Verdict",
                    Cost = new Cost(S: 2),
                    Text = "An ally gains +2 attack.",
                    SapSelf = true,
                    Targets = Specs(AllyOrLeader()),
                    Effect = c => c.BuffStrength(c.Target(0), 2, ModDuration.Permanent),
                })),

        K.Summon(1, "fluterat", "Flute Rat", F(Faction.Beast, Faction.Living), str: 1, hp: 2,
            flipText: "Mill 1: draw 2 cards.",
            flipCost: new FlipCost { Mill = 1 },
            flipUseful: c => c.State.Players[c.Me].Deck.Count >= 2,
            flip: c => c.Draw(c.Me, 2)),

        K.Summon(1, "livingboot", "Living Boot", F(Faction.Living), str: 2, hp: 4,
            flipText: "The attached character gains 2 HP.",
            flip: c => c.Reinforce(c.HolderRef, 2)),

        K.Summon(1, "livingflowers", "Living Flowers", F(Faction.Living),
            text: "Battlecry: Heal an ally 3.",
            targets: Specs(AllyOrLeader()),
            triggers: new Triggers { OnEnter = c => { if (c.TargetOrNull(0) is { } t) c.Unflip(t, 3); } }, str: 1, hp: 2,
            flipText: "The attached character gains 2 HP.",
            flip: c => c.Reinforce(c.HolderRef, 2)),

        K.Summon(1, "livingraincloud", "Living Raincloud", F(Faction.Living, Faction.Star),
            str: 0, hp: 4,
            text: "At the start of your turn, an ally heals 2. Battlecry: Heal an ally for 2.",
            targets: Specs(new TargetSpec
            {
                Kind = TargetKind.Summon,
                Side = Side.Ally,
                IncludeLeader = true,
                Label = "an ally with flipped HP",
                Filter = a => a.Summon is not null && a.Summon.Hp.Any(h => h.Flipped),
            }),
            triggers: new Triggers
            {
                OnEnter = c =>
                {
                    if (c.TargetOrNull(0) is { } t) c.Unflip(t, 2);
                },
                OnAwake = c =>
                {
                    var refs = new List<TargetRef>();
                    foreach (var r in c.SummonsOf(c.Me, true))
                    {
                        var s = c.SummonAt(r);
                        if (s is not null && s.Hp.Any(h => h.Flipped)) refs.Add(r);
                    }
                    c.Choose("heal-2", refs.ToArray(), "Heal which ally for 2?");
                },
            },
            flipText: "Heal the attached character for 2.",
            flipCost: new FlipCost { Mana = new Cost(S: 1) },
            flip: c => c.Unflip(c.HolderRef, 2)),

        K.Summon(1, "livingrock", "Living Rock", F(Faction.Living), str: 1, hp: 5,
            flipText: "The attached character gains +1 attack.",
            flip: c => c.BuffStrength(c.HolderRef, 1, ModDuration.Permanent)),

        K.Summon(1, "livingsong", "Living Song", F(Faction.Living), str: 1,
            hp: 2,
            text: "Battlecry: You may play another supporter this turn.",
            triggers: new Triggers
            {
                OnEnter = c =>
                {
                    c.State.Players[c.Me].SupportersLeft += 1;
                    c.Log("The song frees another supporter drop.");
                },
            },
            flipText: "Destroy the attached summon, and the top card of your deck becomes a supporter.",
            flipCost: new FlipCost { Mana = new Cost(S: 1) },
            flipUseful: c => c.State.Players[c.Me].Deck.Count > 0,
            flip: c =>
            {
                c.SupporterFromDeck(c.Me, sapped: false);
                // Named "the attached summon": a leader is never the thing it eats.
                if (!c.Holder.IsLeader) c.DestroyHolder();
            }),

        K.Summon(1, "livingtree", "Living Tree", F(Faction.Living), str: 1, hp: 4,
            text: "Ally Living have +1 attack.",
            triggers: new Triggers
            {
                StrengthBonus = a => a.Summon.Owner == a.Controller
                    && a.Def.HasFaction(Faction.Living)
                    && a.Summon.CardId != "s1-livingtree" ? 1 : 0,
            }),

        K.Summon(1, "shrubbunny", "Shrub Bunny", F(Faction.Living, Faction.Beast),
            text: "Battlecry: Shuffle the top card of your discard pile into your deck.",
            triggers: new Triggers { OnEnter = c => c.RecycleTopDiscard(c.Me) }, str: 1, hp: 2,
            flipText: "The attached character gains 2 HP.",
            flip: c => c.Reinforce(c.HolderRef, 2)),

        K.Summon(1, "starbird", "Starbird", F(Faction.Star, Faction.Beast), str: 2, hp: 2,
            text: "Deathrattle: Draw a card.",
            triggers: new Triggers { OnDeath = c => c.Draw(c.Me, 1) },
            flipText: "Destroy the attached summon, and the top card of your deck becomes a sapped supporter.",
            flipCost: new FlipCost { Mana = new Cost(S: 1) },
            flipUseful: c => c.State.Players[c.Me].Deck.Count > 0,
            flip: c =>
            {
                c.SupporterFromDeck(c.Me);
                // Named "the attached summon": a leader is never the thing it eats.
                if (!c.Holder.IsLeader) c.DestroyHolder();
            }),

        K.Summon(1, "starsprite", "Star Sprite", F(Faction.Star, Faction.Spirit), str: 1,
            hp: 2,
            powers: Powers(new Power
            {
                Name = "Twinkle",
                Cost = new Cost(S: 1),
                Text = "An ally gains +2 attack until end of turn.",
                Targets = Specs(AllyOrLeader()),
                Effect = c => c.BuffStrength(c.Target(0), 2, ModDuration.Turn),
            })),

        K.Summon(2, "admirer", "The Admirer", F(Faction.Mortal), str: 2,
            hp: 3,
            text: "Battlecry: An ally gains +2 attack.",
            targets: Specs(Ally()),
            triggers: new Triggers
            {
                OnEnter = c =>
                {
                    if (c.TargetOrNull(0) is { } t) c.BuffStrength(t, 2, ModDuration.Permanent);
                },
            },
            powers: Powers(new Power
            {
                Name = "Devotion",
                Cost = new Cost(S: 1),
                Text = "Heal an ally 2.",
                SapSelf = true,
                Targets = Specs(AllyOrLeader()),
                Effect = c => c.Unflip(c.Target(0), 2),
            })),

        K.Summon(2, "bubblemancer", "Bubblemancer", F(Faction.Mortal, Faction.Scholar), str: 3,
            hp: 3,
            powers: Powers(new Power
            {
                Name = "Bubble",
                Cost = new Cost(S: 1),
                Text = "An ally gains 2 HP off your deck.",
                Targets = Specs(AllyOrLeader()),
                Effect = c => c.Reinforce(c.Target(0), 2),
            }, new Power
            {
                Name = "Bubblewave",
                Cost = new Cost(S: 1),
                Text = "Deal 1 damage to all enemy summons.",
                SapSelf = true,
                Effect = c =>
                {
                    foreach (var r in c.SummonsOf(c.Opp)) c.Damage(r, 1);
                },
            })),

        K.Summon(2, "bugleist", "Bugleist", F(Faction.Mortal), str: 1, hp: 4,
            text: "At the start of your turn, each of your characters gains +1 attack until end of turn and heals 1.",
            triggers: new Triggers
            {
                OnAwake = c =>
                {
                    foreach (var r in c.SummonsOf(c.Me, true))
                    {
                        c.BuffStrength(r, 1, ModDuration.Turn);
                        c.Unflip(r, 1);
                    }
                },
            }),

        K.Summon(2, "druid", "Druid", F(Faction.Mortal, Faction.Scholar), str: 3,
            hp: 3,
            powers: Powers(new Power
            {
                Name = "Grow",
                Cost = new Cost(S: 1),
                Text = "Scry 4 for a Living card.",
                SapSelf = true,
                Effect = c =>
                {
                    c.Dig(c.Me, 4, d => d.HasFaction(Faction.Living));
                },
            }, new Power
            {
                Name = "Pacify Mind",
                Cost = new Cost(S: 2),
                Text = "Destroy an enemy summon with 3 or more attack.",
                SapSelf = true,
                Targets = Specs(new TargetSpec
                {
                    Kind = TargetKind.Summon,
                    Side = Side.Enemy,
                    Label = "an enemy summon with 3 or more attack",
                    Filter = a => a.Summon is { } s && a.Card is { } d
                        && GameState.StrengthOf(s, d) >= 3,
                }),
                Effect = c => c.Destroy(c.Target(0)),
            })),

        K.Summon(2, "happybard", "Happy Bard", F(Faction.Mortal), str: 3,
            hp: 3,
            powers: Powers(new Power
            {
                Name = "Standing Ovation",
                Cost = new Cost(S: 4),
                Text = "Unsap each of your characters.",
                Effect = c =>
                {
                    foreach (var r in c.SummonsOf(c.Me, true)) c.Unsap(r);
                },
            },
            new Power
            {
                Name = "Encore",
                Cost = new Cost(S: 2),
                Text = "Unsap one of your summons.",
                Targets = Specs(AllyOrLeader()),
                Effect = c => c.Unsap(c.Target(0)),
            })),

        K.Summon(2, "hiker", "Hiker", F(Faction.Mortal), str: 3,
            hp: 3,
            text: "Battlecry: You may play another supporter this turn.",
            triggers: new Triggers
            {
                OnEnter = c =>
                {
                    c.State.Players[c.Me].SupportersLeft += 1;
                    c.Log("The hiker finds another road.");
                },
            },
            powers: Powers(new Power
            {
                Name = "Trailblaze",
                Cost = new Cost(S: 1),
                Text = "The top card of your deck becomes a sapped supporter.",
                SapSelf = true,
                Effect = c => c.SupporterFromDeck(c.Me),
            }),
            flipText: "The attached character gains 2 HP.",
            flipCost: new FlipCost { Mana = new Cost(S: 1) },
            flip: c => c.Reinforce(c.HolderRef, 2)),

        K.Summon(2, "livingruin", "Living Ruin", F(Faction.Living), str: 2, hp: 5,
            text: "Battlecry: Deal 1 to every summon. "
                + "When an ally summon dies, gain 1 Solar mana this turn.",
            triggers: new Triggers
            {
                OnEnter = c =>
                {
                    foreach (var r in c.SummonsOf(c.Opp)) c.Damage(r, 1);
                    foreach (var r in c.SummonsOf(c.Me)) c.Damage(r, 1);
                },
                OnOtherDeath = c =>
                {
                    if (c.State.DyingOwner != c.Me) return;
                    c.State.Players[c.Me].Mana[(int)Color.S] += 1;
                },
            },
            powers: Powers(new Power
            {
                Name = "Overgrow",
                Cost = new Cost(S: 1),
                Text = "An ally gains 2 HP off your deck.",
                SapSelf = true,
                Targets = Specs(AllyOrLeader()),
                Effect = c => c.Reinforce(c.Target(0), 2),
            })),

        K.Summon(2, "orangefarmer", "Orange Farmer", F(Faction.Mortal, Faction.Living), str: 3, hp: 4,
            powers: Powers(new Power
            {
                Name = "Harvest",
                Cost = new Cost(S: 1),
                Text = "Draw a card, then put a card from your hand under an ally as HP.",
                Targets = Specs(AllyOrLeader(), HandCard("a card to spend as armor")),
                Effect = c =>
                {
                    c.Draw(c.Me, 1);
                    var h = c.Target(1);
                    if (h.Kind == TargetKind.Hand) c.StackHp(c.Target(0), h.Index);
                },
            },
            new Power
            {
                Name = "Juice Flood",
                Cost = new Cost(S: 4),
                Text = "Deal 3 to every enemy character.",
                SapSelf = true,
                Effect = c =>
                {
                    foreach (var r in c.SummonsOf(c.Opp, true)) c.Damage(r, 3);
                },
            }),
            flipText: "Heal the attached character for 2.",
            flipCost: new FlipCost { Mana = new Cost(S: 1) },
            flip: c => c.Unflip(c.HolderRef, 2)),

        K.Summon(2, "ragick", "Ragick", F(Faction.Spirit, Faction.Living), str: 3, hp: 4,
            text: "Strike: Scry 5 for a spell.",
            triggers: new Triggers
            {
                OnAttack = c => c.Dig(c.Me, 5, d => d.Type == CardType.Spell),
            },
            flipText: "Each of your characters gains +2 attack.",
            flipCost: new FlipCost { Mana = new Cost(S: 2) },
            flip: c =>
            {
                foreach (var t in c.SummonsOf(c.Me, true)) c.BuffStrength(t, 2, ModDuration.Permanent);
            }),

        K.Summon(2, "sunwalker", "Sunwalker", F(Faction.Star, Faction.Mortal), str: 2, hp: 3,
            text: "Your Stars have +1 attack.",
            triggers: new Triggers
            {
                StrengthBonus = a => a.Summon.Owner == a.Controller
                    && a.Def.HasFaction(Faction.Star) ? 1 : 0,
            }),

        K.Summon(3, "aetusvox", "Aetus Vox", F(Faction.Star, Faction.Scholar), str: 3, hp: 4,
            text: "At the start of your turn, draw a card.",
            triggers: new Triggers
            {
                OnAwake = c => c.Draw(c.Me, 1),
            },
            powers: Powers(new Power
            {
                Name = "Comprehension",
                Cost = new Cost(S: 1),
                Text = "You may play another supporter this turn.",
                SapSelf = true,
                Effect = c => c.State.Players[c.Me].SupportersLeft += 1,
            })),

        K.Summon(3, "brokensun", "Broken Sun", F(Faction.Star), str: 3, hp: 3,
            text: "Battlecry: Ally summons gain +1 attack.",
            triggers: new Triggers
            {
                OnEnter = c =>
                {
                    var me = c.Self;
                    foreach (var r in c.SummonsOf(c.Me))
                    {
                        if (me is not null && r.Equals(me.Value)) continue;
                        c.BuffStrength(r, 1, ModDuration.Permanent);
                    }
                },
            },
            powers: Powers(new Power
            {
                Name = "Blaze",
                Cost = new Cost(S: 3),
                Text = "Deal 2 to a character.",
                SapSelf = true,
                Targets = Specs(AnyOrLeader()),
                Effect = c => c.Damage(c.Target(0), 2),
            })),

        K.Summon(3, "divergentlight", "Divergent Light", F(Faction.Star), str: 2, hp: 5,
            text: "When you cast a spell, gains +1 attack.",
            triggers: new Triggers
            {
                OnSpellCast = c =>
                {
                    if (c.Self is { } me) c.BuffStrength(me, 1, ModDuration.Permanent);
                },
            },
            powers: Powers(new Power
            {
                Name = "Refract",
                Cost = new Cost(S: 1, C: 1),
                Text = "Your next spell has +1 effect this turn. Draw a card.",
                SapSelf = true,
                Effect = c => { c.GrantSpellBonus(1); c.Draw(c.Me, 1); },
            })),

        K.Summon(3, "goldwild", "Gold Wild", F(Faction.Living, Faction.Beast), str: 3, hp: 4,
            text: "At the start of your turn, the top card of your deck becomes a sapped supporter "
                + "and you take 1 debt.",
            triggers: new Triggers
            {
                OnAwake = c =>
                {
                    c.SupporterFromDeck(c.Me);
                    c.AddDebt(c.Me, 1, "The gold runs wild.");
                },
            },
            powers: Powers(new Power
            {
                // Six Solar is the brake, and the body pays for it with itself.
                Name = "Ultimate Novelty",
                Cost = new Cost(S: 6),
                Text = "Destroy every enemy summon, then destroy this summon.",
                Effect = c =>
                {
                    foreach (var r in c.SummonsOf(c.Opp)) c.Destroy(r);
                    if (c.Self is { Kind: not TargetKind.Leader } me) c.Destroy(me);
                },
            })),

        K.Summon(3, "maestro", "The Maestro", F(Faction.Mortal, Faction.Scholar), str: 3, hp: 5,
            text: "At the start of your turn, an ally gains 1 HP.",
            triggers: new Triggers
            {
                OnAwake = c =>
                {
                    c.Choose("gain-hp-1", c.SummonsOf(c.Me, true), "Which ally gains 1 HP?");
                },
            },
            powers: Powers(new Power
            {
                Name = "Crescendo",
                Cost = new Cost(S: 2),
                Text = "Each of your characters gains +1 attack.",
                SapSelf = true,
                Effect = c =>
                {
                    foreach (var r in c.SummonsOf(c.Me, true)) c.BuffStrength(r, 1, ModDuration.Permanent);
                },
            },
            new Power
            {
                Name = "Grand Finale",
                Cost = new Cost(S: 4),
                Text = "Each of your characters gains +2 attack.",
                Effect = c =>
                {
                    foreach (var r in c.SummonsOf(c.Me, true)) c.BuffStrength(r, 2, ModDuration.Permanent);
                },
            })),

        K.Summon(3, "oldgod", "The Old Gods", F(Faction.Star, Faction.Spirit), str: 5, hp: 5,
            text: "All allies have +2 attack. Whenever an ally summon dies, you take 3 debt.",
            triggers: new Triggers
            {
                StrengthBonus = a => a.Summon.Owner == a.Controller
                    && a.Summon.CardId != "s3-oldgod" ? 2 : 0,
                // Billed while it stands, so leading with it is not a way to dodge the price.
                OnOtherDeath = c =>
                {
                    if (c.State.DyingOwner != c.Me) return;
                    c.AddDebt(c.Me, 3, "The old gods take their tithe.");
                },
            }),

        K.Summon(3, "smallgod", "The Small God", F(Faction.Star, Faction.Spirit), str: 3, hp: 5,
            text: "At the start of your turn, an ally gains 2 HP.",
            triggers: new Triggers
            {
                OnAwake = c =>
                {
                    c.Choose("gain-hp-2", c.SummonsOf(c.Me, true), "Which ally gains 2 HP?");
                },
            },
            powers: Powers(new Power
            {
                Name = "Miracle",
                Cost = new Cost(S: 4),
                Text = "Fully heal each of your characters.",
                Effect = c =>
                {
                    foreach (var r in c.SummonsOf(c.Me, true)) c.Unflip(r, 99);
                },
            })),

        K.Summon(3, "solusdetteri", "Solus Detteri", F(Faction.Star, Faction.Scholar), str: 3, hp: 5,
            powers: Powers(new Power
            {
                Name = "Ascend",
                Cost = new Cost(S: 1),
                Text = "Scry 5 for any card.",
                SapSelf = true,
                Effect = c =>
                {
                    c.Dig(c.Me, 5, _ => true);
                },
            })),

        K.Summon(3, "yellowplanet", "Yellow Planet", F(Faction.Star), str: 2, hp: 6,
            stationary: true, redirect: true,
            text: "Redirection. Stationary. At the start of your turn, each of your characters gains 1 HP.",
            triggers: new Triggers
            {
                OnAwake = c => { foreach (var r in c.SummonsOf(c.Me, true)) c.Reinforce(r, 1); },
            }),

        K.Spell("plusfifty", "Plus Fifty", new Cost(S: 3), "An ally gains +9 attack.",
            Specs(AllyOrLeader()), c => c.BuffStrength(c.Target(0), 9, ModDuration.Permanent)),

        K.Trap("lemonaid", "Trap: Lemon Aid", new Cost(S: 1),
            "Spell Trap. Heal each of your characters for 4. The spell still resolves.",
            null, c =>
            {
                foreach (var r in c.SummonsOf(c.Me, true)) c.Unflip(r, 4);
            }, spellTrap: true, letSpellResolve: true),

        K.Spell("celebrate", "Celebrate", new Cost(),
            "The top card of your deck becomes a sapped supporter, then draw a card. Heal your leader for 2.",
            null, c =>
            {
                c.SupporterFromDeck(c.Me);
                c.Draw(c.Me, 1);
                c.Unflip(TargetRef.Leader(c.Me), 2);
            }),

        K.Spell("flowerpower", "Flower Power", new Cost(S: 2, C: 1),
            "Each of your characters gains +2 attack.", null, c =>
            {
                foreach (var r in c.SummonsOf(c.Me, true)) c.BuffStrength(r, 2, ModDuration.Permanent);
            },
            flipText: "Each of your characters gains +2 attack.",
            flipCost: new FlipCost { Mana = new Cost(S: 2) },
            flip: c =>
            {
                foreach (var t in c.SummonsOf(c.Me, true)) c.BuffStrength(t, 2, ModDuration.Permanent);
            }),

        K.Spell("inkybook", "Inky Book", new Cost(S: 1), "Scry 5 for any card.",
            null, c =>
            {
                c.Dig(c.Me, 5, _ => true);
            }),

        K.Spell("aetalglob", "Aetal Glob", new Cost(S: 1, C: 1),
            "Heal an ally for 4 and draw a card.",
            Specs(AllyOrLeader()), c =>
            {
                c.Unflip(c.Target(0), 4);
                c.Draw(c.Me, 1);
            }),

        K.Spell("aetuscollection", "Aetus Collection", new Cost(S: 1),
            "The top 2 cards of your deck become sapped supporters.", null, c =>
            {
                for (int i = 0; i < 2; i++) c.SupporterFromDeck(c.Me);
            }),

        K.Trap("hollowring", "Trap: Hollow Ring", new Cost(S: 1),
            "The attacking summon deals no damage in this battle. Deal 2 to every enemy summon.",
            null, c =>
            {
                if (c.State.BattleAttacker is { } a) c.BuffStrength(a, -99, ModDuration.Turn);
                foreach (var r in c.SummonsOf(c.Opp)) c.Damage(r, 2);
            }),

        K.Stage("party", "Field: Party", new Cost(S: 4),
            "When played, each of your characters gains +1 attack. At the start of your turn, each of your characters gains +1 attack and heals 1.",
            new StageHooks
            {
                OnAwake = c =>
                {
                    foreach (var r in c.SummonsOf(c.Me, true))
                    {
                        c.BuffStrength(r, 1, ModDuration.Permanent);
                        c.Unflip(r, 1);
                    }
                },
            },
            flipText: "Heal the attached character for 2.",
            flipCost: new FlipCost { Mana = new Cost(S: 1) },
            flip: c => c.Unflip(c.HolderRef, 2),
            effect: c =>
            {
                foreach (var r in c.SummonsOf(c.Me, true)) c.BuffStrength(r, 1, ModDuration.Permanent);
            }),

        K.Stage("musicalflow", "Field: Musical Flow", new Cost(S: 1, C: 1),
            "At the start of your turn, you may play an extra supporter.",
            new StageHooks
            {
                OnAwake = c => c.State.Players[c.Me].SupportersLeft += 1,
            }),
    };
}
