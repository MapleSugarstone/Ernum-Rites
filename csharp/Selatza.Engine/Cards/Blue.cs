using static Selatza.Cards.Kit;

namespace Selatza.Cards;

/// <summary>Blue is Fish: control, recursion out of debt, and moving HP around.</summary>
public static class Blue
{
    private static readonly ColorKit K = new(Color.F, "f", "Blue", "Blue/Spells");

    public static CardDef[] Build() => new[]
    {
        K.Starter("thefish", "The Fish", F(Faction.Fish, Faction.Star), str: 1, hp: 4,
            text: "",
            powers: Powers(new Power
            {
                Name = "Perfect System",
                Cost = new Cost(),
                Text = "Scry 3 for a Fish.",
                SapSelf = true,
                Effect = c =>
                {
                    c.Dig(c.Me, 3, d => d.HasFaction(Faction.Fish));
                },
            }, new Power
            {
                Name = "Archon of Life",
                Cost = new Cost(F: 2, C: 1),
                Text = "Return a summon from your debt to your hand.",
                SapSelf = true,
                Targets = Specs(new TargetSpec
                {
                    Kind = TargetKind.Debt,
                    Side = Side.Ally,
                    Label = "a summon in your debt",
                    Filter = a => a.Card is { } d && d.Type == CardType.Summon,
                }),
                Effect = c =>
                {
                    var r = c.Target(0);
                    if (r.Kind != TargetKind.Debt) return;
                    var id = c.State.Players[c.Me].DebtZone[r.Index];
                    Effects.RemoveFromDebt(c.State, c.Me, r.Index);
                    c.ToHand(c.Me, id);
                },
            })),

        // --- level 1 ---------------------------------------------------------
        K.Summon(1, "basicfish", "Minnowling", F(Faction.Fish),
            text: "Battlecry: Mill the enemy 1.",
            triggers: new Triggers { OnEnter = c => c.Mill(c.Opp, 1) }, str: 1, hp: 2,
            flipText: "Catch a spent HP card off the attached character.",
            flip: c => c.Catch(c.HolderRef, 1)),

        K.Summon(1, "lilfish", "Lilfish", F(Faction.Fish),
            str: 1,
            hp: 2,
            text: "Battlecry: Draw a card.",
            triggers: new Triggers
            {
                OnEnter = c => c.Draw(c.Me, 1),
            },
            flipText: "Catch a spent HP card off the attached character.",
            flip: c => c.Catch(c.HolderRef, 1)),

        K.Summon(1, "longfish", "Longfish", F(Faction.Fish), str: 3, hp: 2,
            text: "",
            flipText: "Catch a spent HP card off the attached character.",
            flip: c => c.Catch(c.HolderRef, 1)),

        K.Summon(1, "octopi", "Octopi", F(Faction.Fish), str: 1, hp: 3,
            powers: Powers(new Power
            {
                Name = "Eight Hands",
                Cost = new Cost(F: 1),
                Text = "Unsap an ally summon.",
                Targets = Specs(Ally()),
                Effect = c => c.Unsap(c.Target(0)),
            }),
            flipText: "Catch a spent HP card off the attached character.",
            flip: c => c.Catch(c.HolderRef, 1)),

        K.Summon(1, "seabunny", "Sea Bunny", F(Faction.Fish, Faction.Beast), str: 1, hp: 2,
            flipText: "Bring a summon back from your debt to your hand.",
            flipCost: new FlipCost { Mana = new Cost(F: 1) },
            flipUseful: c => c.DebtSummons(c.Me).Length > 0
                && c.State.Players[c.Me].Hand.Count < Rules.HandLimit,
            flip: c =>
            {
                c.Choose("debt-summon-to-hand", c.DebtSummons(c.Me), "Bring back which summon?");
            }),

        K.Summon(1, "seahorse", "Seahorse", F(Faction.Fish, Faction.Beast), str: 2, hp: 3,
            text: "Battlecry: Move an HP card from your leader onto it.",
            triggers: new Triggers
            {
                OnEnter = c =>
                {
                    if (c.Self is { } me) c.MoveHp(TargetRef.Leader(c.Me), me, 1);
                },
            },
            flipText: "Catch a spent HP card off the attached character.",
            flip: c => c.Catch(c.HolderRef, 1)),

        K.Summon(1, "seasnake", "Sea Snake", F(Faction.Fish, Faction.Beast),
            str: 1,
            hp: 3,
            text: "When attacked, draw a card.",
            triggers: new Triggers
            {
                OnDefend = c => c.Draw(c.Me, 1),
            }),

        K.Summon(1, "swordfish", "Swordfish", F(Faction.Fish),
            flipText: "The attached character gains +2 attack.",
            flip: c => c.BuffStrength(c.HolderRef, 2, ModDuration.Permanent), str: 2, hp: 2,
            text: ""),

        K.Summon(1, "urchin", "Urchin", F(Faction.Fish), str: 1, hp: 4,
            text: "When attacked, deal 2 to the attacker.",
            triggers: new Triggers
            {
                OnDefend = c => { if (c.State.BattleAttacker is { } a) c.Damage(a, 2); },
            },
            flipText: "Catch a spent HP card off the attached character.",
            flip: c => c.Catch(c.HolderRef, 1)),

        K.Summon(1, "whaleshark", "Whale Shark", F(Faction.Fish, Faction.Beast), str: 1, hp: 4,
            text: "Battlecry: Shuffle 3 random cards from your discard pile into your deck.",
            triggers: new Triggers { OnEnter = c => c.RecycleDiscard(c.Me, 3) }),

        // --- level 2 ---------------------------------------------------------
        K.Summon(2, "coralhead", "Coralhead", F(Faction.Fish), str: 1, hp: 5,
            text: "Ally Fish have +1 attack. At the start of your turn, Mill 2.",
            triggers: new Triggers
            {
                StrengthBonus = a => a.Summon.Owner == a.Controller
                    && a.Def.HasFaction(Faction.Fish)
                    && a.Summon.CardId != "f2-coralhead" ? 1 : 0,
                OnAwake = c => c.Mill(c.Me, 2),
            }),

        K.Summon(2, "fishamalgam", "Fish Amalgam", F(Faction.Fish), str: 3, hp: 2,
            text: "Battlecry: Pull HP cards off your other summons onto it.",
            triggers: new Triggers
            {
                OnEnter = c =>
                {
                    if (c.Self is not { } me) return;
                    foreach (var r in c.SummonsOf(c.Me, true))
                    {
                        if (r.Equals(me)) continue;
                        c.MoveHp(r, me, 1);
                    }
                },
            },
            powers: Powers(new Power
            {
                Name = "Engulf",
                Cost = new Cost(F: 1),
                Text = "Move an HP card from an ally onto this.",
                SapSelf = true,
                Targets = Specs(AllyOrLeader("take an HP card from")),
                Effect = c => { if (c.Self is { } me) c.MoveHp(c.Target(0), me, 1); },
            })),

        K.Summon(2, "fishfolk", "Fishfolk", F(Faction.Fish, Faction.Mortal),
            str: 2,
            hp: 3,
            powers: Powers(new Power
            {
                Name = "Shoal",
                Cost = new Cost(F: 1),
                Text = "Draw a card if you control 3 or more Fish.",
                SapSelf = true,
                Effect = c =>
                {
                    if (c.CountFaction(c.Me, Faction.Fish) >= 3) c.Draw(c.Me, 1);
                    else c.Log("The shoal is too thin.");
                },
            })),

        K.Summon(2, "fishwizard", "Fish Wizard", F(Faction.Fish, Faction.Scholar), str: 1,
            hp: 3,
            powers: Powers(new Power
            {
                Name = "Magic Fishiles",
                Cost = new Cost(F: 1),
                Text = "Draw and discard 3 cards. For each Fish drawn, deal 1 to an enemy summon.",
                SapSelf = true,
                Targets = Specs(new TargetSpec
                {
                    Kind = TargetKind.Summon,
                    Side = Side.Enemy,
                    Label = "an enemy summon to shell",
                    Optional = true,
                }),
                Effect = c =>
                {
                    var hand = c.State.Players[c.Me].Hand;
                    int before = hand.Count;
                    c.Draw(c.Me, 3);
                    int fish = 0;
                    for (int i = hand.Count - 1; i >= before; i--)
                    {
                        if (Registry.Card(hand[i]).HasFaction(Faction.Fish)) fish++;
                        c.Discard(c.Me, i);
                    }
                    if (fish > 0 && c.TargetOrNull(0) is { } t) c.Damage(t, fish);
                },
            },
            new Power
            {
                Name = "Turn the Tide",
                Cost = new Cost(F: 1),
                Text = "Shuffle 3 random cards from your discard pile into your deck.",
                Effect = c => c.RecycleDiscard(c.Me, 3),
            })),

        K.Summon(2, "jellyking", "Jelly King", F(Faction.Fish), str: 2, hp: 5,
            text: "At the start of your turn, Catch 1 spent HP card off an ally.",
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
                    c.Choose("catch-1", refs.ToArray(), "Catch a spent HP card off which ally?");
                },
            }),

        K.Summon(2, "lighthousekeeper", "Lighthouse Keeper", F(Faction.Mortal), str: 1, hp: 5,
            stationary: true,
            text: "Stationary. When attacked, the enemy Mills 2.",
            triggers: new Triggers
            {
                OnDefend = c => c.Mill(c.Opp, 2),
            },
            powers: Powers(new Power
            {
                Name = "Beacon",
                Cost = new Cost(),
                Text = "Scry 4 for a Fish.",
                SapSelf = true,
                Effect = c =>
                {
                    c.Dig(c.Me, 4, d => d.HasFaction(Faction.Fish));
                },
            })),

        K.Summon(2, "riverfolk", "Riverfolk", F(Faction.Fish, Faction.Mortal),
            str: 2,
            hp: 3,
            text: "Deathrattle: Draw 2 cards.",
            triggers: new Triggers { OnDeath = c => c.Draw(c.Me, 2) },
            powers: Powers(new Power
            {
                Name = "Ferry",
                Cost = new Cost(F: 1),
                Text = "Catch a spent HP card off an ally.",
                SapSelf = true,
                Targets = Specs(AllyOrLeader("catch a spent HP card off")),
                Effect = c => c.Catch(c.Target(0), 1),
            }),
            flipText: "Catch 2 spent HP cards off any ally.",
            flipCost: new FlipCost { Mana = new Cost(F: 2) },
            flip: c => c.Catch(c.HolderRef, 2)),

        K.Summon(2, "scubadoba", "Scubadoba", F(Faction.Mortal),
            str: 2,
            hp: 3,
            powers: Powers(new Power
            {
                Name = "Surface",
                Cost = new Cost(F: 1),
                Text = "Return the top card of your discard pile to your hand.",
                SapSelf = true,
                Effect = c =>
                {
                    var got = c.ReviveFromDiscard(c.Me);
                    c.Log(got is null ? "Nothing down there." : $"{got.Name} surfaces.");
                },
            })),

        K.Summon(2, "submariner", "Submariner", F(Faction.Mortal, Faction.Machine),
            str: 2,
            hp: 3,
            text: "Battlecry: The enemy Mills 2.",
            triggers: new Triggers
            {
                OnEnter = c => c.Mill(c.Opp, 2),
            },
            powers: Powers(new Power
            {
                Name = "Dive",
                Cost = new Cost(F: 1),
                Text = "The enemy Mills 2. Draw a card if their deck is under 8.",
                SapSelf = true,
                Effect = c =>
                {
                    c.Mill(c.Opp, 2);
                    if (c.State.Players[c.Opp].Deck.Count < 8) c.Draw(c.Me, 1);
                },
            }),
            flipText: "Bring a summon back from your debt to your hand.",
            flipCost: new FlipCost { Mana = new Cost(F: 1) },
            flipUseful: c => c.DebtSummons(c.Me).Length > 0
                && c.State.Players[c.Me].Hand.Count < Rules.HandLimit,
            flip: c =>
            {
                c.Choose("debt-summon-to-hand", c.DebtSummons(c.Me), "Bring back which summon?");
            }),

        K.Summon(2, "undersearesearcher", "Undersea Researcher",
            F(Faction.Mortal, Faction.Scholar), str: 1, hp: 3,
            powers: Powers(new Power
            {
                Name = "Survey",
                Cost = new Cost(F: 1),
                Text = "Scry 3 for a spell.",
                SapSelf = true,
                Effect = c =>
                {
                    c.Dig(c.Me, 3, d => d.Type == CardType.Spell);
                },
            })),

        // --- level 3 ---------------------------------------------------------
        K.Summon(3, "abyssalwalker", "Abyssal Walker", F(Faction.Fish, Faction.Spirit),
            str: 3, hp: 4,
            text: "Strike: Deal 1 to the defender first, and you take 1 debt.",
            triggers: new Triggers
            {
                OnAttack = c =>
                {
                    if (c.State.BattleDefender is { } d) c.Damage(d, 1);
                    c.AddDebt(c.Me, 1, "The walker drags the deep up with it.");
                },
            }),

        K.Summon(3, "crabcity", "Crab City", F(Faction.Fish), str: 1, hp: 9,
            stationary: true, redirect: true,
            text: "Redirection. Stationary. At the start of your turn, the enemy Mills 2.",
            triggers: new Triggers
            {
                OnAwake = c => c.Mill(c.Opp, 2),
            }),

        K.Summon(3, "darkness", "The Darkness", F(Faction.Spirit), str: 2, hp: 6,
            text: "Battlecry: The enemy shuffles their hand into their deck, then draws that many cards minus 1.",
            triggers: new Triggers
            {
                OnEnter = c =>
                {
                    int held = c.ShuffleHandIntoDeck(c.Opp);
                    if (held > 1) c.Draw(c.Opp, held - 1);
                },
            }),

        K.Summon(3, "deepseaheart", "Deep Sea Heart", F(Faction.Fish), str: 2, hp: 6,
            powers: Powers(new Power
            {
                Name = "Dredge Up",
                Cost = new Cost(F: 3),
                Text = "Move a summon from your debt zone under an ally as face-down HP.",
                Targets = Specs(MyDebt(), AllyOrLeader()),
                Effect = c =>
                {
                    var d = c.Target(0);
                    if (d.Kind != TargetKind.Debt) return;
                    c.DebtToHp(c.Target(1), d.Index);
                },
            })),

        K.Summon(3, "eternalalbatross", "Eternal Albatross", F(Faction.Beast, Faction.Star),
            str: 2, hp: 4,
            text: "Deathrattle: Return a summon from your debt to your hand. You take 2 debt.",
            triggers: new Triggers
            {
                OnDeath = c =>
                {
                    c.Choose("debt-summon-to-hand", c.DebtSummons(c.Me),
                        "Return which summon to hand?");
                    c.AddDebt(c.Me, 2, "The albatross is not free.");
                },
            }),

        K.Summon(3, "infiniteship", "The Infinite Ship", F(Faction.Machine, Faction.Star),
            str: 2, hp: 5,
            text: "At the start of your turn, gains 1 HP and the enemy Mills 1.",
            triggers: new Triggers
            {
                OnAwake = c =>
                {
                    if (c.Self is { } me) c.Reinforce(me, 1);
                    c.Mill(c.Opp, 1);
                },
            },
            powers: Powers(new Power
            {
                Name = "Set Sail",
                Cost = new Cost(F: 2),
                Text = "Shuffle 3 random cards from your discard pile into your deck, then draw 3.",
                SapSelf = true,
                Effect = c =>
                {
                    c.RecycleDiscard(c.Me, 3);
                    c.Draw(c.Me, 3);
                },
            })),

        K.Summon(3, "riverdrinker", "River Drinker", F(Faction.Fish, Faction.Spirit),
            str: 1, hp: 5,
            powers: Powers(new Power
            {
                Name = "Drink Deep",
                Cost = new Cost(F: 3),
                Text = "The enemy Mills 4.",
                SapSelf = true,
                Effect = c => c.Mill(c.Opp, 4),
            })),

        K.Summon(3, "serpant", "The Serpent", F(Faction.Fish, Faction.Beast), str: 2, hp: 5,
            text: "Has +1 attack for every 6 cards in the enemy's discard pile.",
            triggers: new Triggers
            {
                StrengthBonus = a => a.Source is not null && a.Summon.Uid == a.Source.Uid
                    ? a.State.Players[GameState.Other(a.Controller)].Discard.Count / 6
                    : 0,
            },
            powers: Powers(new Power
            {
                Name = "Devour",
                Cost = new Cost(F: 2),
                Text = "The enemy Mills cards equal to this character's attack.",
                SapSelf = true,
                Effect = c =>
                {
                    var self = c.Self is { } me ? c.SummonAt(me) : null;
                    if (self is not null) c.Mill(c.Opp, Effects.EffectiveStrength(c.State, self));
                },
            })),

        K.Summon(3, "sharkmeat", "Sharkmeat", F(Faction.Fish), str: 2, hp: 2,
            text: "When an ally Fish dies, gains +1 attack.",
            triggers: new Triggers
            {
                OnOtherDeath = c =>
                {
                    if (c.State.DyingOwner != c.Me) return;
                    if (c.State.DyingCardId is not { } dead) return;
                    if (!Registry.Card(dead).HasFaction(Faction.Fish)) return;
                    if (c.Self is { } me) c.BuffStrength(me, 1, ModDuration.Permanent);
                },
            },
            powers: Powers(new Power
            {
                Name = "Feeding Frenzy",
                Cost = new Cost(F: 2),
                Text = "Destroy the enemy summon with the least attack.",
                SapSelf = true,
                Effect = c =>
                {
                    TargetRef? prey = null;
                    int least = int.MaxValue;
                    foreach (var r in c.SummonsOf(c.Opp))
                    {
                        var s = c.SummonAt(r);
                        if (s is null) continue;
                        int str2 = Effects.EffectiveStrength(c.State, s);
                        if (str2 < least)
                        {
                            least = str2;
                            prey = r;
                        }
                    }
                    if (prey is { } target) c.Destroy(target);
                    else c.Log("Nothing in the water.");
                },
            })),

        // --- spells, traps and stages ----------------------------------------
        K.Spell("riptide", "Riptide", new Cost(F: 2),
            "Sap every enemy summon. They do not unsap the next time they would. Heal your leader for 2.",
            null, c =>
            {
                foreach (var r in c.SummonsOf(c.Opp))
                {
                    c.Sap(r);
                    var s = c.SummonAt(r);
                    if (s is not null) s.SapLock = true;
                }
                c.Unflip(TargetRef.Leader(c.Me), 2);
            }),

        K.Spell("catch", "Baited", new Cost(F: 1, C: 1),
            "Destroy a sapped summon.",
            Specs(new TargetSpec
            {
                Kind = TargetKind.Summon,
                Side = Side.Any,
                Label = "a sapped summon",
                Filter = a => a.Summon is not null && a.Summon.Sapped,
            }),
            c => c.Destroy(c.Target(0))),

        K.Spell("chumbucket", "Chum Bucket", new Cost(F: 1, C: 1),
            "The enemy Mills 2, then draw a card.",
            null, c =>
            {
                c.Mill(c.Opp, 2);
                c.Draw(c.Me, 1);
            },
            flipText: "Catch a spent HP card off the attached character.",
            flip: c => c.Catch(c.HolderRef, 1)),

        K.Spell("error", "Error", new Cost(F: 1, C: 1), "The enemy Mills 4.",
            null, c => c.Mill(c.Opp, 4)),

        K.Spell("fishgoop", "Fish Goop", new Cost(),
            "Move 2 HP cards from an enemy summon onto the enemy leader.",
            Specs(Enemy()), c => c.MoveHp(c.Target(0), TargetRef.Leader(c.Opp), 2)),

        K.Spell("fishify", "Fishify", new Cost(F: 1, C: 1),
            "Turn a summon into a Minnowling, keeping its HP cards.",
            Specs(Any()), c => c.Transform(c.Target(0), "f1-basicfish"),
            flipText: "Bring a summon back from your debt to your hand.",
            flipCost: new FlipCost { Mana = new Cost(F: 1) },
            flipUseful: c => c.DebtSummons(c.Me).Length > 0
                && c.State.Players[c.Me].Hand.Count < Rules.HandLimit,
            flip: c =>
            {
                c.Choose("debt-summon-to-hand", c.DebtSummons(c.Me), "Bring back which summon?");
            }),

        K.Spell("puddlewarp", "Puddle Warp", new Cost(F: 1),
            "Shuffle an ally summon into your deck, then Scry 5 for a summon.",
            Specs(Ally()), c =>
            {
                c.ShuffleIntoDeck(c.Target(0));
                c.Dig(c.Me, 5, d => d.Type == CardType.Summon,
                    effect: "scry", prompt: "Take which summon?");
            }),

        K.Spell("snacklebox", "Snacklebox", new Cost(),
            "Put the top 2 cards of your discard pile under an ally as face-down HP.",
            Specs(AllyOrLeader()), c =>
            {
                var s = c.SummonAt(c.Target(0));
                var pile = c.State.Players[c.Me].Discard;
                if (s is null) return;
                int fed = 0;
                for (int i = 0; i < 2 && pile.Count > 0; i++)
                {
                    var id = pile[pile.Count - 1];
                    pile.RemoveAt(pile.Count - 1);
                    s.Hp.Add(new HpCard { CardId = id, Flipped = false });
                    fed++;
                }
                c.Log(fed > 0 ? $"{fed} snack(s) tucked in as HP." : "The box is empty.");
            }),

        K.Trap("scooba", "Trap: Scooba", new Cost(F: 1),
            "Shuffle the attacking summon into its owner's deck.",
            null, c =>
            {
                if (c.State.BattleAttacker is { } a) c.ShuffleIntoDeck(a);
            },
            // A leader has no slot to leave and never goes back to a deck, so an
            // attack led by one is not a window this can answer.
            trapUseful: c =>
            {
                if (c.State.BattleAttacker is not { } a) return false;
                var s = c.SummonAt(a);
                return s is not null && !s.IsLeader;
            }),

        K.Stage("fishideology", "Field: Fish Ideology", new Cost(F: 2),
            "At the start of your turn, Catch 1 spent HP card off an ally.",
            new StageHooks
            {
                OnAwake = c =>
                {
                    var refs = new List<TargetRef>();
                    foreach (var r in c.SummonsOf(c.Me, true))
                    {
                        var s = c.SummonAt(r);
                        if (s is not null && s.Hp.Any(h => h.Flipped)) refs.Add(r);
                    }
                    c.Choose("catch-1", refs.ToArray(), "Catch a spent HP card off which ally?");
                },
            },
            flipText: "Catch 2 spent HP cards off any ally.",
            flipCost: new FlipCost { Mana = new Cost(F: 2) },
            flip: c => c.Catch(c.HolderRef, 2)),

        K.Stage("rainstorm", "Field: Rainstorm", new Cost(F: 1, C: 1), "Your Fish have +1 attack.",
            new StageHooks
            {
                StrengthBonus = a => a.Summon.Owner == a.Controller && a.Def.HasFaction(Faction.Fish) ? 1 : 0,
            }),
    };
}
