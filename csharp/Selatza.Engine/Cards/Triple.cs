using static Selatza.Cards.Kit;

namespace Selatza.Cards;

/// <summary>
/// The ten three-colour legends, one per combination. Only a leader carrying
/// all three colours can run one, and leading a deck is a seat any body may
/// take, so each of these is the key to its own identity: you lead with it or
/// you never cast it. Every one is level 3 and prints Legendary off Color3.
/// </summary>
public static class Triple
{
    // The trio names the art folder; the first colour is the frame, and is also
    // what the card pays when it is faced as a supporter, so the two are not in
    // the same order the way a dual pair's letters are.
    private static readonly TripleKit Bgp = new("BGP", Color.F, Color.R, Color.O);
    private static readonly TripleKit Bgr = new("BGR", Color.R, Color.F, Color.P);
    private static readonly TripleKit Bgy = new("BGY", Color.F, Color.R, Color.S);
    private static readonly TripleKit Bpy = new("BPY", Color.S, Color.F, Color.O);
    private static readonly TripleKit Brp = new("BRP", Color.O, Color.F, Color.P);
    private static readonly TripleKit Bry = new("BRY", Color.F, Color.P, Color.S);
    private static readonly TripleKit Gpy = new("GPY", Color.O, Color.R, Color.S);
    private static readonly TripleKit Grp = new("GRP", Color.R, Color.P, Color.O);
    private static readonly TripleKit Gry = new("GRY", Color.P, Color.R, Color.S);
    private static readonly TripleKit Ryp = new("RYP", Color.P, Color.O, Color.S);
    // The Candy legends. Every trio that carries Candy frames it, so all ten of
    // these pay Candy when they are faced as supporters.
    private static readonly TripleKit Mbp = new("MBP", Color.F, Color.K, Color.O);
    private static readonly TripleKit Mbr = new("MBR", Color.K, Color.F, Color.P);
    private static readonly TripleKit Mby = new("MBY", Color.K, Color.F, Color.S);
    private static readonly TripleKit Mgb = new("MGB", Color.R, Color.K, Color.F);
    private static readonly TripleKit Mgp = new("MGP", Color.K, Color.R, Color.O);
    private static readonly TripleKit Mgr = new("MGR", Color.K, Color.R, Color.P);
    private static readonly TripleKit Mgy = new("MGY", Color.K, Color.R, Color.S);
    private static readonly TripleKit Mpr = new("MPR", Color.K, Color.O, Color.P);
    private static readonly TripleKit Mpy = new("MPY", Color.K, Color.O, Color.S);
    private static readonly TripleKit Myr = new("MYR", Color.K, Color.S, Color.P);

    /// <summary>
    /// The supporter Banana Mage hands across the table. Neutral, so it pays
    /// colourless, and uncollectible because Joke is the only thing that makes one.
    /// </summary>
    public const string BananaId = "n-banana";

    private static CardDef Banana() => new()
    {
        Id = BananaId,
        Name = "Banana",
        Color = Color.N,
        Type = CardType.Spell,
        Neutral = true,
        Uncollectible = true,
        Level = 1,
        Num = "GEN",
        Text = "Supporter",
        Art = "Cardgame/Extras/Banana.png",
        Artist = "klabss",
    };

    public static CardDef[] Build() => new[]
    {
        Banana(),
        Bgp.Summon("Overknower", "Overknower", F(Faction.Spirit, Faction.Scholar), str: 2, hp: 7,
            freeSpells: true, spellImmune: true,
            text: "Spell Immunity. Your spells cost no mana while you control no summons.",
            powers: Powers(new Power
            {
                Name = "Madness",
                Cost = new Cost(F: 1, R: 1, O: 1),
                Text = "Shuffle 4 Rot into the enemy's deck.",
                SapSelf = true,
                Effect = c => c.Curse(c.Opp, "o-curse-rot", 4),
            })),

        Bgr.Summon("Screener", "Screener", F(Faction.Machine), str: 3, hp: 5,
            text: "Each ally Machine with 1 HP left gives Effect Damage +1.",
            triggers: new Triggers
            {
                EffectDamageBonus = a =>
                {
                    int n = 0;
                    // The leader seat counts: an ally is an ally wherever it
                    // stands, and the caller already runs this hook for the
                    // leader as well as for slot bodies.
                    var p = a.State.Players[a.Controller];
                    foreach (var s in p.Slots.Append(p.Leader))
                    {
                        if (s is null || s.CardId == "m-bgr-screener") continue;
                        if (!Registry.Card(s.CardId).HasFaction(Faction.Machine)) continue;
                        if (s.RemainingHp == 1) n++;
                    }
                    return n;
                },
            },
            powers: Powers(new Power
            {
                Name = "Static",
                Cost = new Cost(F: 1, R: 1, P: 1),
                Text = "Scry 5 of the enemy's deck for any card, rebuilt in Robot.",
                SapSelf = true,
                Effect = c => c.RaidDeck(c.Opp, c.Me, 5, "static-raid"),
            })),

        Bgy.Summon("Seer Altine", "Seer Altine", F(Faction.Scholar, Faction.Star), str: 2, hp: 6,
            text: "At the start of your turn, the top card of your deck becomes a sapped supporter, "
                + "then draw a card. A level 1 you play is annihilated; a level 2 takes 1.",
            triggers: new Triggers
            {
                OnAwake = c => { c.SupporterFromDeck(c.Me); c.Draw(c.Me, 1); },
                OnSummonPlayed = c =>
                {
                    var played = c.SummonAt(c.Target(0));
                    if (played is null || played.Owner != c.Me) return;
                    int lvl = GameState.LevelOf(played, Registry.Card(played.CardId));
                    if (lvl == 1) c.Annihilate(c.Target(0));
                    else if (lvl == 2) c.RawDamage(c.Target(0), 1);
                },
            },
            powers: Powers(new Power
            {
                Name = "Long Sight",
                Cost = new Cost(F: 1, R: 1, S: 1),
                Text = "Heal an ally 2, then Scry 5 for any card and put it under that ally as face-down HP.",
                SapSelf = true,
                Targets = Specs(AllyOrLeader()),
                Effect = c =>
                {
                    c.Unflip(c.Target(0), 2);
                    c.Dig(c.Me, 5, _ => true,
                        effect: "long-sight", prompt: "Put a card under that ally", at: c.Target(0));
                },
            }, new Power
            {
                Name = "Ultimate Progress",
                Cost = new Cost(C: 1),
                Text = "Annihilate an ally summon, then pay off 3 debt.",
                Targets = Specs(Ally()),
                Effect = c =>
                {
                    c.Annihilate(c.Target(0));
                    c.ClearDebt(c.Me, 3);
                },
            })),

        Bpy.Summon("BananaMage", "Banana Mage", F(Faction.Living, Faction.Scholar), str: 0, hp: 1,
            text: "Battlecry: Each of your characters heals 2.",
            triggers: new Triggers
            {
                OnEnter = c =>
                {
                    foreach (var r in c.SummonsOf(c.Me, true)) c.Unflip(r, 2);
                },
            },
            powers: Powers(
                new Power
                {
                    Name = "Joke",
                    Cost = new Cost(S: 1),
                    Text = "Your opponent gains 1 supporter in their own color and takes 3 debt.",
                    SapSelf = true,
                    Effect = c =>
                    {
                        var them = Registry.Card(c.State.Players[c.Opp].LeaderCardId);
                        c.GiveSupporter(c.Opp, them.Color == Color.N || them.Neutral
                            ? BananaId
                            : Generated.ColoredBanana(BananaId, them.Color));
                        c.AddDebt(c.Opp, 3, "Nobody laughed.");
                    },
                },
                new Power
                {
                    Name = "Little Curse",
                    Cost = new Cost(O: 1, F: 1),
                    Text = "Deal 1 to a summon.",
                    SapSelf = true,
                    Targets = Specs(Any()),
                    Effect = c => c.Damage(c.Target(0), 1),
                })),

        Brp.Summon("DecayingGrinkleGod", "Decaying Grinkle God",
            F(Faction.Grinkle, Faction.Spirit), str: 2, hp: 3,
            text: "At the start of your turn, your Grinkles gain +1 attack "
                + "and this loses 1 HP.",
            triggers: new Triggers
            {
                OnAwake = c =>
                {
                    foreach (var r in c.SummonsOf(c.Me, true))
                    {
                        var s = c.SummonAt(r);
                        if (s is not null && Registry.Card(s.CardId).HasFaction(Faction.Grinkle))
                            c.BuffStrength(r, 1, ModDuration.Permanent);
                    }
                    // Raw, so no Effect Damage bonus inflates the upkeep it pays.
                    if (c.Self is { } me) c.RawDamage(me, 1);
                },
            },
            powers: Powers(new Power
            {
                // Nine pips across three colours is the brake, so this one does not sap.
                Name = "Grinkle Rot",
                Cost = new Cost(F: 2, P: 2, O: 2),
                Text = "Destroy the enemy leader.",
                Effect = c => c.Destroy(new TargetRef { Kind = TargetKind.Leader, Player = c.Opp }),
            })),

        Bry.Summon("DrownedWanderer", "Drowned Wanderer", F(Faction.Mortal, Faction.Fish),
            str: 2, hp: 3,
            text: "Has +1 attack for each summon in your debt zone.",
            triggers: new Triggers
            {
                StrengthBonus = a =>
                {
                    if (a.Summon.CardId != "m-bry-drownedwanderer" || a.Summon.Owner != a.Controller)
                        return 0;
                    int n = 0;
                    foreach (var id in a.State.Players[a.Controller].DebtZone)
                    {
                        if (Registry.Card(id).Type == CardType.Summon) n++;
                    }
                    return n;
                },
            },
            powers: Powers(new Power
            {
                Name = "Wash Ashore",
                Cost = new Cost(F: 1, P: 1, S: 1),
                Text = "Draw 5 cards. Put any summons among them into empty slots with +1 attack and 1 extra HP, then discard the rest.",
                SapSelf = true,
                Effect = c =>
                {
                    var p = c.State.Players[c.Me];
                    int take = Math.Min(5, p.Deck.Count);
                    var drawn = p.Deck.GetRange(0, take);
                    p.Deck.RemoveRange(0, take);
                    foreach (var id in drawn)
                    {
                        var def = Registry.Card(id);
                        int? slot = def.Type == CardType.Summon ? c.EmptySlot(c.Me) : null;
                        if (slot is not { } open)
                        {
                            p.Discard.Add(id);
                            continue;
                        }
                        var landed = Effects.PutSummonDirect(c.State, c.Me, id, open,
                            def.Strength, def.Color, def.Hp + 1, asPrinted: true);
                        if (landed is null)
                        {
                            p.Discard.Add(id);
                            continue;
                        }
                        // The body plays as its own card, so the strength it
                        // arrives with is the printed one and the +1 has to be
                        // laid on top. Passing it as an override instead
                        // replaces the printed line and is dropped outright by
                        // asPrinted, which is how this card spent its life
                        // granting the extra HP and none of the attack.
                        c.BuffStrength(TargetRef.Summon(c.Me, open), 1, ModDuration.Permanent);
                    }
                },
            })),

        Gpy.Summon("ObscureSlime", "Obscure Slime", null,
            str: 3, hp: 6,
            text: "",
            powers: Powers(
                new Power
                {
                    Name = "Goop",
                    Cost = default,
                    Text = "Deal 2 to a summon.",
                    SapSelf = true,
                    Targets = Specs(Any()),
                    Effect = c => c.Damage(c.Target(0), 2),
                },
                new Power
                {
                    Name = "Melt",
                    Cost = new Cost(O: 1, R: 1, S: 1),
                    Text = "Destroy an enemy supporter.",
                    SapSelf = true,
                    Targets = Specs(new TargetSpec
                    {
                        Kind = TargetKind.Supporter,
                        Side = Side.Enemy,
                        Label = "an enemy supporter",
                    }),
                    Effect = c => c.DestroySupporter(c.Target(0)),
                })),

        Grp.Summon("HorribleMalware", "Horrible Malware", F(Faction.Machine, Faction.Spirit),
            str: 2, hp: 3,
            text: "Whenever your opponent casts a spell, you gain a copy rebuilt in Oil, its cost split evenly between Oil, Robot and Pepper.",
            triggers: new Triggers
            {
                OnEnemySpellCast = c =>
                {
                    if (c.TargetOrNull(0) is not { Kind: TargetKind.Discard } r) return;
                    var pile = c.State.Players[r.Player].Discard;
                    if (r.Index < 0 || r.Index >= pile.Count) return;
                    c.ToHand(c.Me, Generated.MalwareCopy(pile[r.Index]));
                },
            },
            powers: Powers(new Power
            {
                Name = "Infect",
                Cost = new Cost(P: 1, O: 1, R: 1),
                Text = "Cast Virus.",
                SapSelf = true,
                // Virus asks for the same one enemy summon, so the ctx passes
                // straight through and the two cards can never drift apart.
                Targets = Specs(Enemy()),
                Effect = c => Registry.Card("m-rg-virus").Effect?.Invoke(c),
            })),

        Gry.Summon("SpiritOfSolstice", "Spirit of Solstice", F(Faction.Living, Faction.Spirit),
            str: 2, hp: 3,
            text: "Your Living summons have +1 attack and gain 1 HP at the start of your turn.",
            triggers: new Triggers
            {
                StrengthBonus = a => a.Summon.Owner == a.Controller && !a.Summon.IsLeader
                    && a.Def.HasFaction(Faction.Living) ? 1 : 0,
                OnAwake = c =>
                {
                    foreach (var r in c.SummonsOf(c.Me))
                    {
                        var s = c.SummonAt(r);
                        if (s is not null && Registry.Card(s.CardId).HasFaction(Faction.Living))
                            c.Reinforce(r, 1);
                    }
                },
            },
            powers: Powers(new Power
            {
                Name = "Solstice",
                Cost = new Cost(R: 1, P: 1, S: 1),
                Text = "Each of your Living characters heals 1 and gains a Power Shield, then deal 1 to every enemy summon.",
                SapSelf = true,
                Effect = c =>
                {
                    foreach (var r in c.SummonsOf(c.Me, true))
                    {
                        var s = c.SummonAt(r);
                        if (s is null || !Registry.Card(s.CardId).HasFaction(Faction.Living)) continue;
                        c.Unflip(r, 1);
                        c.Shield(r, 1);
                    }
                    foreach (var r in c.SummonsOf(c.Opp)) c.Damage(r, 1);
                },
            })),

        Ryp.Summon("LivingCurse", "Living Curse", F(Faction.Spirit), str: 3, hp: 5,
            text: "Battlecry: Scry 6 for a spell and gain its effect as a Power with its cost rebuilt in Oil.",
            triggers: new Triggers
            {
                OnEnter = c =>
                {
                    if (c.Self is not { } me) return;
                    c.Dig(c.Me, 6, d => d.Type == CardType.Spell,
                        effect: "living-curse", prompt: "Take a spell as a Power", at: me);
                },
            },
            powers: Powers(new Power
            {
                Name = "Offering",
                Cost = new Cost(P: 1, O: 1, S: 1),
                Text = "Draw 3 cards, discard the spells among them, then deal 1 to an enemy summon for each spell discarded.",
                SapSelf = true,
                Effect = c =>
                {
                    var p = c.State.Players[c.Me];
                    int take = Math.Min(3, p.Deck.Count);
                    var drawn = p.Deck.GetRange(0, take);
                    p.Deck.RemoveRange(0, take);
                    int spells = 0;
                    foreach (var id in drawn)
                    {
                        if (Registry.Card(id).Type == CardType.Spell)
                        {
                            p.Discard.Add(id);
                            spells++;
                        }
                        else c.ToHand(c.Me, id);
                    }
                    for (int i = 0; i < spells; i++)
                    {
                        c.Choose("deal-1", c.SummonsOf(c.Opp), "Which enemy summon takes 1?");
                    }
                },
            })),

        // --- the Candy legends -------------------------------------------------
        Mbp.Summon("Vier", "Vier", F(Faction.Mortal, Faction.Scholar), str: 4, hp: 3,
            text: "At the end of your turn, gain 1 Love for each enemy summon with a Wound.",
            triggers: new Triggers
            {
                OnEndTurn = c =>
                {
                    int n = 0;
                    foreach (var r in c.SummonsOf(c.Opp))
                    {
                        if (c.SummonAt(r) is { Wounds: > 0 }) n++;
                    }
                    if (n > 0) c.GainLove(c.Me, n);
                },
            },
            powers: Powers(
                new Power
                {
                    Name = "Slice",
                    Cost = default,
                    Text = "Put 2 Wounds on an enemy summon.",
                    SapSelf = true,
                    Targets = Specs(Enemy()),
                    Effect = c => c.Wound(c.Target(0), 2),
                },
                new Power
                {
                    Name = "Eviscerate",
                    Cost = new Cost(K: 1, F: 1, O: 1),
                    Text = "Deal 2 to any character. Love: +1 damage per 3 spent.",
                    SapSelf = true,
                    Targets = Specs(AnyOrLeader("a character")),
                    Effect = c =>
                    {
                        int spent = c.SpendLove(c.Me);
                        c.Damage(c.Target(0), 2 + spent / 3);
                    },
                })),

        Mbr.Summon("Saraza", "Saraza", F(Faction.Mortal), str: 2, hp: 2,
            text: "Has +1 attack for each Love you hold.",
            triggers: new Triggers
            {
                StrengthBonus = a =>
                {
                    if (a.Summon.CardId != "m-mbr-saraza" || a.Summon.Owner != a.Controller) return 0;
                    return a.State.Players[a.Controller].Love;
                },
            },
            powers: Powers(new Power
            {
                Name = "Dead or Alive",
                Cost = new Cost(K: 1, F: 1, P: 1),
                Text = "Deal 2 to a summon and gain 2 Love.",
                SapSelf = true,
                Targets = Specs(Any()),
                Effect = c =>
                {
                    c.Damage(c.Target(0), 2);
                    c.GainLove(c.Me, 2);
                },
            })),

        Mby.Summon("WellWorthit", "Well Worth It", F(Faction.Spirit), str: 2, hp: 6,
            text: "Whenever you take debt, gain 1 Love.",
            triggers: new Triggers { OnDebtTaken = c => c.GainLove(c.Me, 1) },
            powers: Powers(new Power
            {
                Name = "Treat Yourself",
                Cost = new Cost(K: 1, F: 1, S: 1),
                Text = "Heal 3 debt, then heal your leader for 3.",
                SapSelf = true,
                Effect = c =>
                {
                    c.ClearDebt(c.Me, 3);
                    c.Unflip(TargetRef.Leader(c.Me), 3);
                },
            })),

        Mgb.Summon("CodeInfestedSweetling", "Code-Infested Sweetling",
            F(Faction.Saccharine, Faction.Machine), str: 1, hp: 1,
            text: "Whenever an ally dies, gain 2 Love.",
            triggers: new Triggers
            {
                OnOtherDeath = c =>
                {
                    if (c.State.DyingOwner != c.Me) return;
                    c.GainLove(c.Me, 2);
                },
            },
            powers: Powers(new Power
            {
                Name = "Sugar Patch",
                Cost = new Cost(K: 1, R: 1, F: 1),
                Text = "Your other allies gain a Power Shield. Love: +1 Power Shield per 3 spent.",
                SapSelf = true,
                Effect = c =>
                {
                    int spent = c.SpendLove(c.Me);
                    int count = 1 + spent / 3;
                    foreach (var r in c.SummonsOf(c.Me, true))
                    {
                        var s = c.SummonAt(r);
                        if (s is null || ReferenceEquals(s, c.Source)) continue;
                        c.Shield(r, count);
                    }
                },
            })),

        Mgp.Summon("GodOfMisfortune", "God of Misfortune", F(Faction.Spirit), str: 2, hp: 6,
            text: "At the start of your turn, Scry 6 for any card, then every player takes 1 debt.",
            triggers: new Triggers
            {
                OnAwake = c =>
                {
                    c.Dig(c.Me, 6, _ => true);
                    c.AddDebt(c.Me, 1, "Misfortune finds everyone.");
                    c.AddDebt(c.Opp, 1, "Misfortune finds everyone.");
                },
            },
            powers: Powers(new Power
            {
                Name = "Misfortune",
                Cost = new Cost(K: 1, R: 1, O: 1),
                Text = "Move 1 of your debt onto every other player.",
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

        Mgr.Summon("RansomwareArtist", "Ransomware Artist",
            F(Faction.Mortal, Faction.Machine), str: 1, hp: 2,
            text: "Store: Heal 6 debt, then Mill 10.",
            store: new StoreDef
            {
                Useful = (state, user) => state.Players[user].DebtCount > 0,
                Effect = c =>
                {
                    c.ClearDebt(c.Me, 6);
                    c.Mill(c.Me, 10);
                },
            },
            powers: Powers(new Power
            {
                Name = "Extort",
                Cost = new Cost(K: 1, R: 1, P: 1),
                Text = "Deal 2 debt and gain 1 Love.",
                SapSelf = true,
                Effect = c =>
                {
                    c.AddDebt(c.Opp, 2, "The ransom is due.");
                    c.GainLove(c.Me, 1);
                },
            })),

        Mgy.Summon("TheThorn", "The Thorn", F(Faction.Ernum), str: 3, hp: 2,
            text: "Store: A character gains a Power Shield. "
                + "Whenever you play a Hedron, deal 1 to an enemy summon.",
            store: new StoreDef
            {
                Targets = Specs(AnyOrLeader("a character")),
                Effect = c => { if (c.TargetOrNull(0) is { } t) c.Shield(t, 1); },
            },
            triggers: new Triggers
            {
                OnSummonPlayed = c =>
                {
                    var played = c.SummonAt(c.Target(0));
                    if (played is null || played.Owner != c.Me) return;
                    if (!Registry.Card(played.CardId).HasFaction(Faction.Hedron)) return;
                    c.Choose("deal-1", c.SummonsOf(c.Opp), "Deal 1 to which enemy summon?");
                },
            },
            powers: Powers(new Power
            {
                // Three pips across three colours is the brake, so this one does not sap.
                Name = "Skewer",
                Cost = new Cost(K: 1, R: 1, S: 1),
                Text = "Deal 5 to a summon.",
                Targets = Specs(Any()),
                Effect = c => c.Damage(c.Target(0), 5),
            })),

        Mpr.Summon("HumanitysDefender", "Humanity's Defender",
            F(Faction.Mortal, Faction.Spirit), str: 3, hp: 10,
            redirect: true,
            text: "Redirection. Your other Mortals have +1 attack.",
            triggers: new Triggers
            {
                StrengthBonus = a => a.Summon.Owner == a.Controller
                    && a.Def.HasFaction(Faction.Mortal)
                    && a.Summon.CardId != "m-mpr-humanitysdefender" ? 1 : 0,
            },
            powers: Powers(new Power
            {
                Name = "Last Stand",
                Cost = new Cost(K: 1, O: 1, P: 1),
                Text = "Heal your leader for 10.",
                SapSelf = true,
                Effect = c => c.Unflip(TargetRef.Leader(c.Me), 10),
            })),

        Mpy.Summon("Sopapli", "Sopapli", F(Faction.Spirit), str: 1, hp: 7,
            text: "At the start of your turn, gain 1 Love.",
            triggers: new Triggers { OnAwake = c => c.GainLove(c.Me, 1) },
            powers: Powers(new Power
            {
                Name = "Tranquility",
                Cost = new Cost(K: 1, O: 1, S: 1),
                Text = "Heal every character for 2.",
                SapSelf = true,
                Effect = c =>
                {
                    foreach (var r in c.SummonsOf(c.Me, true)) c.Unflip(r, 2);
                    foreach (var r in c.SummonsOf(c.Opp, true)) c.Unflip(r, 2);
                },
            })),

        Myr.Summon("Hellmage", "Hellmage", F(Faction.Spirit, Faction.Scholar), str: 0, hp: 2,
            effectDamage: 1,
            text: "Effect Damage +1. At the end of your turn, every enemy character heals 1. Store: Heal your leader for 10. Store costs +2.",
            store: new StoreDef
            {
                Surcharge = 2,
                // A bought effect reads as the buyer's, so the leader healed is
                // theirs and so is the one this asks about.
                Useful = (state, user) =>
                    state.Players[user].Leader is { } l && l.Hp.Exists(h => h.Flipped),
                Effect = c => c.Unflip(TargetRef.Leader(c.Me), 10),
            },
            triggers: new Triggers
            {
                OnEndTurn = c => { foreach (var r in c.SummonsOf(c.Opp, true)) c.Unflip(r, 1); },
            },
            powers: Powers(new Power
            {
                Name = "Hellfire",
                Cost = new Cost(K: 1, S: 1, P: 1),
                Text = "Deal 1 to every enemy character.",
                SapSelf = true,
                Effect = c => { foreach (var r in c.SummonsOf(c.Opp, true)) c.Damage(r, 1); },
            })),
    };

    /// <summary>
    /// Screener's half of Static, and Living Curse's Battlecry. Registered
    /// alongside the cards because nothing else uses either resolver.
    /// </summary>
    public static void Register()
    {
        // The cards came off the enemy's deck, so the player who is not choosing
        // is the one they go back to.
        Choices.Register("static-raid", (state, choice, pick) =>
        {
            var cards = new List<string>(choice.Cards ?? Array.Empty<string>());
            int victim = GameState.Other(choice.Player);
            if (pick.Index is { } i)
            {
                var id = cards[i];
                cards.RemoveAt(i);
                Effects.ToHand(state, choice.Player, Generated.RobotCopy(id));
            }
            state.Players[victim].Deck.AddRange(cards);
        });

        // One card off the reveal, face down under the chosen ally.
        Choices.Register("long-sight", (state, choice, pick) =>
        {
            var cards = new List<string>(choice.Cards ?? Array.Empty<string>());
            var p = state.Players[choice.Player];
            if (pick.Index is { } i && choice.At is { } at)
            {
                var id = cards[i];
                cards.RemoveAt(i);
                var self = state.Find(at);
                if (self is null) p.Deck.Insert(0, id);
                else
                {
                    self.Hp.Add(new HpCard { CardId = id, Flipped = false });
                    Effects.Log(state, choice.Player,
                        $"{Registry.Card(id).Name} slides under {Registry.Card(self.CardId).Name}.");
                }
            }
            p.Deck.AddRange(cards);
        });

        // The picked spell is discarded and lent back to the body as a Power
        // as a Power on a card minted for this body, so the face reads what it does.
        Choices.Register("living-curse", (state, choice, pick) =>
        {
            var cards = new List<string>(choice.Cards ?? Array.Empty<string>());
            var p = state.Players[choice.Player];
            if (pick.Index is { } i && choice.At is { } at)
            {
                var id = cards[i];
                cards.RemoveAt(i);
                var self = state.Find(at);
                if (self is null) Effects.ToHand(state, choice.Player, id);
                else
                {
                    p.Discard.Add(id);
                    var was = Registry.Card(self.CardId);
                    self.CardId = Generated.GraftedCopy(
                        self.CardId, Generated.OilCopy(id),
                        self.Override?.Strength ?? was.Strength,
                        GameState.ColorOf(self, was),
                        GameState.LevelOf(self, was),
                        GameState.PowersOf(self, was));
                    self.Override = null;
                    Effects.Log(state, choice.Player,
                        $"{Registry.Card(id).Name} settles into the curse.");
                }
            }
            p.Deck.AddRange(cards);
        });
    }
}
