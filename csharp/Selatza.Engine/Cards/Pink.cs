using static Selatza.Cards.Kit;

namespace Selatza.Cards;

/// <summary>
/// Candy is the trade colour: Stores sell effects for debt and Love, Love
/// scales the payoffs, and debt is the price of everything. Saccharine is the
/// tribe of the living sweets; the mortal shopkeepers who sell them carry no
/// tribe of the colour. Both halves of a Store live here: self-use and the
/// full price negotiation, mirrored move for move with the TypeScript engine.
/// </summary>
public static class Pink
{
    private static readonly ColorKit K = new(Color.K, "k", "Pink", "Pink/Spells");

    /// <summary>A character with something to heal, the only one worth pointing at.</summary>
    private static TargetSpec DamagedCharacter(string label) => new()
    {
        Kind = TargetKind.Summon,
        Side = Side.Any,
        IncludeLeader = true,
        Label = label,
        Filter = a => a.Summon is { } s && s.Hp.Exists(h => h.Flipped),
    };

    private static bool AnyDamaged(GameState state, int user)
    {
        foreach (var pl in state.Players)
        {
            foreach (var s in pl.Slots.Append(pl.Leader))
            {
                if (s is not null && s.Hp.Exists(h => h.Flipped)) return true;
            }
        }
        return false;
    }

    public static CardDef[] Build() => new[]
    {
        // --- leader ----------------------------------------------------------
        K.Starter("PinkDeus", "Pink Deus", F(Faction.Saccharine, Faction.Ernum), str: 3, hp: 4,
            powers: Powers(new Power
            {
                Name = "Charm",
                Cost = new Cost(),
                Text = "Gain 1 Love.",
                SapSelf = true,
                Effect = c => c.GainLove(c.Me, 1),
            }, new Power
            {
                Name = "Bailout",
                Cost = new Cost(K: 2),
                Text = "Heal 2 debt.",
                SapSelf = true,
                Effect = c => c.ClearDebt(c.Me, 2),
            })),

        // --- level 1 ---------------------------------------------------------
        K.Summon(1, "SugarBug", "Sugar Bug", F(Faction.Saccharine, Faction.Beast),
            str: 4, hp: 2,
            flipText: "Gain 1 Love.",
            flip: c => c.GainLove(c.Me, 1)),

        K.Summon(1, "apprentice", "Apprentice", F(Faction.Saccharine, Faction.Mortal),
            str: 3, hp: 3,
            text: "Store: Draw 2 cards.",
            store: new StoreDef { Effect = c => c.Draw(c.Me, 2) }),

        K.Summon(1, "candymouse", "Candy Mouse", F(Faction.Saccharine, Faction.Beast),
            str: 2, hp: 3,
            entersSapped: true,
            text: "Arrives sapped. Battlecry: Scry 3 for a Saccharine.",
            triggers: new Triggers
            { OnEnter = c => c.Dig(c.Me, 3, d => d.HasFaction(Faction.Saccharine)) }),

        K.Summon(1, "gingerbreadgirl", "Gingerbread Girl",
            F(Faction.Saccharine, Faction.Living), str: 2, hp: 3,
            text: "Store: Heal a character for 2.",
            store: new StoreDef
            {
                Targets = Specs(DamagedCharacter("a character to heal")),
                Useful = AnyDamaged,
                Effect = c => { if (c.TargetOrNull(0) is { } t) c.Unflip(t, 2); },
            }),

        K.Summon(1, "icecreambird", "Ice Cream Bird", F(Faction.Saccharine, Faction.Beast),
            str: 3, hp: 2,
            entersSapped: true,
            text: "Arrives sapped. Battlecry: Scry 2 for any card.",
            triggers: new Triggers { OnEnter = c => c.Dig(c.Me, 2, d => true) },
            flipText: "Gain 1 Love.",
            flip: c => c.GainLove(c.Me, 1)),

        K.Summon(1, "livingbubbles", "Living Bubbles", F(Faction.Saccharine, Faction.Living),
            str: 2, hp: 3,
            flipText: "Return this card to your hand.",
            flip: c => c.ReturnThis()),

        K.Summon(1, "livingcandy", "Living Candy", F(Faction.Saccharine, Faction.Living),
            str: 2, hp: 2,
            text: "Battlecry: Gain 1 Love.",
            triggers: new Triggers { OnEnter = c => c.GainLove(c.Me, 1) },
            flipText: "Return this card to your hand.",
            flip: c => c.ReturnThis()),

        K.Summon(1, "lovecat", "Love Cat", F(Faction.Saccharine, Faction.Beast), str: 2, hp: 2,
            text: "Deathrattle: Gain 2 Love.",
            triggers: new Triggers { OnDeath = c => c.GainLove(c.Me, 2) },
            flipText: "Gain 1 Love.",
            flip: c => c.GainLove(c.Me, 1)),

        K.Summon(1, "patheticbonbon", "Pathetic Bonbon", F(Faction.Saccharine), str: 1, hp: 4,
            redirect: true,
            text: "Redirection.",
            flipText: "Gain 3 Love.",
            flip: c => c.GainLove(c.Me, 3)),

        K.Summon(1, "sleepybeast", "Sleepy Beast", F(Faction.Saccharine, Faction.Beast),
            str: 4, hp: 4,
            text: "Arrives sapped.",
            triggers: new Triggers
            { OnEnter = c => { if (c.Self is { } me) c.Sap(me); } }),

        // --- level 2 ---------------------------------------------------------
        K.Summon(2, "Briber", "Briber", F(Faction.Mortal), str: 3, hp: 4,
            text: "Battlecry: Each enemy heals 1 debt. Gain 1 Love for each.",
            triggers: new Triggers
            {
                OnEnter = c =>
                {
                    c.ClearDebt(c.Opp, 1);
                    c.GainLove(c.Me, 1);
                },
            }),

        K.Summon(2, "CandyGuardSeller", "CandyGuard Seller",
            F(Faction.Saccharine, Faction.Mortal, Faction.Scholar), str: 3, hp: 3,
            text: "Store: Put a CandyGuard into an empty slot.",
            store: new StoreDef
            {
                Useful = (state, user) =>
                {
                    foreach (var s in state.Players[user].Slots) if (s is null) return true;
                    return false;
                },
                Effect = c =>
                {
                    if (c.EmptySlot(c.Me) is not { } at) return;
                    c.PutSummon(c.Me, "k-candyguard", at, 1, Color.K, 7, asPrinted: true);
                },
            }),

        K.Summon(2, "CandyWizard", "Candy Wizard",
            F(Faction.Mortal, Faction.Scholar), str: 3, hp: 3,
            powers: Powers(new Power
            {
                Name = "Sprinkle",
                Cost = new Cost(K: 1),
                Text = "Gain 1 Love.",
                SapSelf = true,
                Effect = c => c.GainLove(c.Me, 1),
            }, new Power
            {
                Name = "Sugar Bolt",
                Cost = new Cost(K: 2),
                Text = "Deal 1 to an enemy summon. Love: Effect Damage +1.",
                Targets = Specs(Enemy()),
                Effect = c =>
                {
                    int n = c.SpendLove(c.Me);
                    c.Damage(c.Target(0), 1 + n);
                },
            })),

        K.Summon(2, "GunForHire", "Gun for Hire",
            F(Faction.Saccharine, Faction.Mortal, Faction.Beast), str: 4, hp: 3,
            text: "Store: Annihilate a non-Candy summon. Store costs +2.",
            // Candy here is the colour, not the tribe: the gun refuses pink cards.
            store: new StoreDef
            {
                Surcharge = 2,
                Targets = Specs(new TargetSpec
                {
                    Kind = TargetKind.Summon,
                    Side = Side.Any,
                    Label = "a non-Candy summon to annihilate",
                    Filter = a => a.Summon is { } s && a.Card is { } d
                        && GameState.ColorOf(s, d) != Color.K,
                }),
                Useful = (state, user) =>
                {
                    foreach (var pl in state.Players)
                    {
                        foreach (var s in pl.Slots)
                        {
                            if (s is not null
                                && GameState.ColorOf(s, Registry.Card(s.CardId)) != Color.K)
                            {
                                return true;
                            }
                        }
                    }
                    return false;
                },
                Effect = c => { if (c.TargetOrNull(0) is { } t) c.Annihilate(t); },
            }),

        K.Summon(2, "HotcakeSeller", "Hotcake Seller", F(Faction.Saccharine, Faction.Mortal),
            str: 3, hp: 3,
            text: "Store: One of your summons gains +2 attack.",
            store: new StoreDef
            {
                Targets = Specs(Ally("one of your summons")),
                Useful = (state, user) =>
                {
                    foreach (var s in state.Players[user].Slots) if (s is not null) return true;
                    return false;
                },
                Effect = c =>
                {
                    if (c.TargetOrNull(0) is { } t) c.BuffStrength(t, 2, ModDuration.Permanent);
                },
            }),

        K.Summon(2, "Nurse", "Nurse", F(Faction.Mortal), str: 3, hp: 4,
            text: "Store: Heal a character for 3.",
            store: new StoreDef
            {
                Targets = Specs(DamagedCharacter("a character to heal")),
                Useful = AnyDamaged,
                Effect = c => { if (c.TargetOrNull(0) is { } t) c.Unflip(t, 3); },
            }),

        K.Summon(2, "PrivateDetective", "Private Detective",
            F(Faction.Mortal, Faction.Scholar), str: 3, hp: 3,
            entersSapped: true,
            text: "Arrives sapped. Battlecry: Scry 4 for any card. Store: Scry 4 for any card.",
            triggers: new Triggers { OnEnter = c => c.Dig(c.Me, 4, _ => true) },
            store: new StoreDef
            {
                Useful = (state, user) => state.Players[user].Deck.Count > 0,
                Effect = c => c.Dig(c.Me, 4, _ => true),
            }),

        K.Summon(2, "Recycler", "Recycler", F(Faction.Living), str: 3, hp: 4,
            text: "Store: Shuffle 5 random cards from your discard pile into your deck.",
            store: new StoreDef
            {
                Useful = (state, user) => state.Players[user].Discard.Count > 0,
                Effect = c => c.RecycleDiscard(c.Me, 5),
            }),

        K.Summon(2, "SnoozingGiant", "Snoozing Giant", F(Faction.Saccharine, Faction.Beast),
            str: 4, hp: 5,
            text: "Arrives sapped.",
            triggers: new Triggers
            { OnEnter = c => { if (c.Self is { } me) c.Sap(me); } },
            flipText: "Gain 1 Love.",
            flip: c => c.GainLove(c.Me, 1)),

        K.Summon(2, "spellsell", "Spell Seller",
            F(Faction.Mortal, Faction.Scholar), str: 3, hp: 3,
            text: "Store: Scry 6 for a spell.",
            store: new StoreDef
            {
                Useful = (state, user) => state.Players[user].Deck.Count > 0,
                Effect = c => c.Dig(c.Me, 6, d => d.Type == CardType.Spell),
            }),

        // --- level 3 ---------------------------------------------------------
        K.Summon(3, "AncientSugar", "Ancient Sugar", F(Faction.Saccharine, Faction.Spirit),
            str: 4, hp: 5,
            text: "At the start of your turn, gain 1 Love.",
            triggers: new Triggers { OnAwake = c => c.GainLove(c.Me, 1) },
            powers: Powers(new Power
            {
                // No sap: the pump exists to swing with, and a sapped body cannot.
                Name = "Sugar Rush",
                Cost = new Cost(K: 1),
                Text = "Love: Gains +1 attack until end of turn.",
                NeedsLove = true,
                Effect = c =>
                {
                    int n = c.SpendLove(c.Me);
                    if (c.Self is { } me && n > 0) c.BuffStrength(me, n, ModDuration.Turn);
                },
            })),

        K.Summon(3, "DebtReliever", "Debt Reliever", F(Faction.Saccharine, Faction.Grinkle),
            str: 4, hp: 5,
            text: "Store: Heal 3 debt.",
            store: new StoreDef
            {
                Useful = (state, user) => state.Players[user].DebtCount > 0,
                Effect = c => c.ClearDebt(c.Me, 3),
            }),

        K.Summon(3, "DerangedCandyfolk", "Deranged Candyfolk",
            F(Faction.Saccharine, Faction.Mortal), str: 5, hp: 6,
            text: "Battlecry: You take 2 debt.",
            triggers: new Triggers { OnEnter = c => c.AddDebt(c.Me, 2) },
            powers: Powers(new Power
            {
                Name = "Tantrum",
                Cost = new Cost(K: 2),
                Text = "Deal 2 to a summon. Love: Effect Damage +1.",
                SapSelf = true,
                Targets = Specs(Any("a summon to hit")),
                Effect = c =>
                {
                    int n = c.SpendLove(c.Me);
                    c.Damage(c.Target(0), 2 + n);
                },
            })),

        K.Summon(3, "Eidola", "Eidola", F(Faction.Saccharine, Faction.Spirit), str: 3, hp: 5,
            powers: Powers(new Power
            {
                Name = "Dream",
                Cost = new Cost(),
                Text = "Love: Draw a card.",
                SapSelf = true,
                NeedsLove = true,
                Effect = c =>
                {
                    int n = c.SpendLove(c.Me);
                    c.Draw(c.Me, n);
                },
            })),

        K.Summon(3, "Final Unicorn", "Final Unicorn",
            F(Faction.Saccharine, Faction.Beast, Faction.Star), str: 4, hp: 6,
            powers: Powers(new Power
            {
                Name = "Final Blessing",
                Cost = new Cost(K: 2),
                Text = "Heal a character for 2. Love: Heal 1 more.",
                SapSelf = true,
                Targets = Specs(DamagedCharacter("a character to heal")),
                Effect = c =>
                {
                    int n = c.SpendLove(c.Me);
                    if (c.TargetOrNull(0) is { } t) c.Unflip(t, 2 + n);
                },
            }),
            flipText: "Return this card to your hand.",
            flipCost: new FlipCost { Mana = new Cost(K: 1) },
            flip: c => c.ReturnThis()),

        K.Summon(3, "HyperCapitalist", "Hyper Capitalist",
            F(Faction.Saccharine, Faction.Mortal), str: 4, hp: 5,
            text: "When another player buys from one of your Stores, draw a card.",
            triggers: new Triggers { OnStoreSold = c => c.Draw(c.Me, 1) },
            powers: Powers(new Power
            {
                Name = "Golden Handshake",
                Cost = new Cost(K: 2),
                Text = "Draw a card and gain 1 Love.",
                SapSelf = true,
                Effect = c =>
                {
                    c.Draw(c.Me, 1);
                    c.GainLove(c.Me, 1);
                },
            })),

        K.Summon(3, "InfiniteLove", "Infinite Love", F(Faction.Saccharine, Faction.Beast),
            str: 1, hp: 1,
            text: "Arrives sapped. Battlecry, Love: Gains +1 attack and 1 HP off your deck.",
            triggers: new Triggers
            {
                OnEnter = c =>
                {
                    if (c.Self is not { } me) return;
                    c.Sap(me);
                    int n = c.SpendLove(c.Me);
                    if (n <= 0) return;
                    c.BuffStrength(me, n, ModDuration.Permanent);
                    c.Reinforce(me, n);
                },
            }),

        K.Summon(3, "LastLollipop", "Last Lollipop", F(Faction.Saccharine), str: 3, hp: 7,
            redirect: true, stationary: true,
            text: "Redirection. Stationary. When attacked, gain 1 Love. At the end of your turn, your other Saccharine allies gain +1 attack.",
            triggers: new Triggers
            {
                OnDefend = c => c.GainLove(c.Me, 1),
                // "Allies" here reaches the leader too, by the user's own ruling.
                OnEndTurn = c =>
                {
                    foreach (var r in c.SummonsOf(c.Me, true))
                    {
                        var s = c.SummonAt(r);
                        if (s is null || ReferenceEquals(s, c.Source)) continue;
                        if (!Registry.Card(s.CardId).HasFaction(Faction.Saccharine)) continue;
                        c.BuffStrength(r, 1, ModDuration.Permanent);
                    }
                },
            },
            powers: Powers(new Power
            {
                Name = "Lick",
                Cost = new Cost(),
                Text = "Spend 1 HP off this: gain 1 Love.",
                SapSelf = true,
                HpCost = 1,
                Effect = c =>
                {
                    if (c.Self is not { } me) return;
                    c.RawDamage(me, 1);
                    c.GainLove(c.Me, 1);
                },
            })),

        K.Summon(3, "SweetHarmony", "Sweet Harmony", F(Faction.Saccharine, Faction.Star),
            str: 4, hp: 5,
            powers: Powers(new Power
            {
                Name = "Harmonize",
                Cost = new Cost(),
                Text = "Love: Heal 1 debt.",
                SapSelf = true,
                NeedsLove = true,
                Effect = c =>
                {
                    int n = c.SpendLove(c.Me);
                    c.ClearDebt(c.Me, n);
                },
            })),

        // --- spells, field and traps ------------------------------------------
        K.Spell("Candycane", "Candy Cane", new Cost(K: 1),
            "An ally character gains +2 attack until end of turn. Love: +1 attack.",
            targets: Specs(AllyOrLeader()),
            effect: c =>
            {
                int n = c.SpendLove(c.Me);
                c.BuffStrength(c.Target(0), 2 + n, ModDuration.Turn);
            },
            flipText: "Gain 1 Love.",
            flip: c => c.GainLove(c.Me, 1)),

        K.Spell("DarkCandy", "Dark Candy", new Cost(K: 4),
            "Deal 1 to every enemy summon. Love: Effect Damage +1.",
            effect: c =>
            {
                int n = c.SpendLove(c.Me);
                foreach (var r in c.SummonsOf(c.Opp)) c.Damage(r, 1 + n);
            },
            flipText: "Return this card to your hand.",
            flipCost: new FlipCost { Mana = new Cost(K: 1) },
            flip: c => c.ReturnThis()),

        K.Stage("FieldClearanceSale", "Field: Clearance Sale", new Cost(K: 2, C: 1),
            "Your Stores may be used twice per turn and cost 1 less. At the start of your turn, draw a card. When another player buys from one of your Stores, heal 1 debt.",
            hooks: new StageHooks
            {
                OnAwake = c => c.Draw(c.Me, 1),
                OnStoreSold = c => c.ClearDebt(c.Me, 1),
            },
            flipText: "Gain 1 Love.",
            flip: c => c.GainLove(c.Me, 1),
            storeBoost: true),

        K.Spell("GiftOfGiving", "Gift of Giving", new Cost(),
            "The enemy draws a card. Gain 2 Love.",
            effect: c =>
            {
                c.Draw(c.Opp, 1);
                c.GainLove(c.Me, 2);
            },
            flipText: "Gain 1 Love.",
            flip: c => c.GainLove(c.Me, 1)),

        K.Spell("LineGoesUp", "Line Goes Up", new Cost(K: 1),
            "Gain 1 Love for every 4 debt you carry.",
            effect: c =>
            {
                int earned = c.State.Players[c.Me].DebtCount / 4;
                if (earned > 0) c.GainLove(c.Me, earned);
                else c.Log("The line is flat.");
            }),

        K.Spell("Loan", "Loan", new Cost(),
            "A player draws 2 cards and takes 2 debt.",
            targets: Specs(new TargetSpec
            {
                Kind = TargetKind.Summon,
                Side = Side.Any,
                IncludeLeader = true,
                Label = "a player, by their leader",
                Filter = a => a.Ref.Kind == TargetKind.Leader,
            }),
            effect: c =>
            {
                var t = c.Target(0);
                if (t.Kind != TargetKind.Leader) return;
                c.Draw(t.Player, 2);
                c.AddDebt(t.Player, 2,
                    $"{c.State.Players[t.Player].Name} takes 2 debt on the loan.");
            }),

        K.Spell("LoveForAPrice", "Love for a Price", new Cost(K: 2),
            "Gain 2 Love and draw a card.",
            effect: c =>
            {
                c.GainLove(c.Me, 2);
                c.Draw(c.Me, 1);
            },
            flipText: "Gain 1 Love.",
            flip: c => c.GainLove(c.Me, 1)),

        K.Spell("cuffed", "Cuffed", new Cost(K: 2),
            "An enemy summon becomes Stationary. Annihilate this card.",
            targets: Specs(Enemy()),
            effect: c =>
            {
                var s = c.SummonAt(c.Target(0));
                if (s is null) return;
                s.Rooted = true;
                c.Log($"{Registry.Card(s.CardId).Name} is cuffed in place.");
            },
            flipText: "Return this card to your hand.",
            flipCost: new FlipCost { Mana = new Cost(K: 1) },
            flip: c => c.ReturnThis(),
            annihilateAfterCast: true),

        K.Trap("trapExpensiveSecurity", "Trap: Expensive Security", new Cost(K: 1),
            "Annihilate the attacking summon. Take 2 debt.",
            // A leader cannot be annihilated without ending the game, so an
            // attack led by one is not a window this can answer: the Scooba
            // ruling.
            trapUseful: c =>
                c.State.BattleAttacker is { } a
                && c.SummonAt(a) is { } s && !s.IsLeader,
            effect: c =>
            {
                if (c.State.BattleAttacker is { } a) c.Annihilate(a);
                c.AddDebt(c.Me, 2,
                    $"{c.State.Players[c.Me].Name} takes 2 debt for the security bill.");
            }),

        K.Trap("trapSugarCrash", "Trap: Sugar Crash", new Cost(K: 1),
            "Spell Trap. If the enemy has played more than 4 cards this turn, counter the spell, annihilate one of their summons and gain 2 Love.",
            spellTrap: true,
            trapUseful: c =>
                c.State.Pending?.Spell is { } sp
                && c.State.Players[sp.Caster].PlaysThisTurn > 4,
            targets: Specs(new TargetSpec
            {
                Kind = TargetKind.Summon,
                Side = Side.Enemy,
                Label = "a summon of the caster's to annihilate",
                Optional = true,
                Filter = a => a.State.Pending?.Spell is not { } sp
                    || (a.Ref.Kind == TargetKind.Summon && a.Ref.Player == sp.Caster),
            }),
            effect: c =>
            {
                if (c.TargetOrNull(0) is { } t) c.Annihilate(t);
                c.GainLove(c.Me, 2);
            }),

        // The token CandyGuard Seller puts down. Never drafted: it arrives only
        // through the Store, into the buyer's own slot, off the buyer's own deck.
        new CardDef
        {
            Id = "k-candyguard",
            Name = "CandyGuard",
            Color = Color.K,
            Type = CardType.Summon,
            Level = 1,
            Strength = 1,
            Hp = 7,
            Redirect = true,
            Text = "Redirection.",
            Uncollectible = true,
            Factions = F(Faction.Saccharine),
            Art = "Cardgame/Pink/Extras/CandyGuard.png",
            Num = "CGD",
        },
    };
}
