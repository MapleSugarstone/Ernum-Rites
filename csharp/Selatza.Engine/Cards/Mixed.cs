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
    // Candy pairs with each of the other five. The frame is Candy on all of
    // them, so the folder letter leads with M and the kit reads K first.
    private static readonly DualKit Mb = new("MB", Color.K, Color.F);
    private static readonly DualKit Mg = new("MG", Color.K, Color.R);
    private static readonly DualKit Mp = new("MP", Color.K, Color.O);
    private static readonly DualKit Mr = new("MR", Color.K, Color.P);
    // Reversed frames on the same folders: the folder names the art, the kit
    // names the colours, so Loanshark prints Fish and Red Sweets prints Pepper.
    private static readonly DualKit Bm = new("MB", Color.F, Color.K);
    private static readonly DualKit Rm = new("MR", Color.P, Color.K);
    private static readonly DualKit My = new("MY", Color.K, Color.S);

    /// <summary>A character with something to heal, the only one worth pointing at.</summary>
    private static TargetSpec DamagedCharacter(string label) => new()
    {
        Kind = TargetKind.Summon,
        Side = Side.Any,
        IncludeLeader = true,
        Label = label,
        Filter = a => a.Summon is { } s && s.Hp.Exists(h => h.Flipped),
    };

    public static CardDef[] Build() => new[]
    {
        // The five-colour leader. Its art sits outside the Mixed tree and it
        // carries more colours than Color2 and Color3 hold, so it is spelled out
        // here rather than run through a pair kit. A leader whose identity is
        // every colour makes every card legal in its deck, which is the point:
        // the ritual has to be paid in all five. What it prints is Ernum, a
        // colour of its own, so facing it as a supporter pays Ernum mana and that
        // one covers a pip of any colour.
        new CardDef
        {
            Id = "m-ernum",
            Name = "Ernum",
            Color = Color.E,
            Identity = new[] { Color.P, Color.O, Color.R, Color.F, Color.S },
            Type = CardType.Summon,
            Level = 3,
            Strength = 1,
            Hp = 2,
            Factions = F(Faction.Ernum),
            Art = "Cardgame/Ernum/Ernum.png",
            Artist = "klabss",
            Num = "000",
            Text = "At the start of your turn, loses 1 HP.",
            Triggers = new Triggers
            {
                // Raw, so its own Effect Damage does not amplify the burn it pays.
                OnAwake = c =>
                {
                    if (c.Self is { } me) c.RawDamage(me, 1);
                },
            },
            Powers = Powers(new Power
            {
                Name = "Novelty Ritual",
                Cost = new Cost { P = 1, O = 1, R = 1, F = 1, S = 1, C = 1 },
                Text = "Gains 6 HP, +6 attack and Effect Damage +3, then heal 6 debt.",
                SapSelf = true,
                Effect = c =>
                {
                    if (c.Self is not { } me) return;
                    c.Reinforce(me, 6);
                    c.BuffStrength(me, 6, ModDuration.Permanent);
                    c.GrantEffectDamage(me, 3);
                    c.ClearDebt(c.Me, 6);
                },
            }, new Power
            {
                // The Candy pip is what folds the sixth colour into Ernum's
                // leader identity: DeckIdentity reads power costs, so this line
                // alone is what lets an Ernum deck run the Candy cards.
                Name = "Sentimental",
                Cost = new Cost(K: 1),
                Text = "Gain 1 Love.",
                SapSelf = true,
                Effect = c => c.GainLove(c.Me, 1),
            }),
        },

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
                Name = "Dark Vision",
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
            "Take control of an enemy summon with 2 or less HP left, and sap it.",
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
                Cost = new Cost(P: 1, F: 1, C: 1),
                Text = "Deal 2 to an enemy summon. If it dies, draw a card.",
                SapSelf = true,
                Targets = Specs(Enemy()),
                Effect = c =>
                {
                c.Damage(c.Target(0), 2);
                if (c.SummonAt(c.Target(0)) is null) c.Draw(c.Me, 1);
                },
            })),

        Rb.Summon(3, "xyliss", "Xyliss", F(Faction.Spirit, Faction.Scholar), str: 2, hp: 5,
            powers: Powers(new Power
            {
                Name = "Sordid Folk",
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
                c.Choose("sordid-fruit", c.DiscardSpells(c.Me), "Return which spell to hand?");
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
        Yg.Summon(2, "krazbot", "Krazbot", F(Faction.Machine, Faction.Living), str: 2, hp: 1,
            text: "Whenever you play a Machine or a Hedron, draw a card. Whenever an ally Machine or Hedron dies, take 1 debt and mill 1.",
            triggers: new Triggers
            {
                OnSummonPlayed = c =>
                {
                    var played = c.SummonAt(c.Target(0));
                    if (played is null || played.Owner != c.Me) return;
                    var def = Registry.Card(played.CardId);
                    if (def.HasFaction(Faction.Machine) || def.HasFaction(Faction.Hedron)) c.Draw(c.Me, 1);
                },
                // Krazbot's own death is not one of these: OnOtherDeath is the
                // only death a body does not see for itself.
                OnOtherDeath = c =>
                {
                    if (c.State.DyingOwner != c.Me) return;
                    if (c.State.DyingCardId is not { } dead) return;
                    var def = Registry.Card(dead);
                    if (!def.HasFaction(Faction.Machine) && !def.HasFaction(Faction.Hedron)) return;
                    c.AddDebt(c.Me, 1, "Krazbot logs the loss.");
                    c.Mill(c.Me, 1);
                },
            },
            powers: Powers(new Power
            {
                Name = "Pragmist Power",
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
                Name = "Parthult Aid",
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
                Name = "Anti-Abstraction",
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

        // --- Candy and Fish: the shop floor and the water ----------------------
        Mb.Summon(2, "CandyCraver", "Candy Craver", F(Faction.Mortal), str: 2, hp: 3,
            text: "Whenever you buy from a Store, draw a card.",
            triggers: new Triggers { OnStoreBought = c => c.Draw(c.Me, 1) },
            powers: Powers(new Power
            {
                Name = "Sweet Tooth",
                Cost = new Cost(K: 1, F: 1),
                Text = "Gain 1 Love, then draw a card.",
                SapSelf = true,
                Effect = c =>
                {
                    c.GainLove(c.Me, 1);
                    c.Draw(c.Me, 1);
                },
            })),

        Mb.Summon(2, "CandyFish", "Candy Fish", F(Faction.Saccharine, Faction.Fish),
            str: 2, hp: 4,
            powers: Powers(new Power
            {
                Name = "Bubblegum Stream",
                Cost = new Cost(K: 1, F: 1),
                Text = "Scry 3 for a Fish or a Saccharine.",
                SapSelf = true,
                Effect = c => c.Dig(c.Me, 3,
                    d => d.HasFaction(Faction.Fish) || d.HasFaction(Faction.Saccharine)),
            }),
            flipText: "Gain 1 Love.",
            flip: c => c.GainLove(c.Me, 1)),

        Bm.Summon(3, "loanshark", "Loanshark", F(Faction.Fish, Faction.Beast), str: 3, hp: 5,
            debtAmplify: true,
            text: "Whenever a player takes debt, they take 1 more.",
            powers: Powers(new Power
            {
                Name = "Collect",
                Cost = new Cost(K: 1, F: 1),
                Text = "Deal 1 debt.",
                SapSelf = true,
                Effect = c => c.AddDebt(c.Opp, 1, "The loanshark collects."),
            })),

        Mb.Spell("IcecubeCandy", "Icecube Candy", new Cost(K: 1, F: 1),
            "Shuffle 8 cards from your discard pile into your deck. Draw a card.",
            null, c =>
            {
                c.RecycleDiscard(c.Me, 8);
                c.Draw(c.Me, 1);
            }),

        Mb.Spell("TropicalBlueDrink", "Tropical Blue Drink", new Cost(K: 1, F: 1),
            "Heal an ally for 3. Love: Heal 1 more.",
            Specs(AllyOrLeader()), c =>
            {
                int n = c.SpendLove(c.Me);
                c.Unflip(c.Target(0), 3 + n);
            }),

        // --- Candy and Robot: the graduate scheme ------------------------------
        Mg.Summon(2, "CuriousPilgrim", "Curious Pilgrim", F(Faction.Mortal, Faction.Hedron),
            str: 2, hp: 4,
            text: "Store: Scry 2 for any card.",
            store: new StoreDef
            {
                Useful = (state, user) => state.Players[user].Deck.Count > 0,
                Effect = c => c.Dig(c.Me, 2, _ => true),
            },
            powers: Powers(new Power
            {
                Name = "Wander",
                Cost = new Cost(K: 1, R: 1),
                Text = "Draw a card, then heal 1 debt.",
                SapSelf = true,
                Effect = c =>
                {
                    c.Draw(c.Me, 1);
                    c.ClearDebt(c.Me, 1);
                },
            })),

        Mg.Summon(2, "NewGrad", "New Grad", F(Faction.Mortal, Faction.Scholar), str: 2, hp: 3,
            text: "Store: Draw the top card of another player's deck, rebuilt in Robot with its cost turned colorless.",
            store: new StoreDef
            {
                // The deck is named by its owner's leader, the way Loan names a player.
                Targets = Specs(new TargetSpec
                {
                    Kind = TargetKind.Summon,
                    Side = Side.Enemy,
                    IncludeLeader = true,
                    Label = "a player, by their leader",
                    Filter = a => a.Ref.Kind == TargetKind.Leader,
                }),
                Useful = (state, user) => state.Players[GameState.Other(user)].Deck.Count > 0,
                Effect = c =>
                {
                    if (c.TargetOrNull(0) is not { Kind: TargetKind.Leader } t) return;
                    var deck = c.State.Players[t.Player].Deck;
                    if (deck.Count == 0)
                    {
                        c.Log("That deck is empty.");
                        return;
                    }
                    var id = deck[0];
                    deck.RemoveAt(0);
                    c.ToHand(c.Me, Generated.RobotColorlessCopy(id));
                },
            },
            powers: Powers(new Power
            {
                Name = "Job Application Fees",
                Cost = new Cost(K: 1, R: 1),
                Text = "Draw 2 cards, then take 1 debt.",
                SapSelf = true,
                Effect = c =>
                {
                    c.Draw(c.Me, 2);
                    c.AddDebt(c.Me, 1, "The hours are billed back.");
                },
            })),

        Mg.Spell("AbsurdlySourCandy", "Absurdly Sour Candy", new Cost(K: 1, R: 1),
            "Deal 2 to an enemy summon and it loses 2 attack.",
            Specs(Enemy()), c =>
            {
                c.Damage(c.Target(0), 2);
                c.BuffStrength(c.Target(0), -2, ModDuration.Permanent);
            }),

        Mg.Spell("CandyVirus", "Candy Virus", new Cost(K: 1, R: 1),
            "Deal 2 to an enemy summon. If it dies, gain 2 Love.",
            Specs(Enemy()), c =>
            {
                c.Damage(c.Target(0), 2);
                if (c.SummonAt(c.Target(0)) is null) c.GainLove(c.Me, 2);
            }),

        Mg.Spell("HedronFragments", "Hedron Fragments", new Cost(K: 1, R: 1),
            "Each of your summons gains 1 HP off your deck. Affected summons are permanently Hedrons.",
            null, c =>
            {
                foreach (var r in c.SummonsOf(c.Me))
                {
                    c.Reinforce(r, 1);
                    var s = c.SummonAt(r);
                    if (s is null || Registry.Card(s.CardId).HasFaction(Faction.Hedron)) continue;
                    c.Transform(r, Generated.HedronCopy(s.CardId));
                }
            }),

        // --- Candy and Oil: the toll and the bones -----------------------------
        Mp.Summon(3, "LenAphelion", "Len-Aphelion", F(Faction.Spirit, Faction.Scholar),
            str: 2, hp: 5,
            text: "Your Beasts have +1 attack. At the start of your turn, Scry 2 for any card.",
            triggers: new Triggers
            {
                StrengthBonus = a => a.Summon.Owner == a.Controller
                    && a.Def.HasFaction(Faction.Beast) ? 1 : 0,
                OnAwake = c => c.Dig(c.Me, 2, _ => true),
            },
            powers: Powers(new Power
            {
                Name = "Umbral Slash",
                Cost = new Cost(K: 1, O: 1),
                Text = "Deal 1 to every enemy summon, and gain 1 Love for each that dies.",
                SapSelf = true,
                Effect = c =>
                {
                    var refs = c.SummonsOf(c.Opp);
                    foreach (var r in refs) c.Damage(r, 1);
                    int dead = 0;
                    foreach (var r in refs)
                    {
                        if (c.SummonAt(r) is null) dead++;
                    }
                    if (dead > 0) c.GainLove(c.Me, dead);
                },
            })),

        Mp.Summon(2, "PairOfCritters", "Pair of Critters", F(Faction.Saccharine, Faction.Beast),
            str: 2, hp: 3,
            text: "Battlecry: Gain 1 Love. Deathrattle: Gain 1 Love.",
            triggers: new Triggers
            {
                OnEnter = c => c.GainLove(c.Me, 1),
                OnDeath = c => c.GainLove(c.Me, 1),
            },
            powers: Powers(new Power
            {
                Name = "Nibble",
                Cost = new Cost(K: 1, O: 1),
                Text = "Put a Wound on every enemy summon.",
                SapSelf = true,
                Effect = c =>
                {
                    foreach (var r in c.SummonsOf(c.Opp)) c.Wound(r, 1);
                },
            })),

        Mp.Spell("MarkOfTheFalseKing", "Mark of the False King", new Cost(K: 1, O: 1),
            "An enemy summon loses 2 attack. Its controller takes 1 debt.",
            Specs(Enemy()), c =>
            {
                var t = c.Target(0);
                c.BuffStrength(t, -2, ModDuration.Permanent);
                if (t.Kind == TargetKind.Summon)
                {
                    c.AddDebt(t.Player, 1, "The false king marks his own.");
                }
            }),

        Mp.Spell("RottenCandy", "Rotten Candy", new Cost(K: 1, O: 1),
            "Shuffle 3 Rot into the enemy's deck. Gain 1 Love.",
            null, c =>
            {
                c.Curse(c.Opp, "o-curse-rot", 3);
                c.GainLove(c.Me, 1);
            }),

        Mp.Spell("SoldBones", "Sold Bones", new Cost(K: 1, O: 1),
            "Return a summon from your discard pile to your hand. Gain 1 Love.",
            Specs(new TargetSpec
            {
                Kind = TargetKind.Discard,
                Side = Side.Ally,
                Label = "a summon in your discard pile",
                Optional = true,
                Filter = a => a.Card?.Type == CardType.Summon,
            }), c =>
            {
                if (c.TargetOrNull(0) is { } t) c.Reclaim(t);
                c.GainLove(c.Me, 1);
            }),

        // --- Candy and Pepper: the stall that sells heat ------------------------
        Mr.Summon(2, "CandyAxeman", "Candy Axeman", F(Faction.Saccharine, Faction.Mortal),
            str: 3, hp: 3,
            text: "Strike: Gain 1 Love.",
            triggers: new Triggers { OnAttack = c => c.GainLove(c.Me, 1) },
            powers: Powers(new Power
            {
                Name = "Chop",
                Cost = new Cost(K: 1, P: 1),
                Text = "Deal 2 to an enemy summon.",
                SapSelf = true,
                Targets = Specs(Enemy()),
                Effect = c => c.Damage(c.Target(0), 2),
            })),

        Rm.Summon(3, "RedSweets", "Red Sweets", F(Faction.Mortal, Faction.Scholar), str: 3, hp: 4,
            text: "Store: Take any card from your deck into your hand. Store costs +8. Leader: Store costs 5 less.",
            store: new StoreDef
            {
                Surcharge = 8,
                LeaderDiscount = 5,
                Useful = (state, user) => state.Players[user].Deck.Count > 0,
                Effect = c => c.Search(c.Me, _ => true),
            },
            powers: Powers(new Power
            {
                Name = "Pummel",
                Cost = new Cost(K: 1, P: 1),
                Text = "Deal 1 to a character and gain 1 Love.",
                SapSelf = true,
                Targets = Specs(AnyOrLeader("a character")),
                Effect = c =>
                {
                    c.Damage(c.Target(0), 1);
                    c.GainLove(c.Me, 1);
                },
            })),

        Mr.Spell("AbsurdlySpicyCandy", "Absurdly Spicy Candy", new Cost(K: 2, P: 2),
            "Deal 1 to a character. Love: Effect Damage +1.",
            Specs(AnyOrLeader("a character")), c =>
            {
                int n = c.SpendLove(c.Me);
                c.Damage(c.Target(0), 1 + n);
            }),

        Mr.Spell("DeflateCurrency", "Deflate Currency", new Cost(K: 1, P: 1),
            "Deal 2 debt, then gain 1 Love.",
            null, c =>
            {
                c.AddDebt(c.Opp, 2);
                c.GainLove(c.Me, 1);
            }),

        Mr.Spell("RedTape", "Red Tape", new Cost(K: 1, P: 1),
            "Sap an enemy summon. It does not unsap the next time it would.",
            Specs(Enemy()), c =>
            {
                c.Sap(c.Target(0));
                if (c.SummonAt(c.Target(0)) is { } s) s.SapLock = true;
            }),

        // --- Candy and Solar: the lemonade stand --------------------------------
        My.Summon(2, "LittleGummyBear", "Little Gummy Bear",
            F(Faction.Saccharine, Faction.Beast), str: 2, hp: 4,
            text: "Battlecry: Gain 1 Love.",
            triggers: new Triggers { OnEnter = c => c.GainLove(c.Me, 1) },
            powers: Powers(new Power
            {
                Name = "Squish",
                Cost = new Cost(K: 1, S: 1),
                Text = "Heal a character for 3.",
                SapSelf = true,
                Targets = Specs(DamagedCharacter("a character to heal")),
                Effect = c => { if (c.TargetOrNull(0) is { } t) c.Unflip(t, 3); },
            }),
            flipText: "Gain 1 Love.",
            flip: c => c.GainLove(c.Me, 1)),

        My.Summon(3, "PinkLemonader", "Pink Lemonader", F(Faction.Beast), str: 3, hp: 4,
            text: "Store: Each of your summons heals 4.",
            store: new StoreDef
            {
                Useful = (state, user) =>
                {
                    foreach (var s in state.Players[user].Slots)
                    {
                        if (s is not null && s.Hp.Exists(h => h.Flipped)) return true;
                    }
                    return false;
                },
                Effect = c => { foreach (var r in c.SummonsOf(c.Me)) c.Unflip(r, 4); },
            },
            powers: Powers(new Power
            {
                Name = "Fresh Squeeze",
                Cost = new Cost(K: 1, S: 1),
                Text = "Heal your leader for 2 and gain 1 Love.",
                SapSelf = true,
                Effect = c =>
                {
                    c.Unflip(TargetRef.Leader(c.Me), 2);
                    c.GainLove(c.Me, 1);
                },
            })),

        My.Spell("CandySun", "Candy Sun", new Cost(K: 1, S: 1),
            "Each of your characters heals 2, then gain 2 Love.",
            null, c =>
            {
                foreach (var r in c.SummonsOf(c.Me, true)) c.Unflip(r, 2);
                c.GainLove(c.Me, 2);
            }),

        My.Spell("MoltenCandyBolt", "Molten Candy Bolt", new Cost(K: 1, S: 1),
            "Deal 3 to a summon, then heal an ally for 2.",
            Specs(Any(), AllyOrLeader()), c =>
            {
                c.Damage(c.Target(0), 3);
                c.Unflip(c.Target(1), 2);
            }),

        My.Spell("SourSoda", "Sour Soda", new Cost(K: 1, S: 1),
            "Unsap an ally summon, then heal it for 3.",
            Specs(new TargetSpec
            {
                Kind = TargetKind.Summon,
                Side = Side.Ally,
                Label = "a sapped ally summon",
                Filter = a => a.Summon is not null && a.Summon.Sapped,
            }), c =>
            {
                c.Unsap(c.Target(0));
                c.Unflip(c.Target(0), 3);
            }),
    };
}
