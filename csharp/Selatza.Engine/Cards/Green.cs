using System.Linq;
using static Selatza.Cards.Kit;

namespace Selatza.Cards;

/// <summary>Green is Robot: Machines, armour plating, damage that skips the clash.</summary>
public static class Green
{
    private static readonly ColorKit K = new(Color.R, "r", "Green", "Green/spells");

    /// <summary>
    /// Whether the body asking is the only summon its controller keeps in a slot.
    /// The leader seat is left out on purpose: a leader is always on the board, so
    /// counting it would make "no other summons" a condition nobody could ever meet.
    /// Asked from up there the question is only whether the slots are empty, which
    /// is what counting exactly one slot body got backwards.
    /// </summary>
    private static bool Alone(GameState state, int player, SummonInstance? self)
    {
        foreach (var s in state.Players[player].Slots)
        {
            if (s is not null && s.Uid != self?.Uid) return false;
        }
        return true;
    }

    public static CardDef[] Build() => new[]
    {
        K.Starter("player1", "Player One", F(Faction.Machine, Faction.Mortal), str: 1, hp: 4,
            text: "Battlecry: If you control no other summons, this gains a Power Shield "
                + "and +4 attack.",
            triggers: new Triggers
            {
                OnEnter = c =>
                {
                    if (c.Self is not { } me || !Alone(c.State, c.Me, c.Source)) return;
                    c.Shield(me, 1);
                    c.BuffStrength(me, 4, ModDuration.Permanent);
                },
            },
            powers: Powers(new Power
            {
                Name = "New Team",
                Cost = new Cost(R: 2),
                Text = "Return a supporter to your hand, then the top card of your deck "
                    + "becomes a supporter.",
                Targets = Specs(new TargetSpec
                {
                    Kind = TargetKind.Supporter,
                    Side = Side.Ally,
                    Label = "a supporter to take back",
                }),
                Effect = c =>
                {
                    c.ReturnSupporter(c.Target(0));
                    c.SupporterFromDeck(c.Me, sapped: false);
                },
            })),

        K.Summon(1, "automoton", "Automoton", F(Faction.Machine), str: 1, hp: 4,
            text: "",
            flipText: "The attached character gains a Power Shield.",
            flip: c => c.Shield(c.HolderRef, 1)),

        K.Summon(1, "chipcrunch", "Chipcrunch", F(Faction.Machine, Faction.Beast),
            text: "Battlecry: Shuffle the top card of your discard pile into your deck.",
            triggers: new Triggers { OnEnter = c => c.RecycleTopDiscard(c.Me) }, str: 1, hp: 2,
            flipText: "Destroy any enemy active mana pips and sap one of their supporters.",
            // Pool first: sapping alone is dodged by tapping out early in the turn.
            flipUseful: c => c.State.Players[c.Opp].Mana.Sum() > 0
                || c.State.Players[c.Opp].Supporters.Any(x => !x.Sapped),
            flip: c =>
            {
                // The mana always goes; the sap is only put to the player when
                // there is something left standing to spend it on.
                c.ClearMana(c.Opp);
                var standing = c.SupportersOf(c.Opp)
                    .Where(r => !c.State.Players[c.Opp].Supporters[r.Index].Sapped)
                    .ToArray();
                if (standing.Length > 0)
                {
                    c.Choose("sap-supporter", standing, "Sap which enemy supporter?");
                }
            }),

        K.Summon(1, "cogbeast", "Cogbeast", F(Faction.Machine, Faction.Beast), str: 2, hp: 3,
            flipText: "The attached character gains 1 HP off your deck.",
            flip: c => c.Reinforce(c.HolderRef, 1)),

        K.Summon(1, "computerbug", "Computer Bug", F(Faction.Machine, Faction.Hedron), str: 2,
            hp: 1,
            supporterLock: true,
            text: "Supporter Lock. The enemy cannot play supporters. At the start of your turn, you take 1 debt.",
            triggers: new Triggers
            {
                OnAwake = c => c.AddDebt(c.Me, 1, "The bug bills its keeper."),
            }),

        K.Summon(1, "defender", "Defender", F(Faction.Machine), str: 1, hp: 5,
            redirect: true,
            text: "Redirection. When attacked, gains 1 HP first.",
            triggers: new Triggers
            {
                OnDefend = c => { if (c.Self is { } me) c.Reinforce(me, 1); },
            },
            flipText: "The attached character gains a Power Shield.",
            flip: c => c.Shield(c.HolderRef, 1)),

        K.Summon(1, "lapgrob", "Lapgrob", F(Faction.Machine), str: 1, hp: 2,
            text: "Battlecry: Gains a Power Shield.",
            triggers: new Triggers
            {
                OnEnter = c => { if (c.Self is { } me) c.Shield(me, 1); },
            },
            flipText: "The attached character gains a Power Shield.",
            flip: c => c.Shield(c.HolderRef, 1)),

        K.Summon(1, "lightbolbe", "Lightbolbe", F(Faction.Machine), str: 1, hp: 2,
            powers: Powers(new Power
            {
                Name = "Burn Out",
                Cost = new Cost(),
                SapSelf = true,
                Text = "Destroy this summon and take 2 debt: add 1 colorless mana.",
                Effect = c =>
                {
                    c.State.Players[c.Me].Mana[Rules.Colorless] += 1;
                    c.AddDebt(c.Me, 2, "The bulb burns out.");
                    if (c.Self is { Kind: not TargetKind.Leader } me) c.Destroy(me);
                },
            }),
            flipText: "The attached character gains a Power Shield.",
            flip: c => c.Shield(c.HolderRef, 1)),

        K.Summon(1, "mouse", "Mouse", F(Faction.Machine, Faction.Beast),
            hp: 2,
            str: 2,
            powers: Powers(new Power
            {
                Name = "Click",
                Cost = new Cost(R: 1),
                Text = "Deal 1 to an enemy summon.",
                Targets = Specs(Enemy()),
                Effect = c => c.Damage(c.Target(0), 1),
            }),
            flipText: "The attached character gains a Power Shield.",
            flip: c => c.Shield(c.HolderRef, 1)),

        K.Summon(1, "pointer", "Pointer", F(Faction.Machine, Faction.Hedron), str: 1, hp: 2,
            text: "Battlecry: Prevent a sapped enemy summon from unsapping once.",
            targets: Specs(new TargetSpec
            {
                Kind = TargetKind.Summon,
                Side = Side.Enemy,
                Label = "a sapped enemy summon",
                Filter = a => a.Summon is not null && a.Summon.Sapped,
            }),
            triggers: new Triggers
            {
                OnEnter = c =>
                {
                    if (c.TargetOrNull(0) is not { } t) return;
                    var s = c.SummonAt(t);
                    if (s is not null) s.SapLock = true;
                },
            }),

        K.Summon(1, "slicebot", "Slicebot", F(Faction.Machine, Faction.Hedron), str: 4, hp: 1),

        K.Summon(2, "badglitch", "Bad Glitch", F(Faction.Machine), str: 2,
            hp: 3,
            text: "Battlecry: An enemy summon loses 2 attack.",
            targets: Specs(Enemy()),
            powers: Powers(new Power
            {
                Name = "Corrupt Data",
                Cost = new Cost(R: 1),
                Text = "An enemy summon loses 1 attack.",
                SapSelf = true,
                Targets = Specs(Enemy()),
                Effect = c => c.BuffStrength(c.Target(0), -1, ModDuration.Permanent),
            }),
            triggers: new Triggers
            {
                OnEnter = c =>
                {
                    if (c.TargetOrNull(0) is { } t) c.BuffStrength(t, -2, ModDuration.Permanent);
                },
            },
            flipText: "Each of your characters gains a Power Shield.",
            flipCost: new FlipCost { Mana = new Cost(R: 2) },
            flip: c =>
            {
                foreach (var t in c.SummonsOf(c.Me, true)) c.Shield(t, 1);
            }),

        K.Summon(2, "bellobot", "Bellobot", F(Faction.Machine), str: 1, hp: 2,
            text: "Ally Machines have +1 attack.",
            triggers: new Triggers
            {
                StrengthBonus = a => a.Summon.Owner == a.Controller
                    && a.Def.HasFaction(Faction.Machine)
                    && a.Summon.CardId != "r2-bellobot" ? 1 : 0,
            }),

        K.Summon(2, "blackhat", "Black Hat", F(Faction.Mortal, Faction.Scholar),
            str: 2,
            hp: 2,
            powers: Powers(new Power
            {
                Name = "Exploit",
                Cost = new Cost(R: 1, C: 1),
                Text = "Move an HP card from an enemy summon onto an ally summon.",
                Targets = Specs(Enemy(), Ally()),
                Effect = c => c.MoveHp(c.Target(0), c.Target(1), 1),
            })),

        K.Summon(2, "digital nomad", "Digital Nomad", F(Faction.Mortal, Faction.Machine),
            str: 2,
            hp: 3,
            text: "Deathrattle: An ally gains a Power Shield.",
            triggers: new Triggers
            {
                OnDeath = c =>
                {
                    c.Choose("shield-1", c.SummonsOf(c.Me, true), "Give which ally a Power Shield?");
                },
            }),

        K.Summon(2, "digitalrabbits", "Digital Rabbits", F(Faction.Machine, Faction.Beast),
            str: 1, hp: 3,
            reborn: true,
            text: "Reborn. Battlecry: Put a Digital Rabbits from your deck into an empty slot.",
            triggers: new Triggers
            {
                OnEnter = c =>
                {
                    if (c.EmptySlot(c.Me) is null) return;
                    c.Search(c.Me, d => d.Id == "r2-digitalrabbits",
                        effect: "rabbits", prompt: "Put a Digital Rabbits into an empty slot");
                },
            }),

        K.Summon(2, "engineer", "Engineer", F(Faction.Mortal, Faction.Scholar), str: 2,
            hp: 3,
            powers: Powers(new Power
            {
                Name = "Fabricate",
                Cost = new Cost(R: 1, C: 1),
                Text = "Scry 3 for a Machine and play it into an empty slot with 2 extra HP.",
                SapSelf = true,
                Effect = c =>
                {
                    c.Dig(c.Me, 3, d => d.HasFaction(Faction.Machine) && d.Type == CardType.Summon,
                        effect: "fabricate", prompt: "Fabricate a Machine with 2 extra HP");
                },
            })),

        K.Summon(2, "forklift", "Forklift", F(Faction.Machine), str: 1, hp: 4,
            powers: Powers(new Power
            {
                Name = "Reposition",
                Cost = default,
                Text = "Return an unsapped supporter to your hand. You may play another supporter this turn.",
                SapSelf = true,
                Targets = Specs(new TargetSpec
                {
                    Kind = TargetKind.Supporter,
                    Side = Side.Ally,
                    Label = "an unsapped supporter",
                    Filter = a => a.Ref.Index >= 0
                        && a.Ref.Index < a.State.Players[a.Me].Supporters.Count
                        && !a.State.Players[a.Me].Supporters[a.Ref.Index].Sapped,
                }),
                Effect = c =>
                {
                    if (c.ReturnSupporter(c.Target(0))) c.State.Players[c.Me].SupportersLeft += 1;
                },
            })),

        K.Summon(2, "hobbyist", "Scoobert Engineer", F(Faction.Mortal),
            str: 2,
            hp: 3,
            powers: Powers(new Power
            {
                Name = "Machine Learning",
                Cost = new Cost(R: 1),
                Text = "Draw a copy of the top card of the enemy's deck, rebuilt in Robot.",
                SapSelf = true,
                Effect = c =>
                {
                    var deck = c.State.Players[c.Opp].Deck;
                    if (deck.Count == 0)
                    {
                        c.Log("Nothing left to salvage.");
                        return;
                    }
                    var id = deck[0];
                    deck.RemoveAt(0);
                    c.ToHand(c.Me, Generated.RobotCopy(id));
                    c.State.Players[c.Opp].Discard.Add(id);
                    c.Log($"{Registry.Card(id).Name} is salvaged and rebuilt in Robot.");
                },
            })),

        K.Summon(2, "nommer", "Nommer", F(Faction.Machine, Faction.Beast, Faction.Hedron), str: 3, hp: 2,
            muffleFlips: true,
            text: "FLIP effects of its combat damage are muted on any character, and it heals 1 HP for each.",
            powers: Powers(new Power
            {
                Name = "Chew",
                Cost = new Cost(R: 1),
                Text = "Deal 2 to an enemy summon. This one heals 1.",
                SapSelf = true,
                Targets = Specs(Enemy()),
                Effect = c =>
                {
                    c.Damage(c.Target(0), 2);
                    if (c.Self is { } me) c.Unflip(me, 1);
                },
            })),

        K.Summon(2, "securitybot", "Security Bot", F(Faction.Machine), str: 1, hp: 4,
            text: "Battlecry: Gains a Power Shield. When attacked, deal 2 to the attacker.",
            triggers: new Triggers
            {
                OnEnter = c => { if (c.Self is { } me) c.Shield(me, 1); },
                OnDefend = c => { if (c.State.BattleAttacker is { } a) c.Damage(a, 2); },
            },
            flipText: "The attached character gains a Power Shield.",
            flip: c => c.Shield(c.HolderRef, 1)),

        K.Summon(3, "chemicalmen", "Chemical Men", F(Faction.Machine, Faction.Mortal),
            str: 2, hp: 4,
            reborn: true,
            text: "Reborn. Deathrattle: Your Machines gain a Power Shield.",
            triggers: new Triggers
            {
                OnDeath = c =>
                {
                    foreach (var r in c.SummonsOf(c.Me, true))
                    {
                        var s = c.SummonAt(r);
                        if (s is not null && Registry.Card(s.CardId).HasFaction(Faction.Machine))
                        {
                            c.Shield(r, 1);
                        }
                    }
                },
            }),

        K.Summon(3, "cybersiren", "Cyber Siren", F(Faction.Machine), str: 2, hp: 5,
            powers: Powers(new Power
            {
                Name = "Enthrall",
                Cost = new Cost(R: 3, C: 1),
                Text = "Take control of an enemy summon, sap it, and rebuild it "
                    + "and its HP cards in Robot.",
                Targets = Specs(Enemy()),
                SapSelf = true,
                Effect = c =>
                {
                    // Held before the seize, because the ref points at a slot the
                    // summon is about to leave; the body itself is the same object.
                    var taken = c.SummonAt(c.Target(0));
                    if (taken is not null && c.TakeControl(c.Target(0)))
                    {
                        taken.CardId = Generated.RobotCopy(taken.CardId);
                        // The HP cards ride along with the body, so they are
                        // rebuilt too rather than staying in their old colours.
                        foreach (var h in taken.Hp) h.CardId = Generated.RobotCopy(h.CardId);
                    }
                },
            })),

        K.Summon(3, "greenstar", "Green Star", F(Faction.Star, Faction.Machine), str: 2, hp: 6,
            text: "At the start of your turn, each of your characters gains 1 HP.",
            powers: Powers(new Power
            {
                Name = "Solar Flare",
                Cost = new Cost(R: 2),
                Text = "Deal 1 to every enemy summon.",
                SapSelf = true,
                Effect = c => { foreach (var r in c.SummonsOf(c.Opp)) c.Damage(r, 1); },
            }),
            triggers: new Triggers
            {
                OnAwake = c => { foreach (var r in c.SummonsOf(c.Me, true)) c.Reinforce(r, 1); },
            }),

        K.Summon(3, "hatemachine", "Hate Machine", F(Faction.Machine), str: 5, hp: 3,
            text: "At the start of your turn, you take 2 debt.",
            triggers: new Triggers
            {
                OnAwake = c => c.AddDebt(c.Me, 2, "The hate machine bills its keeper."),
            },
            powers: Powers(new Power
            {
                Name = "Vent",
                Cost = new Cost(),
                Text = "Deal 3 to an enemy summon.",
                SapSelf = true,
                Targets = Specs(Enemy()),
                Effect = c => c.Damage(c.Target(0), 3),
            })),

        K.Summon(3, "infinitemind", "Infinite Mind", F(Faction.Machine, Faction.Scholar),
            str: 6, hp: 6,
            voidsDiscard: true,
            text: "At the start of your turn, draw a card. Your cards that go to "
                + "the discard pile are annihilated.",
            triggers: new Triggers { OnAwake = c => c.Draw(c.Me, 1) }),

        K.Summon(3, "maliciouscode", "Malicious Code", F(Faction.Machine), str: 3, hp: 4,
            powers: Powers(new Power
            {
                Name = "Overwrite",
                Cost = new Cost(R: 1),
                Text = "An enemy summon loses 2 attack.",
                Targets = Specs(Enemy()),
                SapSelf = true,
                Effect = c => c.BuffStrength(c.Target(0), -2, ModDuration.Permanent),
            })),

        K.Summon(3, "scoobertsingularity", "Scoobert Singularity",
            F(Faction.Machine, Faction.Star), str: 2, hp: 4,
            spellEcho: true,
            text: "Your spells cast twice. When you play a Machine, draw a card and Mill 1.",
            triggers: new Triggers
            {
                OnSummonPlayed = c =>
                {
                    var played = c.SummonAt(c.Target(0));
                    if (played is null || played.Owner != c.Me) return;
                    if (!Registry.Card(played.CardId).HasFaction(Faction.Machine)) return;
                    c.Draw(c.Me, 1);
                    c.Mill(c.Me, 1);
                },
            }),

        K.Summon(3, "shapethink", "Shapethink", F(Faction.Hedron, Faction.Scholar), str: 2, hp: 5,
            text: "At the start of your turn, Scry 3 for any card. "
                + "When an enemy uses a Power, deal 1 to them.",
            triggers: new Triggers
            {
                OnAwake = c => c.Dig(c.Me, 3, _ => true),
                OnEnemyPower = c =>
                {
                    if (c.TargetOrNull(0) is { } used) c.Damage(used, 1);
                },
            }),

        K.Summon(3, "strangestation", "Strange Station", F(Faction.Machine, Faction.Star),
            str: 2, hp: 7, stationary: true, redirect: true,
            text: "Redirection. Stationary. Your summons have +1 attack.",
            triggers: new Triggers
            {
                StrengthBonus = a => a.Summon.Owner == a.Controller && !a.Summon.IsLeader ? 1 : 0,
            }),

        K.Spell("plugzap", "Plug Zap", new Cost(R: 2, C: 1), "Deal 2 to a character.",
            Specs(AnyOrLeader("a character")), c => c.Damage(c.Target(0), 2)),

        K.Spell("battery", "Battery", new Cost(),
            "An ally gains 2 HP off your deck, then draw a card.",
            Specs(AllyOrLeader()), c =>
            {
                c.Reinforce(c.Target(0), 2);
                c.Draw(c.Me, 1);
            }),

        K.Spell("download", "Download", new Cost(R: 1),
            "Search the enemy's debt for a card and rebuild it in Robot: "
            + "it costs its total in Robot for you.",
            null, c =>
            {
                var zone = c.State.Players[c.Opp].DebtZone;
                var refs = new TargetRef[zone.Count];
                for (int i = 0; i < zone.Count; i++) refs[i] = TargetRef.Debt(c.Opp, i);
                if (refs.Length == 0)
                {
                    c.Log("Nothing to download.");
                    return;
                }
                c.Choose("download", refs, "Download which card?");
            }),

        K.Spell("grab", "Grab", new Cost(R: 2),
            "Move 2 HP cards from an enemy summon onto an ally summon.",
            Specs(Enemy(), Ally()), c => c.MoveHp(c.Target(0), c.Target(1), 2),
            flipText: "Each of your characters gains a Power Shield.",
            flipCost: new FlipCost { Mana = new Cost(R: 2) },
            flip: c =>
            {
                foreach (var t in c.SummonsOf(c.Me, true)) c.Shield(t, 1);
            }),

        K.Spell("npcgenerator", "NPC Generator", new Cost(R: 1, C: 1),
            "Fill your empty slots with Automotons. Heal 1 debt.", null, c =>
            {
                // One pass over the slots: a 0-HP arrival dies on the spot when
                // the deck is out of cards, and its slot must not be offered a
                // second body.
                var slots = c.State.Players[c.Me].Slots;
                for (int slot = 0; slot < slots.Length; slot++)
                {
                    if (slots[slot] is null) c.PutSummon(c.Me, "r1-automoton", slot, 1, Color.R, 4, 1);
                }
                c.ClearDebt(c.Me, 1);
            }),

        K.Trap("siphon", "Trap: Wiretap", new Cost(R: 1),
            "Spell Trap. Counter the spell and add a copy of it to your hand, rebuilt in Robot.",
            null, c =>
            {
                var sp = c.State.Pending?.Spell;
                if (sp is null) return;
                c.ToHand(c.Me, Generated.RobotCopy(sp.CardId));
                c.Log($"{Registry.Card(sp.CardId).Name} is copied and rebuilt in Robot.");
            }, spellTrap: true),

        K.Spell("videogame", "Video Game", new Cost(R: 1),
            "Draw 2 cards, then put a card from your hand under an ally as HP.",
            Specs(AllyOrLeader()), c =>
            {
                c.Draw(c.Me, 2);
                var hand = c.State.Players[c.Me].Hand;
                var refs = new TargetRef[hand.Count];
                for (int i = 0; i < hand.Count; i++) refs[i] = TargetRef.Hand(c.Me, i);
                if (refs.Length == 0) return;
                c.Choose("stack-hp-from-hand", refs, "Put which card under it as HP?",
                    optional: true, at: c.Target(0));
            }),

        K.Trap("stundevice", "Trap: Stun Device", new Cost(R: 1),
            "The defending summon gains a Power Shield.", null, c =>
            {
                if (c.State.BattleDefender is { } d) c.Shield(d, 1);
            }),

        K.Stage("connect", "Field: Connect", new Cost(R: 1, C: 1), "Your Machines have +1 attack.",
            new StageHooks
            {
                StrengthBonus = a => a.Summon.Owner == a.Controller
                    && a.Def.HasFaction(Faction.Machine) ? 1 : 0,
            },
            flipText: "The attached character gains a Power Shield.",
            flip: c => c.Shield(c.HolderRef, 1)),

        K.Stage("thedodecahedron", "Field: The Dodecahedron", new Cost(R: 1, C: 1),
            "Your Machines gain a Power Shield when played. When you play a Hedron, "
                + "shuffle a card from your discard pile into your deck.",
            new StageHooks
            {
                OnSummonPlayed = c =>
                {
                    var r = c.Target(0);
                    if (r.Player != c.Me) return;
                    var s = c.SummonAt(r);
                    if (s is null) return;
                    var def = Registry.Card(s.CardId);
                    if (def.HasFaction(Faction.Machine)) c.Shield(r, 1);
                    if (def.HasFaction(Faction.Hedron)) c.RecycleTopDiscard(c.Me);
                },
            }),
    };
}
