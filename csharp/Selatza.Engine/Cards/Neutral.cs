using static Selatza.Cards.Kit;

namespace Selatza.Cards;

/// <summary>
/// Neutral belongs to no colour, so every deck may run it. Vanilla bodies sit
/// at or a point above the colour baseline, because carrying no text is itself
/// the price; anything with text sits a point under it instead.
/// </summary>
public static class Neutral
{
    private static readonly NeutralKit N = new();

    public static CardDef[] Build() => new[]
    {
        N.Summon(1, "BeautifulBug", "Beautiful Bug", F(Faction.Beast), str: 2, hp: 4),
        N.Summon(1, "BucketGuardian", "Bucket Guardian", F(Faction.Hedron), str: 1, hp: 3,
            redirect: true,
            text: "Redirection."),
        N.Summon(1, "CorruptGrinkling", "Corrupt Grinkling", F(Faction.Beast), str: 3, hp: 3,
            text: "Deathrattle: You take 1 debt.",
            triggers: new Triggers { OnDeath = c => c.AddDebt(c.Me, 1) }),
        N.Summon(1, "FishBones", "Fish Bones", F(Faction.Fish), str: 1, hp: 4,
            flipText: "Shuffle 2 random cards from your discard pile into your deck.",
            flip: c => c.RecycleDiscard(c.Me, 2)),
        N.Summon(1, "LittleBunny", "Little Bunny", F(Faction.Beast), str: 1, hp: 2,
            text: "Strike: Gains +1 attack.",
            triggers: new Triggers
            {
                OnAttack = c => { if (c.Self is { } me) c.BuffStrength(me, 1, ModDuration.Permanent); },
            }),
        N.Summon(1, "Thing", "Thing", null, str: 2, hp: 3,
            flipText: "Heal the attached character for 2.",
            flipCost: new FlipCost { Mana = new Cost(C: 1) },
            flip: c => c.Unflip(c.HolderRef, 2)),
        N.Summon(1, "Wallguy", "Wallguy", F(Faction.Hedron), str: 1, hp: 7,
            stationary: true, redirect: true,
            text: "Redirection. Stationary."),
        N.Summon(1, "lizard", "Lizard", F(Faction.Beast), str: 2, hp: 4),
        N.Summon(1, "mammal", "Mammal", F(Faction.Beast), str: 2, hp: 5),
        N.Summon(1, "weirdBird", "Weird Bird", F(Faction.Beast), str: 2, hp: 3,
            entersSapped: true,
            text: "Arrives sapped. Battlecry: Scry 2 for any card.",
            triggers: new Triggers { OnEnter = c => c.Dig(c.Me, 2, _ => true) }),
        N.Summon(2, "Deedsigner", "Deedsigner", F(Faction.Mortal), str: 2, hp: 2,
            text: "Battlecry: Heal 1 debt.",
            triggers: new Triggers { OnEnter = c => c.ClearDebt(c.Me, 1) }),
        N.Summon(2, "HonorableKnight", "Honorable Knight", F(Faction.Mortal),
            flipText: "Discard this card, then heal the attached character 1.",
            flip: c =>
            {
                if (c.DiscardThis()) c.Unflip(c.HolderRef, 1);
            }, str: 3, hp: 3),
        N.Summon(2, "LesserGrinkle", "Lesser Grinkle", F(Faction.Beast, Faction.Grinkle), str: 2, hp: 4),
        N.Summon(2, "LowWizard", "Low Wizard", F(Faction.Mortal, Faction.Scholar), str: 3, hp: 3,
            flipText: "Deal 2 to the attacking summon.",
            flip: c =>
            {
                if (c.State.BattleAttacker is { } a) c.Damage(a, 2);
                else c.Log("No one to zap.");
            }),
        N.Summon(2, "NobodysFriend", "Nobody's Friend", F(Faction.Mortal), str: 2, hp: 4,
            text: "At the start of your turn, if you control no other summons, gains +2 attack and heals 1.",
            triggers: new Triggers
            {
                OnAwake = c =>
                {
                    if (c.Self is not { } me || c.SummonAt(me) is not { } s) return;
                    int others = 0;
                    foreach (var x in c.State.Players[c.Me].Slots)
                    {
                        if (x is not null && !ReferenceEquals(x, s)) others++;
                    }
                    if (others > 0) return;
                    c.BuffStrength(me, 2, ModDuration.Permanent);
                    c.Unflip(me, 1);
                },
            }),
        N.Summon(2, "SecretLetter", "Secret Letter", null, str: 3, hp: 2,
            entersSapped: true,
            text: "Arrives sapped. Battlecry: Draw a card.",
            triggers: new Triggers { OnEnter = c => c.Draw(c.Me, 1) }),
        N.Summon(2, "Smithee", "Smithee", F(Faction.Mortal), str: 2, hp: 3,
            text: "Battlecry: Heal an ally for 2.",
            targets: Specs(new TargetSpec
            {
                Kind = TargetKind.Summon,
                Side = Side.Ally,
                IncludeLeader = true,
                Label = "an ally with flipped HP",
                Filter = a => a.Summon is not null && a.Summon.Hp.Any(h => h.Flipped),
            }),
            triggers: new Triggers { OnEnter = c =>
            {
                if (c.TargetOrNull(0) is { } t) c.Unflip(t, 2);
            } }),
        N.Summon(2, "Sorter", "Sorter", F(Faction.Mortal), str: 2, hp: 3,
            entersSapped: true,
            text: "Arrives sapped. Battlecry: Scry 3 for any card.",
            triggers: new Triggers { OnEnter = c => c.Dig(c.Me, 3, _ => true) }),
        N.Summon(2, "Starfly", "Starfly", F(Faction.Star), str: 3, hp: 1,
            flipText: "Spend this card to gain a colorless supporter.",
            flip: c =>
            {
                int at = c.Holder.Hp.FindIndex(h => h.CardId == c.Card.Id && h.Flipped);
                if (at < 0) return;
                c.Holder.Hp.RemoveAt(at);
                c.State.Players[c.Me].Supporters.Add(new Supporter { CardId = c.Card.Id, Sapped = false });
                c.Log("Starfly flutters into the supporter row.");
            }),
        N.Summon(2, "UngratefulBeast", "Ungrateful Beast", F(Faction.Beast), str: 4, hp: 3,
            text: "Deathrattle: You take 1 debt.",
            triggers: new Triggers { OnDeath = c => c.AddDebt(c.Me, 1) }),
        N.Summon(3, "AcolyteofGrinkle", "Acolyte of Grinkle", F(Faction.Grinkle, Faction.Scholar), str: 3, hp: 6),
        N.Summon(3, "FlyingCastle", "Flying Castle", null, str: 2, hp: 5,
            redirect: true,
            text: "Redirection."),
        N.Summon(3, "GambleLord", "Gamble Lord", F(Faction.Mortal), str: 3, hp: 4,
            powers: Powers(new Power
            {
                Name = "Gamble",
                Cost = new Cost(),
                SapSelf = true,
                Text = "Discard 2 cards, then draw 2 cards.",
                Targets = Specs(HandCard("a card to throw in"), HandCard("another card to throw in")),
                Effect = c =>
                {
                    var a = c.Target(0);
                    var b = c.Target(1);
                    if (a.Kind != TargetKind.Hand || b.Kind != TargetKind.Hand || a.Index == b.Index)
                    {
                        return;
                    }
                    c.Discard(c.Me, Math.Max(a.Index, b.Index));
                    c.Discard(c.Me, Math.Min(a.Index, b.Index));
                    c.Draw(c.Me, 2);
                },
            })),
        N.Summon(3, "GrinkleBeast", "Grinkle Beast", F(Faction.Beast, Faction.Grinkle),
            text: "Whenever an ally Grinkle dies, gains +1 attack.",
            triggers: new Triggers
            {
                OnOtherDeath = c =>
                {
                    if (c.State.DyingOwner != c.Me) return;
                    var dead = c.State.DyingCardId;
                    if (dead is null || !Registry.Card(dead).HasFaction(Faction.Grinkle)) return;
                    if (c.Self is { } me) c.BuffStrength(me, 1, ModDuration.Permanent);
                },
            }, str: 3, hp: 5),
        N.Summon(3, "IneptRuler", "Inept Ruler", F(Faction.Mortal), str: 4, hp: 6,
            text: "At the start of your turn, you take 1 debt.",
            triggers: new Triggers { OnAwake = c => c.AddDebt(c.Me, 1) },
            powers: Powers(new Power
            {
                Name = "Misrule",
                Cost = new Cost(C: 2),
                Text = "Shuffle 2 random cards from your discard pile into your deck.",
                Effect = c => c.RecycleDiscard(c.Me, 2),
            })),
        N.Summon(3, "Ivy", "Ivy", F(Faction.Living), str: 4, hp: 3,
            text: "Choral: Your level 1 summons have +1 attack and gain 1 HP at the start of your turn.",
            triggers: new Triggers
            {
                StrengthBonus = a => a.Summon.Owner == a.Controller && !a.Summon.IsLeader
                    && GameState.LevelOf(a.Summon, a.Def) == 1 ? 1 : 0,
                OnAwake = c =>
                {
                    foreach (var r in c.SummonsOf(c.Me))
                    {
                        var s = c.SummonAt(r);
                        if (s is not null && GameState.LevelOf(s, Registry.Card(s.CardId)) == 1)
                        {
                            c.Reinforce(r, 1);
                        }
                    }
                },
            }),
        N.Summon(3, "NerveLite", "Nerve Lite", F(Faction.Hedron), str: 3, hp: 5,
            powers: Powers(new Power
            {
                Name = "Reclaim",
                Cost = new Cost(C: 3),
                Text = "Return a card from your discard pile to your hand.",
                SapSelf = true,
                Targets = Specs(new TargetSpec
                {
                    Kind = TargetKind.Discard,
                    Side = Side.Ally,
                    Label = "a card in your discard pile",
                }),
                Effect = c =>
                {
                    if (c.Targets.Length > 0) c.Reclaim(c.Target(0));
                },
            })),
        N.Summon(3, "PowerBird", "Power Bird", F(Faction.Beast, Faction.Star), str: 3, hp: 4,
            flipText: "The attached character gains +1 attack.",
            flip: c => c.BuffStrength(c.HolderRef, 1, ModDuration.Permanent)),
        N.Summon(3, "Relica", "Relica", null, str: 2, hp: 4,
            powers: Powers(new Power
            {
                Name = "Attune",
                Cost = new Cost(),
                Text = "Give an ally +1/+1.",
                SapSelf = true,
                Targets = Specs(AllyOrLeader()),
                Effect = c =>
                {
                    c.Reinforce(c.Target(0), 1);
                    c.BuffStrength(c.Target(0), 1, ModDuration.Permanent);
                },
            })),
        N.Summon(3, "Seam", "Seam", F(Faction.Machine, Faction.Hedron), str: 2, hp: 7,
            powers: Powers(new Power
            {
                Name = "Compress",
                Cost = new Cost(C: 3),
                Text = "Gains +2 attack.",
                Effect = c => { if (c.Self is { } me) c.BuffStrength(me, 2, ModDuration.Permanent); },
            })),
        N.Spell("Bucket", "Bucket", new Cost(C: 1), "An ally gains 2 HP off your deck.",
            Specs(AllyOrLeader()), c => c.Reinforce(c.Target(0), 2)),
        N.Spell("ColdBread", "Cold Bread", new Cost(), "Draw a card.",
            null, c => c.Draw(c.Me, 1)),
        N.Stage("HomeOnAHill", "Field: Home on a Hill", new Cost(C: 1),
            "At the start of your turn, your leader heals 2.",
            new StageHooks
            {
                OnAwake = c => c.Unflip(TargetRef.Leader(c.Me), 2),
            }),
        N.Trap("Mousetrap", "Trap: Mousetrap", new Cost(C: 1), "The attacking summon loses 2 attack.",
            null, c =>
            {
                if (c.State.BattleAttacker is { } a) c.BuffStrength(a, -2, ModDuration.Permanent);
            }),
        N.Spell("RockThrow", "Rock Throw", new Cost(C: 2), "Deal 2 to an enemy summon.",
            Specs(Enemy()), c => c.Damage(c.Target(0), 2)),
    };
}
