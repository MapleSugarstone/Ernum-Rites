using static Selatza.Cards.Kit;

namespace Selatza.Cards;

/// <summary>Dual-colour cards are where the factions actually pay off.</summary>
public static class Mixed
{
    private static readonly DualKit Bg = new("BG", Color.F, Color.R);
    private static readonly DualKit Bp = new("BP", Color.F, Color.O);
    private static readonly DualKit Pg = new("PG", Color.O, Color.R);
    private static readonly DualKit Rb = new("RB", Color.P, Color.F);
    private static readonly DualKit Rg = new("RG", Color.P, Color.R);
    private static readonly DualKit Rp = new("RP", Color.P, Color.O);
    private static readonly DualKit Yb = new("YB", Color.S, Color.F);
    private static readonly DualKit Yg = new("YG", Color.S, Color.R);
    private static readonly DualKit Yp = new("YP", Color.S, Color.O);
    private static readonly DualKit Yr = new("YR", Color.S, Color.P);

    public static CardDef[] Build() => new[]
    {
        // --- Fish and Machine ------------------------------------------------
        Bg.Summon(2, "robotfish", "Robotfish", F(Faction.Fish, Faction.Machine), str: 2, hp: 3,
            text: "",
            powers: Powers(new Power
            {
                Name = "Filter",
                Cost = new Cost(F: 1, R: 1),
                Text = "Catch a spent HP card off an ally, and this character gains a Power Shield.",
                SapSelf = true,
                Targets = Specs(new TargetSpec
                {
                    Kind = TargetKind.Summon,
                    Side = Side.Ally,
                    IncludeLeader = true,
                    Label = "an ally with spent HP",
                    Filter = a => a.Summon is not null && a.Summon.Hp.Any(h => h.Flipped),
                }),
                Effect = c =>
                {
                    c.Catch(c.Target(0), 1);
                    if (c.Self is { } me) c.Shield(me, 1);
                },
            })),

        Bg.Summon(3, "machineblue", "Machine Blue", F(Faction.Machine, Faction.Fish),
            str: 2, hp: 3,
            text: "Has +1 attack for each other summon you control.",
            triggers: new Triggers
            {
                StrengthBonus = a =>
                {
                    if (a.Summon.CardId != "m-bg-machineblue" || a.Summon.Owner != a.Controller) return 0;
                    int n = 0;
                    foreach (var s in a.State.Players[a.Controller].Slots)
                    {
                        if (s is not null && s.CardId != "m-bg-machineblue") n++;
                    }
                    return n;
                },
            },
            powers: Powers(new Power
            {
                Name = "Assembly Line",
                Cost = new Cost(F: 1, R: 1),
                Text = "Fill an empty slot with a Minnowling.",
                SapSelf = true,
                Effect = c =>
                {
                var slot = c.EmptySlot(c.Me);
                if (slot is null)
                {
                    c.Log("No room on the line.");
                    return;
                }
                c.PutSummon(c.Me, "f1-basicfish", slot.Value, 0, Color.F,
                    Registry.Card("f1-basicfish").Hp, asPrinted: true);
                },
            })),

        Bg.Summon(3, "hedronheart", "Hedron Heart", F(Faction.Hedron), str: 2, hp: 6,
            text: "Battlecry: Gains a Power Shield. At the start of your turn, gains 1 HP.",
            triggers: new Triggers
            {
                OnEnter = c => { if (c.Self is { } me) c.Shield(me, 1); },
                OnAwake = c => { if (c.Self is { } me) c.Reinforce(me, 1); },
            },
            powers: Powers(new Power
            {
                Name = "Bulwark",
                Cost = new Cost(F: 1, R: 1),
                Text = "Gains a Power Shield and 1 HP off your deck.",
                SapSelf = true,
                Effect = c =>
                {
                if (c.Self is not { } me) return;
                c.Shield(me, 1);
                c.Reinforce(me, 1);
                },
            })),

        Bg.Spell("fishcode", "Fishcode", new Cost(F: 1, R: 1),
            "Turn an enemy summon into a Minnowling, then draw a card.",
            Specs(Enemy()), c =>
            {
                c.Transform(c.Target(0), "f1-basicfish");
                c.Draw(c.Me, 1);
            }),

        Bg.Spell("greenorblue", "Green or Blue", new Cost(F: 1, R: 1),
            "Scry 6 for a Fish or a Machine.", null, c =>
            {
                c.Dig(c.Me, 6,
                    d => d.HasFaction(Faction.Fish) || d.HasFaction(Faction.Machine));
            }),

        // --- Fish and Spirit -------------------------------------------------
        Bp.Summon(2, "hatefuljely", "Hateful Jelly", F(Faction.Fish, Faction.Spirit), str: 2, hp: 4,
            spellImmune: true,
            text: "Spell Immunity. When attacked, put 2 Wounds on the attacker.",
            triggers: new Triggers
            {
                OnDefend = c => { if (c.State.BattleAttacker is { } a) c.Wound(a, 2); },
            },
            powers: Powers(new Power
            {
                Name = "Sting",
                Cost = new Cost(F: 1, O: 1),
                Text = "Put 2 Wounds on an enemy summon.",
                SapSelf = true,
                Targets = Specs(Enemy()),
                Effect = c =>
                {
                c.Wound(c.Target(0), 2);
                },
            })),

        Bp.Summon(3, "enigmastelf", "Enigmastelf", F(Faction.Spirit, Faction.Scholar),
            str: 3, hp: 5,
            spellImmune: true,
            text: "Spell Immunity. At the start of your turn, Mill 2.",
            triggers: new Triggers { OnAwake = c => c.Mill(c.Me, 2) },
            powers: Powers(new Power
            {
                Name = "Trade Places",
                Cost = new Cost(F: 1, O: 1),
                Text = "Swap all HP cards between one of your summons and an enemy summon.",
                Targets = Specs(Ally("your summon"), Enemy()),
                Effect = c =>
                {
                    var mine = c.SummonAt(c.Target(0));
                    var theirs = c.SummonAt(c.Target(1));
                    if (mine is null || theirs is null) return;
                    (mine.Hp, theirs.Hp) = (theirs.Hp, mine.Hp);
                    c.Log("The two of them trade skins.");
                },
            })),

        Bp.Summon(3, "voidbug", "Void Bug", F(Faction.Spirit, Faction.Beast), str: 4, hp: 5,
            spellImmune: true,
            text: "Spell Immunity. At the start of your turn, you take 1 debt. "
                + "Deathrattle: Deal 2 debt.",
            triggers: new Triggers
            {
                OnAwake = c => c.AddDebt(c.Me, 1, "The void bug feeds on its keeper."),
                OnDeath = c => c.AddDebt(c.Opp, 2, "The void bug bills the other side."),
            },
            powers: Powers(new Power
            {
                Name = "Feed",
                Cost = new Cost(F: 1, O: 1),
                Text = "Deal 1 debt.",
                SapSelf = true,
                Effect = c =>
                {
                c.AddDebt(c.Opp, 1, "The void bug bills ahead of schedule.");
                },
            })),

        Bp.Spell("orb", "The Orb", new Cost(F: 1, O: 1),
            "Destroy a sapped summon and return a summon from your debt to your hand.",
            Specs(new TargetSpec
            {
                Kind = TargetKind.Summon,
                Side = Side.Any,
                Label = "a sapped summon",
                Filter = a => a.Summon is not null && a.Summon.Sapped,
            }),
            c =>
            {
                c.Destroy(c.Target(0));
                c.Choose("debt-summon-to-hand", c.DebtSummons(c.Me), "Return which summon to hand?");
            }),

        Bp.Spell("visitor", "The Visitor", new Cost(F: 1, O: 2),
            "Take control of an enemy summon with 2 or less HP left.",
            Specs(new TargetSpec
            {
                Kind = TargetKind.Summon,
                Side = Side.Enemy,
                Label = "a weakened enemy summon",
                Filter = a => a.Summon is not null && a.Summon.RemainingHp <= 2,
            }),
            c => c.TakeControl(c.Target(0))),

        // --- Pepper and Fish -------------------------------------------------
        Rb.Summon(2, "sordidbeast", "Sordid Beast", F(Faction.Beast), str: 3, hp: 2,
            text: "Strike: Deal 1 to the defender first. If it dies, draw a card.",
            triggers: new Triggers
            {
                OnAttack = c =>
                {
                    if (c.State.BattleDefender is not { } d) return;
                    c.Damage(d, 1);
                    if (c.SummonAt(d) is null) c.Draw(c.Me, 1);
                },
            },
            powers: Powers(new Power
            {
                Name = "Maul",
                Cost = new Cost(P: 1, F: 1),
                Text = "Deal 1 to an enemy summon. If it dies, draw a card.",
                SapSelf = true,
                Targets = Specs(Enemy()),
                Effect = c =>
                {
                c.Damage(c.Target(0), 1);
                if (c.SummonAt(c.Target(0)) is null) c.Draw(c.Me, 1);
                },
            })),

        Rb.Summon(3, "xyliss", "Xyliss", F(Faction.Spirit, Faction.Scholar), str: 2, hp: 5,
            powers: Powers(new Power
            {
                Name = "Rewrite",
                Cost = new Cost(P: 1, F: 1),
                Text = "Turn one of your summons into any summon sitting in your debt zone.",
                Targets = Specs(Ally("your summon"), MyDebt("a summon in your debt")),
                Effect = c =>
                {
                    var d = c.Target(1);
                    if (d.Kind != TargetKind.Debt) return;
                    var id = c.RemoveFromDebt(c.Me, d.Index);
                    if (id is not null) c.Transform(c.Target(0), id);
                },
            }, new Power
            {
                Name = "Foresight",
                Cost = new Cost(F: 1),
                Text = "Draw a card, then pay off 1 debt.",
                SapSelf = true,
                Effect = c => { c.Draw(c.Me, 1); c.ClearDebt(c.Me, 1); },
            })),

        Rb.Spell("savetheuniverse", "Save the Universe", new Cost(P: 2, F: 2),
            "Fully heal each of your characters.", null, c =>
            {
                foreach (var r in c.SummonsOf(c.Me, true)) c.Unflip(r, 99);
            }),

        Rb.Spell("sordidfruit", "Sordid Fruit", new Cost(P: 1, F: 1),
            "Return a spell from your discard pile to your hand, then draw a card.",
            null, c =>
            {
                c.Choose("discard-spell-to-hand", c.DiscardSpells(c.Me), "Return which spell to hand?");
                c.Draw(c.Me, 1);
            }),

        Rb.Trap("sordidmark", "Trap: Sordid Mark", new Cost(P: 1, F: 1),
            "The attacking summon becomes Stationary. Deal 2 to it.", null, c =>
            {
                if (c.State.BattleAttacker is { } a)
                {
                    if (c.SummonAt(a) is { } s) s.Rooted = true;
                    c.Damage(a, 2);
                }
            }),

        // --- Pepper and Machine ----------------------------------------------
        Rg.Summon(2, "xyuzdrone", "Xyuz Drone", F(Faction.Machine), str: 2, hp: 2,
            text: "Battlecry: Deal 1 to every enemy summon.",
            triggers: new Triggers
            {
                OnEnter = c => { foreach (var r in c.SummonsOf(c.Opp)) c.Damage(r, 1); },
            },
            powers: Powers(new Power
            {
                Name = "Laser Sweep",
                Cost = new Cost(P: 1, R: 1),
                Text = "Deal 1 to every enemy summon.",
                SapSelf = true,
                Effect = c =>
                {
                foreach (var r in c.SummonsOf(c.Opp)) c.Damage(r, 1);
                },
            })),

        Rg.Summon(3, "professorpistachio", "Professor Pistachio",
            F(Faction.Scholar, Faction.Machine), str: 1, hp: 2,
            text: "Your Scholars have +1 attack, and you draw a card at the start of your turn.",
            triggers: new Triggers
            {
                StrengthBonus = a => a.Summon.Owner == a.Controller
                    && a.Def.HasFaction(Faction.Scholar) ? 1 : 0,
                OnAwake = c => c.Draw(c.Me, 1),
            },
            powers: Powers(new Power
            {
                Name = "Xyuz Technology",
                Cost = new Cost(P: 1, R: 1),
                Text = "Scry 3 for a spell or Machine.",
                SapSelf = true,
                Effect = c =>
                {
                c.Dig(c.Me, 3, d => d.Type == CardType.Spell || d.HasFaction(Faction.Machine));
                },
            })),

        Rg.Summon(3, "obelisks", "The Obelisks", F(Faction.Machine), str: 1, hp: 2,
            stationary: true,
            text: "Stationary. All enemies have -1 attack. "
                + "At the start of your turn, loses 1 HP.",
            triggers: new Triggers
            {
                StrengthBonus = a => a.Summon.Owner == a.Controller ? 0 : -1,
                // Raw, so no Effect Damage bonus inflates the upkeep it pays.
                OnAwake = c => { if (c.Self is { } me) c.RawDamage(me, 1); },
            },
            powers: Powers(new Power
            {
                Name = "Oppress",
                Cost = new Cost(P: 1, R: 1, C: 1),
                Text = "Every enemy summon loses 1 attack.",
                SapSelf = true,
                Effect = c =>
                {
                    foreach (var r in c.SummonsOf(c.Opp)) c.BuffStrength(r, -1, ModDuration.Permanent);
                },
            })),

        Rg.Spell("recompiler", "Recompiler", new Cost(P: 1, R: 1),
            "Fuse 2 summons into a Recomp in your hand: the higher of each stat, their factions, and their Powers rebuilt in Pepper and Robot. Draw a card.",
            Specs(Any("the first summon"), Any("the second summon")), c =>
            {
                var a = c.SummonAt(c.Target(0));
                var b = c.SummonAt(c.Target(1));
                if (a is null || b is null || ReferenceEquals(a, b)) return;
                int str2 = Math.Max(Effects.EffectiveStrength(c.State, a), Effects.EffectiveStrength(c.State, b));
                int hp2 = Math.Max(a.RemainingHp, b.RemainingHp);
                int lvl = Math.Max(
                    GameState.LevelOf(a, Registry.Card(a.CardId)),
                    GameState.LevelOf(b, Registry.Card(b.CardId)));
                var genId = Generated.FusedRecomp(a.CardId, b.CardId, str2, hp2, lvl);
                // The parts go home to their owners' discard piles whole: fusing is not dying.
                foreach (var x in new[] { a, b })
                {
                    var owner = c.State.Players[x.Owner];
                    int i = Array.IndexOf(owner.Slots, x);
                    if (i >= 0) owner.Slots[i] = null;
                    owner.Discard.Add(x.CardId);
                    foreach (var h in x.Hp) owner.Discard.Add(h.CardId);
                }
                c.ToHand(c.Me, genId);
                c.Draw(c.Me, 1);
            }),

        // The fusion product. Its stats are whatever the fuse averaged, so the
        // printed line is only a fallback.
        new CardDef
        {
            Id = "m-rg-recomp",
            Name = "Recomp",
            Color = Color.P,
            Color2 = Color.R,
            Type = CardType.Summon,
            Level = 2,
            Strength = 3,
            Hp = 4,
            Uncollectible = true,
            Factions = F(Faction.Machine),
            Art = "Cardgame/Extras/Recomp.png",
            Num = "CRC",
        },

        Rg.Spell("virus", "Virus", new Cost(P: 1, R: 1),
            "Deal 1 to an enemy summon. If it dies, rebuild it in Pepper and Robot on your side.",
            Specs(Enemy()), c =>
            {
                var victim = c.SummonAt(c.Target(0));
                if (victim is null) return;
                var id = victim.CardId;
                c.Damage(c.Target(0), 1);
                if (c.SummonAt(c.Target(0)) is not null) return;
                var slot = c.EmptySlot(c.Me);
                int at = c.State.Players[c.Opp].DebtZone.LastIndexOf(id);
                if (slot is null || at < 0) return;
                c.RemoveFromDebt(c.Opp, at);
                var genId = Generated.PepperRobotCopy(id);
                var d = Registry.Card(genId);
                c.PutSummon(c.Me, genId, slot.Value, d.Strength, Color.P, d.Hp, asPrinted: true);
            }),

        // --- Pepper and Oil ---------------------------------------------------
        Rp.Summon(2, "falsehumanity", "False Humanity", F(Faction.Mortal, Faction.Spirit),
            str: 2, hp: 3,
            text: "Deathrattle: Deal 2 to the enemy leader.",
            triggers: new Triggers { OnDeath = c => c.Damage(TargetRef.Leader(c.Opp), 2) },
            powers: Powers(new Power
            {
                Name = "Haunt",
                Cost = new Cost(P: 1, O: 1),
                Text = "Deal 2 to the enemy leader.",
                SapSelf = true,
                Effect = c => c.Damage(TargetRef.Leader(c.Opp), 2),
            })),

        Rp.Summon(3, "theking", "The King", F(Faction.Mortal), str: 1, hp: 2,
            text: "Ally Mortals have +2 attack. Deathrattle: Deal 2 debt.",
            triggers: new Triggers
            {
                StrengthBonus = a => a.Summon.Owner == a.Controller
                    && a.Def.HasFaction(Faction.Mortal)
                    && a.Summon.CardId != "m-rp-theking" ? 2 : 0,
                OnDeath = c => c.AddDebt(c.Opp, 2, "The king does not fall alone."),
            },
            powers: Powers(new Power
            {
                Name = "Decree",
                Cost = new Cost(P: 1, O: 2, C: 1),
                Text = "An ally gains this card's Deathrattle.",
                SapSelf = true,
                Targets = Specs(new TargetSpec
                {
                    Kind = TargetKind.Summon,
                    Side = Side.Ally,
                    Label = "an ally summon",
                    Filter = a => a.Card?.Id != "m-rp-theking",
                }),
                Effect = c =>
                {
                    var s = c.SummonAt(c.Target(0));
                    if (s is not null) s.Bestowed = "m-rp-theking";
                },
            })),

        Rp.Spell("alchemy", "Alchemy", new Cost(P: 1, O: 1),
            "Put a card from your hand under an ally as HP, then draw 2 cards.",
            Specs(AllyOrLeader(), HandCard("a card to spend as armor")), c =>
            {
                var h = c.Target(1);
                if (h.Kind == TargetKind.Hand) c.StackHp(c.Target(0), h.Index);
                c.Draw(c.Me, 2);
            }),

        Rp.Spell("annihilate", "Annihilate", new Cost(P: 1, O: 2),
            "Annihilate an enemy summon. Its Deathrattle does not fire and it never reaches their debt.",
            Specs(Enemy()), c => c.Annihilate(c.Target(0))),

        Rp.Spell("greedandfear", "Greed and Fear", new Cost(P: 1, O: 1),
            "Draw 3 cards, then take 1 debt.", null, c =>
            {
                c.Draw(c.Me, 3);
                c.AddDebt(c.Me, 1, "Greed has a price.");
            }),

        // --- Solar and Fish ----------------------------------------------------
        Yb.Summon(2, "livingriver", "Living River", F(Faction.Living, Faction.Fish), str: 1, hp: 5,
            text: "At the start of your turn, each of your characters heals 1.",
            triggers: new Triggers
            {
                OnAwake = c => { foreach (var r in c.SummonsOf(c.Me, true)) c.Unflip(r, 1); },
            },
            powers: Powers(new Power
            {
                Name = "Flow",
                Cost = new Cost(S: 1, F: 1),
                Text = "Heal an ally for 2.",
                SapSelf = true,
                Targets = Specs(AllyOrLeader()),
                Effect = c => c.Unflip(c.Target(0), 2),
            })),

        Yb.Summon(3, "themoon", "The Moon", F(Faction.Star), str: 1, hp: 5,
            text: "Your Stars have +1 attack. At the start of your turn, your leader heals 1.",
            triggers: new Triggers
            {
                StrengthBonus = a => a.Summon.Owner == a.Controller
                    && a.Def.HasFaction(Faction.Star) ? 1 : 0,
                OnAwake = c => c.Unflip(TargetRef.Leader(c.Me), 1),
            },
            powers: Powers(new Power
            {
                Name = "Moonrise",
                Cost = new Cost(S: 2, F: 1),
                Text = "Deal 3 debt.",
                SapSelf = true,
                Effect = c => c.AddDebt(c.Opp, 3),
            })),

        Yb.Summon(3, "ambrosia", "Ambrosia", F(Faction.Living, Faction.Star), str: 2, hp: 5,
            text: "Battlecry: Each of your characters gains 2 HP.",
            triggers: new Triggers
            {
                OnEnter = c => { foreach (var r in c.SummonsOf(c.Me, true)) c.Reinforce(r, 2); },
            },
            powers: Powers(new Power
            {
                Name = "Nectar",
                Cost = new Cost(S: 1, F: 1),
                Text = "Heal your leader for 2, then draw a card.",
                SapSelf = true,
                Effect = c => { c.Unflip(TargetRef.Leader(c.Me), 2); c.Draw(c.Me, 1); },
            })),

        Yb.Spell("fishsong", "Fish Song", new Cost(S: 1, F: 1),
            "Scry 6 for a Fish or a Living card, then draw a card.", null, c =>
            {
                c.Dig(c.Me, 6, d => d.HasFaction(Faction.Fish) || d.HasFaction(Faction.Living));
                c.Draw(c.Me, 1);
            }),

        Yb.Spell("skypaint", "Skypaint", new Cost(S: 1, F: 1),
            "Heal an ally for 4.",
            Specs(AllyOrLeader()), c => c.Unflip(c.Target(0), 4)),

        // --- Solar and Machine -------------------------------------------------
        Yg.Summon(2, "krazbot", "Krazbot", F(Faction.Machine, Faction.Living), str: 2, hp: 3,
            text: "Whenever you play a Machine or a Hedron, draw a card.",
            triggers: new Triggers
            {
                OnSummonPlayed = c =>
                {
                    var played = c.SummonAt(c.Target(0));
                    if (played is null || played.Owner != c.Me) return;
                    var def = Registry.Card(played.CardId);
                    if (def.HasFaction(Faction.Machine) || def.HasFaction(Faction.Hedron)) c.Draw(c.Me, 1);
                },
            },
            powers: Powers(new Power
            {
                Name = "Overclock",
                Cost = new Cost(S: 1, R: 1),
                Text = "Unsap an ally summon, then pay off 1 debt.",
                SapSelf = true,
                Targets = Specs(new TargetSpec
                {
                    Kind = TargetKind.Summon,
                    Side = Side.Ally,
                    Label = "a sapped ally summon",
                    Filter = a => a.Summon is not null && a.Summon.Sapped,
                }),
                Effect = c => c.Unsap(c.Target(0)),
            })),

        Yg.Summon(2, "pilgrim", "Pilgrim", F(Faction.Mortal, Faction.Hedron), str: 3, hp: 4,
            text: "At the start of your turn, put the top card of your deck under it as HP.",
            triggers: new Triggers
            {
                OnAwake = c => { if (c.Self is { } me) c.Reinforce(me, 1); },
            },
            powers: Powers(new Power
            {
                Name = "Aetus Spent",
                Cost = new Cost(S: 1, R: 1),
                Text = "Move 2 of this character's HP cards to an ally, then draw a card.",
                SapSelf = true,
                Targets = Specs(AllyOrLeader()),
                Effect = c =>
                {
                    if (c.Self is { } me) c.MoveHp(me, c.Target(0), 2);
                    c.Draw(c.Me, 1);
                },
            })),

        Yg.Summon(3, "hedronicgateway", "Hedronic Gateway", F(Faction.Hedron), str: 2, hp: 3,
            text: "Battlecry: Your other Hedrons gain +1/+1. Arrives sapped.",
            triggers: new Triggers
            {
                OnEnter = c =>
                {
                    foreach (var r in c.SummonsOf(c.Me, true))
                    {
                        var s = c.SummonAt(r);
                        if (s is null || ReferenceEquals(s, c.Source)) continue;
                        if (!Registry.Card(s.CardId).HasFaction(Faction.Hedron)) continue;
                        c.BuffStrength(r, 1, ModDuration.Permanent);
                        c.Reinforce(r, 1);
                    }
                    if (c.Self is { } me) c.Sap(me);
                },
            },
            powers: Powers(new Power
            {
                Name = "Open Gate",
                Cost = new Cost(S: 1, R: 1),
                Text = "Deal damage to a character equal to the number of Hedrons under your control.",
                SapSelf = true,
                Targets = Specs(AnyOrLeader("a character")),
                Effect = c => c.Damage(c.Target(0), c.CountFaction(c.Me, Faction.Hedron)),
            })),

        Yg.Spell("hedronshard", "Hedron Shard", new Cost(S: 1, R: 1),
            "Put the top 3 cards of your deck under an ally as HP.",
            Specs(AllyOrLeader()), c => c.Reinforce(c.Target(0), 3)),

        Yg.Stage("pragmistlaw", "Field: Pragmist Law", new Cost(S: 1, R: 1),
            "At the start of your turn, an ally gains 1 HP off your deck.",
            new StageHooks
            {
                OnAwake = c =>
                {
                    c.Choose("gain-hp-1", c.SummonsOf(c.Me, true), "Which ally gains 1 HP?");
                },
            }),

        // --- Solar and Oil -----------------------------------------------------
        Yp.Summon(2, "gardener", "The Gardener", F(Faction.Spirit), str: 1, hp: 4,
            text: "At the start of your turn, an ally heals 1.",
            triggers: new Triggers
            {
                OnAwake = c =>
                {
                    var refs = new List<TargetRef>();
                    foreach (var r in c.SummonsOf(c.Me, true))
                    {
                        var s = c.SummonAt(r);
                        if (s is not null && s.Hp.Any(h => h.Flipped)) refs.Add(r);
                    }
                    c.Choose("heal-1", refs.ToArray(), "Heal which ally for 1?");
                },
            },
            powers: Powers(new Power
            {
                Name = "Prune",
                Cost = new Cost(S: 1, O: 1),
                Text = "Put a Wound on an enemy summon and heal an ally for 1.",
                SapSelf = true,
                Targets = Specs(Enemy(), AllyOrLeader()),
                Effect = c =>
                {
                    c.Wound(c.Target(0), 1);
                    c.Unflip(c.Target(1), 1);
                },
            })),

        Yp.Summon(2, "molly", "Molly", F(Faction.Hedron), str: 2, hp: 4,
            powers: Powers(
            new Power
            {
                Name = "Eternal Rest",
                Cost = new Cost(O: 1, S: 1),
                Text = "Annihilate 10 cards from the enemy's discard pile.",
                Effect = c => c.AnnihilateDiscard(c.Opp, 10),
            },
            new Power
            {
                Name = "Rummage",
                Cost = new Cost(),
                Text = "Draw a random card from your discard pile.",
                SapSelf = true,
                Effect = c =>
                {
                    if (c.DrawRandomFromDiscard(c.Me) is null) c.Log("The pile is empty.");
                },
            },
            new Power
            {
                Name = "Interment",
                Cost = new Cost(O: 1),
                Text = "Pay off 2 debt.",
                SapSelf = true,
                Effect = c => c.ClearDebt(c.Me, 2),
            })),

        Yp.Summon(3, "m-xalbriss", "M-Xalbriss", F(Faction.Spirit, Faction.Star), str: 3, hp: 5,
            powers: Powers(new Power
            {
                Name = "Reckoning",
                Cost = new Cost(S: 1, O: 1),
                Text = "Move 1 of your debt onto your opponent.",
                SapSelf = true,
                Effect = c =>
                {
                    if (c.State.Players[c.Me].DebtCount == 0)
                    {
                        c.Log("Nothing owed, nothing to pass on.");
                        return;
                    }
                    c.ClearDebt(c.Me, 1);
                    c.AddDebt(c.Opp, 1, "The reckoning changes hands.");
                },
            })),

        Yp.Spell("crotalbell", "Crotal Bell", new Cost(S: 1, O: 1),
            "Put a Wound on every summon in play, then return a card from your discard pile to your hand.",
            Specs(new TargetSpec
            {
                Kind = TargetKind.Discard,
                Side = Side.Ally,
                Label = "a card in your discard pile",
                Optional = true,
            }), c =>
            {
                foreach (var r in c.SummonsOf(c.Me)) c.Wound(r, 1);
                foreach (var r in c.SummonsOf(c.Opp)) c.Wound(r, 1);
                if (c.Targets.Length > 0) c.Reclaim(c.Target(0));
            }),

        Yp.Spell("parthultfanatic", "Parthult Fanatic", new Cost(S: 1, O: 1),
            "Annihilate one of your summons, then draw 3 cards.",
            Specs(Ally("one of your summons")), c =>
            {
                c.Annihilate(c.Target(0));
                c.Draw(c.Me, 3);
            }),

        // --- Solar and Pepper --------------------------------------------------
        Yr.Summon(2, "scarletbloom", "Scarlet Bloom", F(Faction.Living), str: 2, hp: 3,
            text: "Deathrattle: Deal 2 to every enemy character.",
            triggers: new Triggers
            {
                OnDeath = c =>
                {
                    foreach (var r in c.SummonsOf(c.Opp)) c.Damage(r, 2);
                    c.Damage(TargetRef.Leader(c.Opp), 2);
                },
            },
            powers: Powers(new Power
            {
                Name = "Flare",
                Cost = new Cost(S: 1, P: 1),
                Text = "Deal 2 to an enemy summon.",
                SapSelf = true,
                Targets = Specs(Enemy()),
                Effect = c => c.Damage(c.Target(0), 2),
            })),

        Yr.Summon(3, "sasparsol", "Saspar-Sol", F(Faction.Star), str: 2, hp: 5,
            text: "At the start of your turn, an ally gains +1 attack.",
            triggers: new Triggers
            {
                OnAwake = c =>
                {
                    c.Choose("buff-1", c.SummonsOf(c.Me, true), "Which ally gains +1 attack?");
                },
            },
            powers: Powers(new Power
            {
                Name = "Lifesong",
                Cost = new Cost(P: 2, S: 1),
                Text = "Play a spell from your hand as a 2/1 summon, with twice its cost added as HP and its effect as a free Power.",
                Targets = Specs(HandCard("a spell in your hand", CardType.Spell)),
                Effect = c =>
                {
                    var r = c.Target(0);
                    if (r.Kind != TargetKind.Hand) return;
                    var slot = c.EmptySlot(c.Me);
                    if (slot is null)
                    {
                        c.Log("No open slot for the lifesong.");
                        return;
                    }
                    var id = c.TakeFromHand(c.Me, r.Index);
                    if (id is null) return;
                    // A 2/1 floor means a free spell still arrives as a body.
                    int hp = 1 + Registry.Card(id).Cost.Total * 2;
                    var genId = Generated.LivingSummon(id, 2, hp, 1, free: true);
                    c.State.Players[c.Me].Discard.Add(id);
                    c.PutSummon(c.Me, genId, slot.Value, 2, Color.S, hp, asPrinted: true);
                },
            })),

        Yr.Summon(2, "livingspell", "Living Spell", F(Faction.Living, Faction.Spirit),
            str: 0, hp: 5,
            text: "Scry 6 for a spell, if any are found, gain its Mana cost as attack, and gain its effect as a power, then discard the spell.",
            triggers: new Triggers
            {
                OnEnter = c =>
                {
                    if (c.Self is not { } me) return;
                    c.Dig(c.Me, 6, d => d.Type == CardType.Spell && d.Effect is not null,
                        effect: "living-spell", prompt: "Become a spell", at: me);
                },
            },
            powers: Powers(new Power
            {
                Name = "Charge",
                Cost = new Cost(P: 1, S: 1),
                Text = "Your next spell has +1 effect this turn.",
                Effect = c => c.GrantSpellBonus(1),
            })),

        Yr.Spell("burnsong", "Burnsong", new Cost(S: 1, P: 1),
            "Deal 3 to an enemy summon, then each of your characters gains +1 attack until end of turn.",
            Specs(Enemy()), c =>
            {
                c.Damage(c.Target(0), 3);
                foreach (var r in c.SummonsOf(c.Me, true)) c.BuffStrength(r, 1, ModDuration.Turn);
            }),

        Yr.Stage("sasparsparadise", "Field: Saspar's Paradise", new Cost(S: 1, P: 1),
            "Your Living allies have +1 attack.",
            new StageHooks
            {
                StrengthBonus = a => a.Summon.Owner == a.Controller
                    && a.Def.HasFaction(Faction.Living) ? 1 : 0,
            }),
        // --- Oil and Robot: corrosion, wounds and rust -------------------------
        Pg.Summon(3, "Slimewitch", "Slimewitch", F(Faction.Spirit, Faction.Machine), str: 3, hp: 4,
            cursePotency: true,
            text: "Rot and Dread in the enemy's deck have double effect.",
            powers: Powers(new Power
            {
                Name = "Corrupt",
                Cost = new Cost(O: 2),
                Text = "Shuffle 2 Rot into the enemy's deck.",
                SapSelf = true,
                Effect = c => c.Curse(c.Opp, "o-curse-rot", 2),
            }, new Power
            {
                Name = "Ferment",
                Cost = new Cost(O: 1, R: 1),
                Text = "Shuffle 1 Rot and 1 Dread into the enemy's deck.",
                SapSelf = true,
                Effect = c =>
                {
                    c.Curse(c.Opp, "o-curse-rot", 1);
                    c.Curse(c.Opp, "o-curse-dread", 1);
                },
            })),

        Pg.Summon(3, "Cybergore", "Cybergore", F(Faction.Machine, Faction.Spirit), str: 2, hp: 3,
            text: "Strike: The defender loses 2 attack.",
            triggers: new Triggers
            {
                OnAttack = c =>
                {
                    if (c.State.BattleDefender is { } d) c.BuffStrength(d, -2, ModDuration.Permanent);
                },
            },
            powers: Powers(new Power
            {
                Name = "Rend",
                Cost = new Cost(O: 1, R: 1),
                Text = "An enemy summon loses 2 attack and takes a Wound.",
                SapSelf = true,
                Targets = Specs(Enemy()),
                Effect = c =>
                {
                    c.BuffStrength(c.Target(0), -2, ModDuration.Permanent);
                    c.Wound(c.Target(0), 1);
                },
            })),

        Pg.Summon(2, "AncientVirus", "Ancient Virus", F(Faction.Machine, Faction.Spirit),
            str: 2, hp: 3,
            powers: Powers(new Power
            {
                Name = "Propagate",
                Cost = new Cost(O: 1, R: 1),
                Text = "Put a Wound on every enemy summon.",
                SapSelf = true,
                Effect = c =>
                {
                    foreach (var r in c.SummonsOf(c.Opp)) c.Wound(r, 1);
                },
            })),

        Pg.Spell("vilebrew", "Vile Brew", new Cost(O: 1, R: 1),
            "Put 3 Wounds on an enemy summon, then draw a card.",
            Specs(Enemy()), c =>
            {
                c.Wound(c.Target(0), 3);
                c.Draw(c.Me, 1);
            }),

        Pg.Stage("Doortonowhere", "Field: Door to Nowhere", new Cost(O: 1, R: 1),
            "All enemies have -1 attack.",
            new StageHooks
            {
                StrengthBonus = a => a.Summon.Owner == a.Controller ? 0 : -1,
            }),
    };
}
