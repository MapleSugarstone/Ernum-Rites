using static Selatza.Cards.Kit;

namespace Selatza.Cards;

/// <summary>Purple is Oil: Spirits, wounds, and moving debt rather than avoiding it.</summary>
public static class Purple
{
    private static readonly ColorKit K = new(Color.O, "o", "Purple", "Purple/Spell");

    public static CardDef[] Build() => new[]
    {
        K.Starter("spectralking", "The Spectral King", F(Faction.Spirit, Faction.Mortal),
            str: 2, hp: 3, text: "",
            powers: Powers(
                new Power
                {
                    Name = "Siphon",
                    Cost = new Cost(O: 1),
                    Text = "Put a Wound on an enemy summon and draw a card.",
                    Targets = Specs(Enemy()),
                    Effect = c =>
                    {
                        c.Wound(c.Target(0), 1);
                        c.Draw(c.Me, 1);
                    },
                },
                new Power
                {
                    Name = "Collect",
                    Cost = new Cost(O: 2),
                    Text = "Heal 1 debt.",
                    SapSelf = true,
                    Effect = c => c.ClearDebt(c.Me, 1),
                })),

        K.Summon(1, "Kapigras", "Kapigras", null, str: 1, hp: 1,
            text: "Leader: Become an Oil copy of an enemy leader of your choice.",
            triggers: new Triggers
            {
                // Every enemy seat is offered, whether or not its leader has
                // taken the field: a deck names its leader from the start, so a
                // seat still waiting on its first turn can be copied too. This
                // engine seats two, so the one enemy is picked on the spot.
                OnEnter = LeaderOnly(c => c.Choose("kapigras",
                    new[] { TargetRef.Leader(c.Opp) }, "Become a copy of which leader?")),
            },
            powers: Powers(new Power
            {
                Name = "Violence",
                Cost = new Cost(O: 3),
                Text = "Deal 4 to an enemy summon.",
                SapSelf = true,
                Targets = Specs(Enemy()),
                Effect = c => c.Damage(c.Target(0), 4),
            })),

        K.Summon(1, "butterfly", "Grave Butterfly", F(Faction.Spirit), str: 1, hp: 4,
            flipText: "Shuffle a Rot into the enemy's deck.",
            flip: c => c.Curse(c.Opp, "o-curse-rot", 1)),

        K.Summon(1, "ghost", "Ghost", F(Faction.Spirit),
            str: 1,
            hp: 2,
            text: "Deathrattle: Costs no debt.",
            triggers: new Triggers { OnDeath = c => c.FreeDeath() },
            flipText: "Deal 1 debt.",
            flip: c => c.AddDebt(c.Opp, 1)),

        K.Summon(1, "ghostbeast", "Ghost Beast", F(Faction.Spirit, Faction.Beast), str: 2, hp: 2,
            flipText: "Put a Wound on an enemy summon.",
            flip: c =>
            {
                c.Choose("wound-1", c.SummonsOf(c.Opp), "Put a Wound on which enemy summon?");
            }),

        K.Summon(1, "jacklebox", "Jacklebox", F(Faction.Spirit),
            text: "Deathrattle: Deal 1 to every enemy summon.",
            triggers: new Triggers
            {
                OnDeath = c =>
                {
                    foreach (var r in c.SummonsOf(c.Opp)) c.Damage(r, 1);
                },
            }, str: 1, hp: 2,
            flipText: "Shuffle a Rot into the enemy's deck.",
            flip: c => c.Curse(c.Opp, "o-curse-rot", 1)),

        K.Summon(1, "mothman", "Mothman", F(Faction.Spirit, Faction.Beast),
            str: 1,
            hp: 2,
            text: "Strike: Put a Wound on the defender.",
            triggers: new Triggers
            {
                OnAttack = c => { if (c.State.BattleDefender is { } d) c.Wound(d, 1); },
            },
            flipText: "Put a Wound on an enemy summon.",
            flip: c =>
            {
                c.Choose("wound-1", c.SummonsOf(c.Opp), "Put a Wound on which enemy summon?");
            }),

        K.Summon(1, "owl", "Night Owl", F(Faction.Beast), str: 1,
            hp: 2,
            powers: Powers(new Power
            {
                Name = "Watch",
                Cost = new Cost(O: 1),
                Text = "Scry 3 for a Spirit.",
                SapSelf = true,
                Effect = c =>
                {
                    c.Dig(c.Me, 3, d => d.HasFaction(Faction.Spirit));
                },
            })),

        K.Summon(1, "pumpkineater", "Pumpkin Eater", F(Faction.Beast), str: 2, hp: 5,
            text: "Battlecry: Mill 2.",
            triggers: new Triggers { OnEnter = c => c.Mill(c.Me, 2) }),

        K.Summon(1, "skeleton", "Skeleton", F(Faction.Spirit),
            str: 1,
            hp: 3,
            text: "Deathrattle: Take its debt, then return to your hand with 1 less base HP. At 0 HP it stays down.",
            // The bone wears down a printing per death: each return is a
            // generated copy one HP smaller, and the copy that would print 0 is
            // not returned, so the debt zone finally keeps it.
            triggers: new Triggers
            {
                OnDeath = c =>
                {
                    if (c.Card.Hp - 1 > 0) c.ReturnToHand(Generated.WitheredCopy(c.Card.Id));
                },
            },
            flipText: "Shuffle a Rot into the enemy's deck.",
            flip: c => c.Curse(c.Opp, "o-curse-rot", 1)),

        K.Summon(1, "snakecoil", "Snakecoil", F(Faction.Beast),
            str: 1,
            hp: 2,
            text: "When attacked, put 2 Wounds on the attacker.",
            triggers: new Triggers
            {
                OnDefend = c => { if (c.State.BattleAttacker is { } a) c.Wound(a, 2); },
            }),

        K.Summon(1, "spider", "Spider", F(Faction.Beast), str: 2, hp: 2,
            flipText: "Put a Wound on an enemy summon.",
            flip: c =>
            {
                c.Choose("wound-1", c.SummonsOf(c.Opp), "Put a Wound on which enemy summon?");
            }),

        K.Summon(2, "boneknown", "Bone Known", F(Faction.Spirit), str: 2, hp: 3,
            text: "Has +1 attack for every 2 debt you carry.",
            triggers: new Triggers
            {
                StrengthBonus = a => a.Source is not null && a.Summon.Uid == a.Source.Uid
                    ? a.State.Players[a.Controller].DebtCount / 2 : 0,
            }),

        K.Summon(2, "evilflower", "Evil Flower", F(Faction.Living, Faction.Spirit), str: 1, hp: 4,
            text: "At the start of your turn, put a Wound on every enemy summon.",
            triggers: new Triggers
            {
                OnAwake = c => { foreach (var r in c.SummonsOf(c.Opp)) c.Wound(r, 1); },
            }),

        K.Summon(2, "mooncat", "Mooncat", F(Faction.Beast, Faction.Star),
            str: 2,
            hp: 3,
            powers: Powers(new Power
            {
                Name = "Prowl",
                Cost = new Cost(O: 1),
                Text = "Deal 1 to a character and Mill 1.",
                Targets = Specs(AnyOrLeader("a character")),
                Effect = c =>
                {
                    c.Damage(c.Target(0), 1);
                    c.Mill(c.Me, 1);
                },
            })),

        K.Summon(2, "necromancer", "Necromancer", F(Faction.Mortal, Faction.Scholar), str: 1, hp: 2,
            powers: Powers(new Power
            {
                Name = "Raise",
                Cost = new Cost(O: 1),
                Text = "Put a summon from the enemy's debt zone into an empty slot with +2/+2, rebuilt in Oil as a Spirit.",
                Targets = Specs(EnemyDebt()),
                Effect = c =>
                {
                    var r = c.Target(0);
                    if (r.Kind != TargetKind.Debt) return;
                    var slot = c.EmptySlot(c.Me);
                    if (slot is null)
                    {
                        c.Log("No grave to fill.");
                        return;
                    }
                    var id = c.RemoveFromDebt(r.Player, r.Index);
                    if (id is null) return;
                    var raised = Generated.OilRaise(id);
                    c.PutSummon(c.Me, raised, slot.Value, 0, Color.O, Registry.Card(raised).Hp, 1, asPrinted: true);
                },
            })),

        K.Summon(2, "parkranger", "Park Ranger", F(Faction.Mortal), str: 2, hp: 3,
            powers: Powers(new Power
            {
                Name = "Tend",
                Cost = new Cost(),
                SapSelf = true,
                Text = "Clear all Wounds from every character. This summon gains +1 attack for each, "
                    + "then heals 1.",
                Effect = c =>
                {
                    int cleared = 0;
                    foreach (var player in new[] { c.Me, c.Opp })
                    {
                        foreach (var r in c.SummonsOf(player, true))
                        {
                            var s = c.SummonAt(r);
                            if (s is null || s.Wounds == 0) continue;
                            cleared += s.Wounds;
                            s.Wounds = 0;
                        }
                    }
                    if (c.Self is { } me)
                    {
                        if (cleared > 0) c.BuffStrength(me, cleared, ModDuration.Permanent);
                        c.Unflip(me, 1);
                    }
                },
            })),

        K.Summon(2, "scientist", "Scientist", F(Faction.Mortal, Faction.Scholar), str: 2,
            hp: 4,
            text: "When an ally Scholar dies, draw a card.",
            triggers: new Triggers
            {
                OnOtherDeath = c =>
                {
                    if (c.State.DyingOwner != c.Me) return;
                    var dead = c.State.DyingCardId;
                    if (dead is not null && Registry.Card(dead).HasFaction(Faction.Scholar)) c.Draw(c.Me, 1);
                },
            },
            powers: Powers(new Power
            {
                Name = "Experiment",
                Cost = new Cost(),
                Text = "Mill 2 and take 1 debt, then draw a card.",
                // The debt is what stops this repeating forever: it charges nothing
                // and taps nothing, so the only ceiling is the debt you can carry.
                Effect = c =>
                {
                    c.Mill(c.Me, 2);
                    c.AddDebt(c.Me, 1);
                    c.Draw(c.Me, 1);
                },
            })),

        K.Summon(2, "slime", "Slime", F(Faction.Living), str: 3, hp: 4,
            text: "Deathrattle: Put a Slime with 1 less HP into an empty slot.",
            triggers: new Triggers
            {
                OnDeath = c =>
                {
                    // Hp.Count is what it was built with, flipped cards included,
                    // so the chain shrinks by one whatever damage it took.
                    if (c.Source is not { } dying) return;
                    int hp = dying.Hp.Count - 1;
                    // A body with no HP cannot exist, so that is where it ends.
                    if (hp <= 0) return;
                    var slot = c.EmptySlot(c.Me);
                    if (slot is null) return;
                    c.PutSummon(c.Me, "o2-slime", slot.Value, 3, Color.O, hp, 2);
                },
            }),

        K.Summon(2, "stabber", "Stabber", F(Faction.Mortal, Faction.Spirit), str: 3, hp: 1,
            text: "Strike: The defender loses 1 attack until end of turn. "
                + "When an ally Spirit dies, gains 1 HP.",
            triggers: new Triggers
            {
                OnAttack = c =>
                {
                    if (c.State.BattleDefender is { } d) c.BuffStrength(d, -1, ModDuration.Turn);
                },
                OnOtherDeath = c =>
                {
                    if (c.State.DyingOwner != c.Me) return;
                    var dead = c.State.DyingCardId;
                    if (dead is null || !Registry.Card(dead).HasFaction(Faction.Spirit)) return;
                    if (c.Self is { } me) c.Reinforce(me, 1);
                },
            },
            powers: Powers(new Power
            {
                Name = "Bleed",
                Cost = new Cost(O: 1),
                Text = "Put a Wound on an enemy summon.",
                SapSelf = true,
                Targets = Specs(Enemy()),
                Effect = c => c.Wound(c.Target(0), 1),
            }),
            flipText: "The enemy cannot replace summons that die until the end of your turn.",
            flipCost: new FlipCost { Mana = new Cost(O: 1) },
            flip: c => c.LockReplace(c.Opp, 1)),

        K.Summon(2, "thecount", "The Count", F(Faction.Spirit, Faction.Mortal), str: 1, hp: 3,
            text: "Strike: Put 2 Wounds on the defender. Heals 2 whenever it kills an enemy summon.",
            triggers: new Triggers
            {
                OnAttack = c =>
                {
                    if (c.State.BattleDefender is { } d) c.Wound(d, 2);
                },
                // Only a death inside a battle this body started counts as its kill.
                OnOtherDeath = c =>
                {
                    if (c.State.BattleAttacker is not { } atk) return;
                    if (c.Source is null || c.State.DyingOwner != c.Opp) return;
                    if (!ReferenceEquals(c.State.Find(atk), c.Source)) return;
                    if (c.Self is { } me) c.Unflip(me, 2);
                },
            },
            flipText: "Shuffle 3 Dread into the enemy's deck.",
            flipCost: new FlipCost { Mana = new Cost(O: 1) },
            flip: c => c.Curse(c.Opp, "o-curse-dread", 3)),

        K.Summon(2, "witch", "Witch", F(Faction.Mortal, Faction.Scholar),
            str: 2,
            hp: 3,
            powers: Powers(
            new Power
            {
                Name = "Curse",
                Cost = new Cost(O: 1),
                Text = "Shuffle 2 Rot into the enemy's deck.",
                SapSelf = true,
                Effect = c => c.Curse(c.Opp, "o-curse-rot", 2),
            },
            new Power
            {
                Name = "Hex",
                Cost = new Cost(O: 1),
                Text = "Put 3 Wounds on an enemy summon.",
                Targets = Specs(Enemy()),
                SapSelf = true,
                Effect = c => c.Wound(c.Target(0), 3),
            })),

        K.Summon(3, "bighatsalze", "Big Hat Salze", F(Faction.Mortal, Faction.Scholar),
            str: 3, hp: 4,
            powers: Powers(new Power
            {
                Name = "Study",
                Cost = new Cost(),
                Text = "Mill 2 and add 1 Oil to your mana pool.",
                SapSelf = true,
                Effect = c =>
                {
                    c.Mill(c.Me, 2);
                    c.State.Players[c.Me].Mana[(int)Color.O] += 1;
                    c.Log("Salze burns pages for power.");
                },
            })),

        K.Summon(3, "darksideofthemoon", "Dark Side of the Moon", F(Faction.Star, Faction.Spirit),
            str: 2, hp: 6, text: "Wounded enemies have -1 attack.",
            triggers: new Triggers
            {
                StrengthBonus = a => a.Summon.Owner != a.Controller
                    && a.Summon.Wounds > 0 ? -1 : 0,
            }),

        K.Summon(3, "devourer", "The Devourer", F(Faction.Beast, Faction.Spirit), str: 2, hp: 4,
            text: "Strike: Put 3 Wounds on the defender.",
            triggers: new Triggers
            {
                OnAttack = c =>
                {
                    if (c.State.BattleDefender is { } d) c.Wound(d, 3);
                },
            }),

        K.Summon(3, "eyesnight", "Eyes of Night", F(Faction.Spirit), str: 2, hp: 4,
            woundAmplify: true,
            text: "Wounds on enemy summons become damage one for one. "
                + "At the start of your turn, Mill 2.",
            triggers: new Triggers { OnAwake = c => c.Mill(c.Me, 2) }),

        K.Summon(3, "fungal", "Fungal Bloom", F(Faction.Living), str: 2, hp: 5,
            text: "Deathrattle: Every enemy summon takes 3 Wounds. "
            + "The enemy cannot replace summons that die until the end of your turn.",
            triggers: new Triggers
            {
                OnDeath = c =>
                {
                    foreach (var r in c.SummonsOf(c.Opp)) c.Wound(r, 3);
                    c.LockReplace(c.Opp, 1);
                },
            }),

        K.Summon(3, "mothhorror", "Moth Horror", F(Faction.Spirit, Faction.Beast), str: 4, hp: 3,
            text: "Battlecry: Put 2 Wounds on every summon in play.",
            triggers: new Triggers
            {
                OnEnter = c =>
                {
                    foreach (var r in c.SummonsOf(c.Me)) c.Wound(r, 2);
                    foreach (var r in c.SummonsOf(c.Opp)) c.Wound(r, 2);
                },
            }),

        K.Summon(3, "raingod", "Rain God", F(Faction.Spirit, Faction.Star), str: 2, hp: 5,
            text: "At the start of your turn, deal 1 to every Wounded enemy summon.",
            triggers: new Triggers
            {
                OnAwake = c =>
                {
                    foreach (var r in c.SummonsOf(c.Opp))
                    {
                        if (c.SummonAt(r) is { Wounds: > 0 }) c.Damage(r, 1);
                    }
                },
            }),

        K.Summon(3, "thelake", "The Lake", F(Faction.Living, Faction.Spirit), str: 2, hp: 6,
            stationary: true, redirect: true,
            text: "Redirection. Stationary. When an enemy summon dies, Shuffle a Rot into the enemy's deck.",
            triggers: new Triggers
            {
                OnOtherDeath = c =>
                {
                    if (c.State.DyingOwner == c.Opp) c.Curse(c.Opp, "o-curse-rot", 1);
                },
            },
            flipText: "Shuffle a Rot into the enemy's deck.",
            flip: c => c.Curse(c.Opp, "o-curse-rot", 1)),

        K.Summon(3, "wickerman", "Wicker Man", F(Faction.Living, Faction.Spirit), str: 3, hp: 4,
            text: "Deathrattle: Shuffle 2 Rot into the enemy's deck.",
            triggers: new Triggers { OnDeath = c => c.Curse(c.Opp, "o-curse-rot", 2) }),

        K.Spell("bomb", "Bomb", new Cost(O: 2),
            "Destroy an enemy summon that has 3 or less HP left.",
            Specs(new TargetSpec
            {
                Kind = TargetKind.Summon,
                Side = Side.Enemy,
                Label = "a weakened enemy summon",
                Filter = a => a.Summon is { } s && s.RemainingHp <= 3,
            }),
            c => c.Destroy(c.Target(0)),
            flipText: "Put a Wound on an enemy summon.",
            flip: c =>
            {
                c.Choose("wound-1", c.SummonsOf(c.Opp), "Put a Wound on which enemy summon?");
            }),

        K.Spell("blackcandle", "Black Candle", new Cost(O: 1),
            "Put 2 Wounds on every enemy summon.", null, c =>
            {
                foreach (var r in c.SummonsOf(c.Opp)) c.Wound(r, 2);
            }),

        K.Spell("bonedivination", "Bone Divination", new Cost(),
            "Scry 4 for a summon.", null, c =>
            {
                c.Dig(c.Me, 4, d => d.Type == CardType.Summon);
            }),

        K.Spell("corruptedritual", "Corrupted Ritual", new Cost(O: 1, C: 1),
            "Destroy one of your summons, then your opponent takes 2 debt.",
            Specs(Ally("one of your summons")), c =>
            {
                if (c.SummonAt(c.Target(0)) is null) return;
                c.Destroy(c.Target(0));
                c.AddDebt(c.Opp, 2, "The ritual passes the bill along.");
            }),

        K.Spell("graft", "Graft", new Cost(O: 1),
            "An ally gains another summon's Powers, text and factions, with the "
            + "gained Powers rebuilt in Oil. Draw a card.",
            Specs(new TargetSpec
            {
                Kind = TargetKind.Summon,
                Side = Side.Any,
                Label = "a summon to graft from",
                Filter = a => a.Card is { } d
                    && (d.Powers is { Length: > 0 } || d.Triggers is not null
                        || !string.IsNullOrWhiteSpace(d.Text)),
            }, Ally()), c =>
            {
                var source = c.SummonAt(c.Target(0));
                var dest = c.SummonAt(c.Target(1));
                if (source is null || dest is null) return;
                var was = Registry.Card(dest.CardId);
                c.Log($"{was.Name} grafts on "
                    + $"{Registry.Card(source.CardId).Name}'s Powers.");
                dest.CardId = Generated.GraftedCopy(
                    dest.CardId, source.CardId,
                    dest.Override?.Strength ?? was.Strength,
                    GameState.ColorOf(dest, was),
                    GameState.LevelOf(dest, was),
                    GameState.PowersOf(dest, was));
                // The minted card carries the stats the override was supplying, so the
                // override has done its job and would otherwise blank the new Powers.
                dest.Override = null;
                c.Draw(c.Me, 1);
            }),

        K.Spell("ghostshadow", "Ghost Shadow", new Cost(O: 1),
            "An enemy summon loses 3 attack until end of turn.",
            Specs(Enemy()), c => c.BuffStrength(c.Target(0), -3, ModDuration.Turn)),

        K.Spell("wishingclaw", "Wishing Claw", new Cost(), "Draw 3 cards and take 2 debt.",
            null, c =>
            {
                c.Draw(c.Me, 3);
                c.AddDebt(c.Me, 2, "The claw always wants paying.");
            },
            flipText: "Shuffle 3 Dread into the enemy's deck.",
            flipCost: new FlipCost { Mana = new Cost(O: 2) },
            flip: c => c.Curse(c.Opp, "o-curse-dread", 3)),

        K.Trap("lazyeye", "Trap: Lazy Eye", new Cost(O: 1),
            "Put 5 Wounds on the attacking summon.", null, c =>
            {
                if (c.State.BattleAttacker is { } a) c.Wound(a, 5);
            }),

        K.Stage("campfire", "Field: Campfire", new Cost(O: 1),
            "At the start of your turn, draw a card and Shuffle a Rot into the enemy's deck.",
            new StageHooks
            {
                OnAwake = c =>
                {
                    c.Draw(c.Me, 1);
                    c.Curse(c.Opp, "o-curse-rot", 1);
                },
            },
            flipText: "Shuffle a Rot into the enemy's deck.",
            flip: c => c.Curse(c.Opp, "o-curse-rot", 1)),

        K.Stage("mysterycabin", "Field: Mystery Cabin", new Cost(O: 1),
            "Your Spirits have +1 attack.",
            new StageHooks
            {
                StrengthBonus = a => a.Summon.Owner == a.Controller
                    && a.Def.HasFaction(Faction.Spirit) ? 1 : 0,
            }),
    };
}
