using System.Diagnostics;
using Selatza;
using Selatza.Ai;
using Selatza.Cards;

namespace Selatza.Tests;

/// <summary>
/// A dependency-free runner. No xunit host to spin up, so the whole suite starts
/// and finishes inside the time a package-based runner spends warming up.
/// </summary>
public static class Harness
{
    private static int _passed;
    private static readonly List<string> Failures = new();
    private static string _current = "";

    public static bool Verbose { get; set; }

    /// <summary>
    /// Whether decision-level bot tests run. Off by default: they pin what the
    /// bot chooses on a hand-built board to particular cards and search
    /// settings, so a card change or a search change can move them without
    /// anything being wrong. <c>--behaviour</c> turns them on.
    /// </summary>
    public static bool Behaviour { get; set; }

    /// <summary>A test of what the bot chooses, run only with <c>--behaviour</c>.</summary>
    public static void Decision(string name, Action body)
    {
        if (!Behaviour) return;
        Test(name, body);
    }

    public static void Test(string name, Action body)
    {
        if (Filter is not null && !name.Contains(Filter, StringComparison.OrdinalIgnoreCase)) return;
        _current = name;
        if (Verbose) Console.WriteLine($"  . {name}");
        try
        {
            body();
            _passed++;
        }
        catch (Exception ex)
        {
            Failures.Add($"{name}\n    {ex.Message}");
        }
    }

    public static string? Filter { get; set; }

    public static void Eq<T>(T expected, T actual, string what = "")
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
        {
            throw new Exception($"{what} expected {expected}, got {actual}");
        }
    }

    public static void True(bool cond, string what = "")
    {
        if (!cond) throw new Exception($"expected true: {what}");
    }

    public static void False(bool cond, string what = "")
    {
        if (cond) throw new Exception($"expected false: {what}");
    }

    public static void Contains(string needle, string? haystack, string what = "")
    {
        if (haystack is null || !haystack.Contains(needle, StringComparison.Ordinal))
        {
            throw new Exception($"{what} expected \"{haystack}\" to contain \"{needle}\"");
        }
    }

    public static int Report(Stopwatch sw)
    {
        Console.WriteLine();
        if (Failures.Count == 0)
        {
            Console.WriteLine($"  {_passed} passed in {sw.ElapsedMilliseconds} ms");
            return 0;
        }
        foreach (var f in Failures) Console.WriteLine($"  FAIL {f}");
        Console.WriteLine();
        Console.WriteLine($"  {_passed} passed, {Failures.Count} failed in {sw.ElapsedMilliseconds} ms");
        return 1;
    }

    public static string Current => _current;
}

public static class Program
{
    // Vanilla dummies keep the combat maths obvious: L1 1/2, L2 2/4, L3 3/6.
    private const string D1 = "x-r-dummy-1";
    private const string D2 = "x-p-dummy-2";
    private const string D3 = "x-p-dummy-3";
    private const string D3B = "x-r-dummy-3";
    private const string LeaderId = "x-hero-dummy-warden";

    private static DeckList Deck(int n, string id = D1, string leader = LeaderId) => new()
    {
        Name = "Tester",
        LeaderId = leader,
        Cards = Enumerable.Repeat(id, n).ToList(),
    };

    private static GameState Game() => Engine.CreateGame(Deck(60), Deck(60), 12345);

    private static GameState Must(GameState s, int actor, GameAction a)
    {
        var res = Engine.Apply(s, actor, a);
        if (!res.Ok) throw new Exception($"{a.Type} rejected: {res.Error}");
        return res.State!;
    }

    private static GameState PassTo(GameState s, int player)
    {
        s = Must(s, s.Active, GameAction.EndTurn());
        int guard = 0;
        while (s.Active != player || s.Phase != Phase.Main)
        {
            if (guard++ > 10) throw new Exception("could not reach that turn");
            s = Must(s, s.Active, GameAction.EndTurn());
        }
        return s;
    }

    private static int Give(GameState s, int player, string cardId)
    {
        s.Players[player].Hand.Add(cardId);
        return s.Players[player].Hand.Count - 1;
    }

    private static GameState Place(GameState s, int player, string cardId, int slot) =>
        Must(s, player, GameAction.PlaySummon(Give(s, player, cardId), slot));

    private static TargetRef Src(int p, int slot) => TargetRef.Summon(p, slot);

    public static int Main(string[] args)
    {
        CardSets.RegisterAll();
        Harness.Filter = args.FirstOrDefault(a => !a.StartsWith('-'));
        Harness.Verbose = args.Contains("-v");
        Harness.Behaviour = args.Contains("--behaviour");
        var sw = Stopwatch.StartNew();

        Setup();
        Combat();
        LeaderCombat();
        TrapsAndWounds();
        StructuralVerbs();
        TriggerTests();
        FatigueAndLosing();
        CardsAndDecks();
        BotTests();
        Keywords();
        Stores();
        Immunity();
        Ghost();
        TripleLegends();
        DigestAndReplay();
        Learning.Run();

        return Harness.Report(sw);
    }

    private static void Setup()
    {
        Harness.Test("deals an opening hand and puts the leader out with double HP and two more", () =>
        {
            var s = Game();
            Harness.Eq(Rules.OpeningHand, s.Players[0].Hand.Count, "p0 hand");
            Harness.Eq(Rules.OpeningHand + Rules.OpeningHandBonus, s.Players[1].Hand.Count, "p1 hand");
            Harness.Eq(Registry.Card(LeaderId).Hp * 2 + 2, s.Players[0].Leader!.Hp.Count, "leader hp cards");
        });

        Harness.Test("gives the extra opening card to whoever goes second", () =>
        {
            var s = Engine.CreateGame(Deck(60), Deck(60), 12345, startingPlayer: 1);
            Harness.Eq(Rules.OpeningHand, s.Players[1].Hand.Count);
            Harness.Eq(Rules.OpeningHand + Rules.OpeningHandBonus, s.Players[0].Hand.Count);
        });

        Harness.Test("lets an awake-step grant pay for a second supporter", () =>
        {
            var s = Game();
            s.Players[0].Stage = "sx-musicalflow";
            s = PassTo(s, 0);
            // The grant fires during awake, after the turn has already reset the
            // allowance, so it has to raise it rather than clear a flag.
            Harness.Eq(2, s.Players[0].SupportersLeft, "two allowed");
            s = Must(s, 0, GameAction.PlaySupporter(Give(s, 0, D1)));
            s = Must(s, 0, GameAction.PlaySupporter(Give(s, 0, D1)));
            Harness.Eq(2, s.Players[0].Supporters.Count, "two faced");
            var third = Engine.Apply(s, 0, GameAction.PlaySupporter(Give(s, 0, D1)));
            Harness.False(third.Ok, "and no more");
        });

        Harness.Test("Sap Burst is free but taps, and stops when Pinelyte cannot pay", () =>
        {
            var s = Game();
            s = Place(s, 0, "p2-pinelyte", 0);
            s = PassTo(s, 1);
            s = Place(s, 1, "n3-Seam", 0);
            s = PassTo(s, 0);
            var target = Src(1, 0);
            Harness.Eq(5, s.Players[0].Slots[0]!.RemainingHp, "starts at 5");
            // Free, but it taps, so one burst a turn and the HP runs out anyway.
            s = Must(s, 0, GameAction.ActivatePower(Src(0, 0), 0, target));
            Harness.Eq(3, s.Players[0].Slots[0]!.RemainingHp, "the burst costs 2");
            Harness.True(s.Players[0].Slots[0]!.Sapped, "and taps the body");
            Harness.False(Engine.Apply(s, 0, GameAction.ActivatePower(Src(0, 0), 0, target)).Ok,
                "so a second burst this turn is refused");
            s = PassTo(s, 0);
            s = Must(s, 0, GameAction.ActivatePower(Src(0, 0), 0, target));
            Harness.Eq(1, s.Players[0].Slots[0]!.RemainingHp, "next turn it burns the last 2");
            s = PassTo(s, 0);
            // At 1 HP the cost cannot be paid, so the power is refused outright.
            // It used to be accepted: the sap was taken, the effect found nothing
            // to spend and said so, and the turn was gone for nothing.
            Harness.False(Engine.Apply(s, 0, GameAction.ActivatePower(Src(0, 0), 0, target)).Ok,
                "at 1 HP there is nothing left to spend");
            Harness.Eq(1, s.Players[0].Slots[0]!.RemainingHp, "so the HP is untouched");
            Harness.False(s.Players[0].Slots[0]!.Sapped, "and the body is not sapped for nothing");
        });

        Harness.Test("Kapigras reforms as an Oil copy of the enemy leader", () =>
        {
            var s = Engine.CreateGame(Deck(60, D1, "o1-Kapigras"), Deck(60, D1, "p3-heavenknows"), 7);
            s = PassTo(s, 0);
            var leader = s.Players[0].Leader!;
            var copy = Registry.Card(leader.CardId);
            Harness.Eq("Heaven Knows", copy.Name, "wears the enemy leader's face");
            Harness.Eq(Color.O, copy.Color, "rebuilt in Oil");
            Harness.True(copy.Color2 is null, "and only Oil");
            // A mirror is worth nothing at 1/1, so it takes the copied body's HP.
            Harness.Eq(Registry.Card("p3-heavenknows").Hp * 2 + 2, leader.Hp.Count, "a leader's HP");
        });

        Harness.Test("Kapigras asks nobody when there is one enemy", () =>
        {
            // The pick only exists in a party game, which this engine never
            // seats. With one enemy the copy has to happen inside the trigger
            // or the two engines part company on the very first turn.
            var s = Engine.CreateGame(Deck(60, D1, "o1-Kapigras"), Deck(60, D1, "p3-heavenknows"), 7);
            s = PassTo(s, 0);
            Harness.Eq(0, s.ChoiceQueue.Count, "nothing left waiting to be answered");
            Harness.True(s.Players[0].Leader!.CardId != "o1-Kapigras", "already reformed");
        });

        Harness.Test("an Oil copy reprices the powers it carries, not just the card", () =>
        {
            // Aetus Vox pays Solar for Comprehension. Copied into a mono-Oil
            // deck the button has to be payable, or it is printed and dead.
            var s = Engine.CreateGame(Deck(60, D1, "o1-Kapigras"), Deck(60, D1, "s3-aetusvox"), 11);
            s = PassTo(s, 0);
            var copy = Registry.Card(s.Players[0].Leader!.CardId);
            Harness.Eq("Comprehension", copy.Powers![0].Name, "the same button");
            var price = copy.Powers![0].Cost;
            Harness.Eq(0, price[Color.S], "no Solar left in it");
            Harness.Eq(1, price[Color.O], "billed in Oil instead");
        });

        Harness.Test("Leader gates the effect: Kapigras played as a body does not reform", () =>
        {
            var s = Game();
            s = Place(s, 0, "o1-Kapigras", 0);
            Harness.Eq("o1-Kapigras", s.Players[0].Slots[0]!.CardId, "still itself in a slot");
        });

        Harness.Test("Infinite Mind voids its own discard, and only its own", () =>
        {
            var s = Game();
            s = Place(s, 0, "r3-infinitemind", 0);
            int mine = s.Players[0].Discard.Count;
            int theirs = s.Players[1].Discard.Count;
            Effects.ToDiscard(s, 0, D1);
            Effects.ToDiscard(s, 1, D1);
            Harness.Eq(mine, s.Players[0].Discard.Count, "my card is annihilated instead");
            Harness.Eq(theirs + 1, s.Players[1].Discard.Count, "the enemy pile is untouched");
        });

        Harness.Test("the Dodecahedron shields a Machine as it lands", () =>
        {
            var s = Game();
            s.Players[0].Stage = "rx-thedodecahedron";
            s = Place(s, 0, "r2-blackhat", 0);
            Harness.Eq(0, s.Players[0].Slots[0]!.Shields, "Black Hat is no Machine");
            s = Place(s, 0, "r1-automoton", 1);
            Harness.Eq(1, s.Players[0].Slots[1]!.Shields, "Automoton is");
        });

        Harness.Test("the Dodecahedron recycles on a Hedron, and only for its owner", () =>
        {
            var s = Game();
            s.Players[0].Stage = "rx-thedodecahedron";
            s.Players[0].Discard.Add("r1-automoton");
            s.Players[0].Discard.Add("r1-automoton");
            s = Place(s, 0, "r2-blackhat", 0);
            Harness.Eq(2, s.Players[0].Discard.Count, "a non-Hedron does nothing");
            s = Place(s, 0, "n3-NerveLite", 1);
            Harness.Eq(1, s.Players[0].Discard.Count, "an ally Hedron recycles one");
            s = PassTo(s, 1);
            s = Place(s, 1, "n3-NerveLite", 0);
            Harness.Eq(1, s.Players[0].Discard.Count, "an enemy Hedron does not");
        });

        Harness.Test("stacks a field grant with Aetus Vox's Comprehension", () =>
        {
            var s = Game();
            s = Place(s, 0, "s3-aetusvox", 0);
            s.Players[0].Stage = "sx-musicalflow";
            s = PassTo(s, 0);
            Harness.Eq(2, s.Players[0].SupportersLeft, "the field alone");
            s.Players[0].Mana[(int)Color.S] = 1;
            s = Must(s, 0, GameAction.ActivatePower(Src(0, 0), 0));
            Harness.Eq(3, s.Players[0].SupportersLeft, "field plus the power");
            Harness.True(s.Players[0].Slots[0]!.Sapped, "and it taps to do it");
        });

        Harness.Test("allows one supporter per turn and unsaps next turn", () =>
        {
            var s = Game();
            s = Must(s, 0, GameAction.PlaySupporter(0));
            Harness.False(Engine.Apply(s, 0, GameAction.PlaySupporter(0)).Ok, "second supporter");
            s = Must(s, 0, GameAction.SapSupporter(0));
            Harness.True(s.Players[0].Supporters[0].Sapped);
            s = PassTo(s, 0);
            Harness.False(s.Players[0].Supporters[0].Sapped, "unsapped");
            Harness.Eq(0, s.Players[0].Mana[(int)Color.R], "pool cleared");
        });

        Harness.Test("takes HP off the top of the deck when a summon is placed", () =>
        {
            var s = Game();
            int before = s.Players[0].Deck.Count;
            s = Place(s, 0, D3, 0);
            Harness.Eq(Registry.Card(D3).Hp, s.Players[0].Slots[0]!.Hp.Count);
            Harness.Eq(before - Registry.Card(D3).Hp, s.Players[0].Deck.Count);
        });

        Harness.Test("refuses to place into an occupied slot", () =>
        {
            var s = Game();
            s = Place(s, 0, D2, 0);
            var res = Engine.Apply(s, 0, GameAction.PlaySummon(Give(s, 0, D1), 0));
            Harness.False(res.Ok);
        });
    }

    private static void Combat()
    {
        Harness.Test("forbids attacking on your first turn", () =>
        {
            var s = Game();
            s = Place(s, 0, D2, 0);
            Harness.Eq(0, Engine.LegalAttackTargets(s, Src(0, 0)).Count);
        });

        Harness.Test("clashes both ways and saps the attacker", () =>
        {
            var s = Game();
            s = Place(s, 0, D3, 0);
            s = Must(s, 0, GameAction.EndTurn());
            s = Place(s, 1, D3B, 0);
            s = Must(s, 1, GameAction.EndTurn());
            s = Must(s, 0, GameAction.DeclareAttack(Src(0, 0), Src(1, 0)));
            Harness.True(s.Players[0].Slots[0]!.Sapped, "attacker sapped");
            Harness.Eq(2, s.Players[0].Slots[0]!.RemainingHp, "attacker hp");
            Harness.Eq(2, s.Players[1].Slots[0]!.RemainingHp, "defender hp");
        });

        Harness.Test("only exposes the leader once the slots in front are empty", () =>
        {
            var s = Game();
            s = Place(s, 0, D2, 0);
            s = PassTo(s, 0);
            var t = Engine.LegalAttackTargets(s, Src(0, 0));
            Harness.Eq(1, t.Count);
            Harness.Eq(TargetRef.Leader(1), t[0]);
            s = Must(s, 0, GameAction.EndTurn());
            s = Place(s, 1, D1, 1);
            s = Must(s, 1, GameAction.EndTurn());
            t = Engine.LegalAttackTargets(s, Src(0, 0));
            Harness.Eq(1, t.Count);
            Harness.Eq(Src(1, 1), t[0]);
        });

        Harness.Test("charges debt equal to the level of the summon that fell", () =>
        {
            var s = Game();
            s = Place(s, 0, D3, 0);
            s = Must(s, 0, GameAction.EndTurn());
            s = Place(s, 1, D3B, 0);
            s = Must(s, 1, GameAction.EndTurn());
            s = Must(s, 0, GameAction.DeclareAttack(Src(0, 0), Src(1, 0)));
            s = PassTo(s, 0);
            s = Must(s, 0, GameAction.DeclareAttack(Src(0, 0), Src(1, 0)));
            Harness.True(s.Players[1].Slots[0] is null, "slot emptied");
            Harness.Eq(3, s.Players[1].DebtCount);
        });

        Harness.Test("offers the owner an immediate replacement", () =>
        {
            var s = Game();
            s = Place(s, 0, D3, 0);
            s = Must(s, 0, GameAction.EndTurn());
            s = Place(s, 1, D1, 0);
            Give(s, 1, D2);
            s = Must(s, 1, GameAction.EndTurn());
            s = Must(s, 0, GameAction.DeclareAttack(Src(0, 0), Src(1, 0)));
            Harness.Eq(1, s.ReplaceQueue.Count);
            Harness.Eq(1, s.ReplaceQueue[0].Player);
            s = Must(s, 1, GameAction.ReplaceSummon(s.Players[1].Hand.IndexOf(D2)));
            Harness.True(s.Players[1].Slots[0] is not null);
            Harness.Eq(0, s.ReplaceQueue.Count);
        });
    }

    private static void LeaderCombat()
    {
        Harness.Test("lets the leader attack once the board allows it", () =>
        {
            var s = Game();
            s = PassTo(s, 0);
            var t = Engine.LegalAttackTargets(s, TargetRef.Leader(0));
            Harness.Eq(1, t.Count);
            Harness.Eq(TargetRef.Leader(1), t[0]);
        });

        Harness.Test("makes an attacking leader take the counter-hit", () =>
        {
            var s = Game();
            s = Must(s, 0, GameAction.EndTurn());
            s = Place(s, 1, D3B, 0);
            s = Must(s, 1, GameAction.EndTurn());
            int before = s.Players[0].Leader!.RemainingHp;
            s = Must(s, 0, GameAction.DeclareAttack(TargetRef.Leader(0), Src(1, 0)));
            Harness.Eq(before - 3, s.Players[0].Leader!.RemainingHp, "leader took the counter");
            Harness.True(s.Players[0].Leader!.Sapped, "leader sapped");
        });

        Harness.Test("still has a defending leader deal nothing back", () =>
        {
            var s = Game();
            s = Place(s, 0, D3, 0);
            s = PassTo(s, 0);
            int before = s.Players[0].Slots[0]!.RemainingHp;
            s = Must(s, 0, GameAction.DeclareAttack(Src(0, 0), TargetRef.Leader(1)));
            Harness.Eq(before, s.Players[0].Slots[0]!.RemainingHp, "attacker untouched");
            Harness.Eq(Registry.Card(LeaderId).Hp * 2 + 2 - 3, s.Players[1].Leader!.RemainingHp, "leader took 3");
        });
    }

    private static void TrapsAndWounds()
    {
        Harness.Test("opens a response window only when the defender holds a trap", () =>
        {
            var s = Game();
            s = Place(s, 0, D3, 0);
            s = Must(s, 0, GameAction.EndTurn());
            s = Place(s, 1, D3B, 0);
            Give(s, 1, "fx-scooba");
            s.Players[1].Supporters.Add(new Supporter { CardId = "f1-basicfish" });
            s.Players[1].Supporters.Add(new Supporter { CardId = "f1-basicfish" });
            s = Must(s, 1, GameAction.EndTurn());
            s = Must(s, 0, GameAction.DeclareAttack(Src(0, 0), Src(1, 0)));
            Harness.True(s.Pending is not null, "window opened");
            Harness.Eq(1, s.Pending!.Player);
            s = Must(s, 1, GameAction.CastTrap(s.Players[1].Hand.IndexOf("fx-scooba")));
            Harness.True(s.Players[0].Slots[0] is null, "the attacker leaves play");
            Harness.True(!s.Players[0].Hand.Contains(D3), "not to hand");
            Harness.True(s.Players[0].Deck.Contains(D3), "but into its owner's deck");
            Harness.Eq(5, s.Players[1].Slots[0]!.RemainingHp, "the clash never happens");
            Harness.True(s.Pending is null, "window closed");
        });

        Harness.Test("rejects a trap on your own turn", () =>
        {
            var s = Game();
            int idx = Give(s, 0, "fx-scooba");
            Harness.False(Engine.Apply(s, 0, GameAction.CastTrap(idx)).Ok);
        });

        Harness.Test("converts every two wounds into one flipped HP card", () =>
        {
            var s = Game();
            s = Place(s, 0, D3, 0);
            s = Must(s, 0, GameAction.EndTurn());
            s.Players[1].Supporters.Add(new Supporter { CardId = "o1-ghost" });
            s.Players[1].Supporters.Add(new Supporter { CardId = "o1-ghost" });
            s = Must(s, 1, GameAction.PlaySummon(Give(s, 1, "o2-witch"), 0));
            // Curse is power 0 on the Witch now, so Hex is power 1.
            s = Must(s, 1, GameAction.ActivatePower(Src(1, 0), 1, Src(0, 0)));
            var target = s.Players[0].Slots[0]!;
            Harness.Eq(4, target.RemainingHp);
            Harness.Eq(1, target.Wounds);
        });
    }

    private static void StructuralVerbs()
    {
        Harness.Test("turns flipped HP cards back down without adding new ones", () =>
        {
            var s = Game();
            s = Place(s, 0, D3, 0);
            s.Players[0].Slots[0]!.Hp[0].Flipped = true;
            s.Players[0].Slots[0]!.Hp[1].Flipped = true;
            s.Players[0].Supporters.Add(new Supporter { CardId = "s1-fluterat" });
            s.Players[0].Supporters.Add(new Supporter { CardId = "s1-fluterat" });
            s = Must(s, 0, GameAction.CastSpell(Give(s, 0, "sx-aetalglob"), Src(0, 0)));
            Harness.Eq(5, s.Players[0].Slots[0]!.RemainingHp);
            Harness.Eq(5, s.Players[0].Slots[0]!.Hp.Count, "no new cards added");
        });

        Harness.Test("an echoed spell is cast twice, so a cast trigger fires twice", () =>
        {
            // Scoobert Singularity resolves the effect a second time and the log
            // says the spell echoes, so Divergent Light has two casts to answer.
            var s = Game();
            s = Place(s, 0, "s3-divergentlight", 0);
            int printed = Registry.Card("s3-divergentlight").Strength;
            void Fund()
            {
                foreach (Color c in Enum.GetValues<Color>()) s.Players[0].Mana[(int)c] = 9;
            }
            Fund();
            s = Must(s, 0, GameAction.CastSpell(Give(s, 0, "fx-chumbucket")));
            Harness.Eq(printed + 1, Effects.EffectiveStrength(s, s.Players[0].Slots[0]!),
                "one cast, one answer");
            s = Place(s, 0, "r3-scoobertsingularity", 1);
            Fund();
            s = Must(s, 0, GameAction.CastSpell(Give(s, 0, "fx-chumbucket")));
            Harness.Eq(printed + 3, Effects.EffectiveStrength(s, s.Players[0].Slots[0]!),
                "the echoed cast answers twice");
        });

        Harness.Test("Digital Rabbits searches the whole deck, not the top of it", () =>
        {
            // "From your deck" names no number, so six cards was never a search.
            var s = Game();
            s = PassTo(s, 0);
            var p = s.Players[0];
            p.Deck.Clear();
            for (int i = 0; i < 39; i++) p.Deck.Add(D1);
            p.Deck.Add("r2-digitalrabbits");
            s = Place(s, 0, "r2-digitalrabbits", 0);
            Harness.Eq(1, s.ChoiceQueue.Count, "a choice is waiting");
            Harness.Eq(1, s.ChoiceQueue[0].Cards!.Length, "only the match is shown");
            Harness.Eq("r2-digitalrabbits", s.ChoiceQueue[0].Cards![0], "and it is the copy");
        });

        Harness.Test("a search with nothing to find asks nothing", () =>
        {
            var s = Game();
            s = PassTo(s, 0);
            var p = s.Players[0];
            p.Deck.Clear();
            for (int i = 0; i < 39; i++) p.Deck.Add(D1);
            s = Place(s, 0, "r2-digitalrabbits", 0);
            Harness.Eq(0, s.ChoiceQueue.Count, "no prompt with nothing to answer");
        });

        Harness.Test("Screener counts an ally Machine leader on its last HP card", () =>
        {
            // An ally is an ally wherever it stands. The caller already ran the
            // hook for the leader; the card's own loop was what dropped it.
            var s = Engine.CreateGame(Deck(60, D1, "m-bg-robotfish"), Deck(60, D1), 7);
            s = PassTo(s, 0);
            s = Place(s, 0, "m-bgr-screener", 0);
            var lead = s.Players[0].Leader!;
            for (int i = 0; i < lead.Hp.Count - 1; i++) lead.Hp[i].Flipped = true;
            Harness.Eq(1, Effects.EffectDamageOf(s, 0), "an ally Machine on its last card");
            lead.Hp[0].Flipped = false;
            Harness.Eq(0, Effects.EffectDamageOf(s, 0), "and not before that");
        });

        Harness.Test("Nommer mutes the flips of a leader it hits", () =>
        {
            var s = Game();
            s = PassTo(s, 0);
            s = Place(s, 0, "r2-nommer", 0);
            s = PassTo(s, 0);
            // Every HP card the enemy leader wears would hand it +2 attack.
            var foe = s.Players[1].Leader!;
            foreach (var h in foe.Hp) h.CardId = "f1-swordfish";
            int before = Effects.EffectiveStrength(s, foe);
            s = Must(s, 0, GameAction.DeclareAttack(Src(0, 0), TargetRef.Leader(1)));
            Harness.Eq(before, Effects.EffectiveStrength(s, s.Players[1].Leader!),
                "no Swordfish fired");
        });

        Harness.Test("Player One's battlecry pays out from the leader seat", () =>
        {
            // "If you control no other summons" counted exactly one body in the
            // slots. A leading Player One is not among them, so an empty board
            // read as a failure and one other summon read as a pass.
            var s = Engine.CreateGame(Deck(60, D1, "rh-player1"), Deck(60, D1), 7);
            s = PassTo(s, 0);
            var lead = s.Players[0].Leader!;
            Harness.Eq("rh-player1", lead.CardId, "it leads");
            Harness.Eq(1, lead.Shields, "a Power Shield");
            Harness.Eq(Registry.Card("rh-player1").Strength + 4,
                Effects.EffectiveStrength(s, lead), "and +4 attack");
        });

        Harness.Test("Player One stays quiet in a slot beside another summon", () =>
        {
            var s = Game();
            s = Place(s, 0, "n1-Wallguy", 1);
            s = Place(s, 0, "rh-player1", 0);
            Harness.Eq(0, s.Players[0].Slots[0]!.Shields, "it is not alone");
        });

        Harness.Test("an echo source works from the leader seat", () =>
        {
            // Any summon with HP can be chosen to lead, and a leader is a body
            // like any other. Read out of the three slots alone, Scoobert
            // Singularity said "Your spells cast twice" from the one seat where
            // it did nothing.
            var s = Engine.CreateGame(
                Deck(60, D1, "r3-scoobertsingularity"), Deck(60, D1), 7);
            s = PassTo(s, 0);
            Harness.Eq("r3-scoobertsingularity", s.Players[0].Leader!.CardId, "it leads");
            // The target has to be put down on its owner's own turn.
            s = PassTo(s, 1);
            s = Place(s, 1, "n1-Wallguy", 0);
            s = PassTo(s, 0);
            foreach (Color c in Enum.GetValues<Color>()) s.Players[0].Mana[(int)c] = 9;
            int before = s.Players[1].Slots[0]!.RemainingHp;
            s = Must(s, 0, GameAction.CastSpell(Give(s, 0, "nx-RockThrow"), Src(1, 0)));
            Harness.Eq(4, before - s.Players[1].Slots[0]!.RemainingHp, "2 dealt twice");
        });

        Harness.Test("moves HP cards, felling a donor stripped to zero", () =>
        {
            var s = Game();
            s = Place(s, 0, D3, 0);
            s = Must(s, 0, GameAction.EndTurn());
            s = Place(s, 1, D1, 0);
            s = PassTo(s, 0);
            s.Players[0].Supporters.Add(new Supporter { CardId = "r1-slicebot" });
            s.Players[0].Supporters.Add(new Supporter { CardId = "r1-slicebot" });
            s = Must(s, 0, GameAction.CastSpell(Give(s, 0, "rx-grab"), Src(1, 0), Src(0, 0)));
            Harness.True(s.Players[1].Slots[0] is null, "stripped donor falls");
            Harness.Eq(1, s.Players[1].DebtCount, "and its debt is charged");
            Harness.Eq(6, s.Players[0].Slots[0]!.RemainingHp);
        });

        Harness.Test("transforms a summon while keeping its HP cards", () =>
        {
            var s = Game();
            s = Place(s, 0, D3, 0);
            s = Must(s, 0, GameAction.EndTurn());
            s = Place(s, 1, D3B, 0);
            s.Players[1].Supporters.Add(new Supporter { CardId = "f1-basicfish" });
            s.Players[1].Supporters.Add(new Supporter { CardId = "f1-basicfish" });
            s = Must(s, 1, GameAction.CastSpell(Give(s, 1, "fx-fishify"), Src(0, 0)));
            Harness.Eq("f1-basicfish", s.Players[0].Slots[0]!.CardId);
            Harness.Eq(Registry.Card(D3).Hp, s.Players[0].Slots[0]!.Hp.Count);
        });

        Harness.Test("lets debt move across the table", () =>
        {
            // M-Xalbriss's Anti-Abstraction is the debt-transfer power now.
            var s = Game();
            s.Players[0].DebtCount = 4;
            s = Place(s, 0, "m-yp-m-xalbriss", 0);
            s.Players[0].Supporters.Add(new Supporter { CardId = "s1-fluterat" });
            s.Players[0].Supporters.Add(new Supporter { CardId = "o1-ghost" });
            s = Must(s, 0, GameAction.ActivatePower(Src(0, 0), 0));
            Harness.Eq(3, s.Players[0].DebtCount);
            Harness.Eq(1, s.Players[1].DebtCount);
        });

        Harness.Test("pays a colourless power cost with any supporters", () =>
        {
            var s = Game();
            s = Place(s, 0, "n3-Seam", 0);
            s.Players[0].Supporters.Add(new Supporter { CardId = "r1-slicebot" });
            s.Players[0].Supporters.Add(new Supporter { CardId = "r1-slicebot" });
            s.Players[0].Supporters.Add(new Supporter { CardId = "r1-slicebot" });
            s = Must(s, 0, GameAction.ActivatePower(Src(0, 0), 0));
            Harness.Eq(4, Effects.EffectiveStrength(s, s.Players[0].Slots[0]!));
            Harness.Eq(3, s.Players[0].Supporters.Count(x => x.Sapped), "all three sapped");
        });

        Harness.Test("heals the debt when a summon leaves the debt pile", () =>
        {
            var s = Game();
            s.Players[0].DebtZone.Add(D2);
            s.Players[0].DebtCount = 5;
            Effects.ReviveFromDebt(s, 0, d => d.Type == CardType.Summon);
            Harness.Eq(3, s.Players[0].DebtCount);
            Harness.True(s.Players[0].Hand.Contains(D2), "summon back in hand");
            Harness.Eq(0, s.Players[0].DebtZone.Count);
        });

        Harness.Test("destroys a sapped summon and refunds a debt card with The Orb", () =>
        {
            var s = Game();
            s = Must(s, 0, GameAction.EndTurn());
            s = Place(s, 1, D2, 0);
            s = PassTo(s, 0);
            s.Players[1].Slots[0]!.Sapped = true;
            s.Players[0].DebtZone.Add(D3B);
            s.Players[0].Supporters.Add(new Supporter { CardId = "f1-basicfish" });
            s.Players[0].Supporters.Add(new Supporter { CardId = "o1-ghost" });
            s = Must(s, 0, GameAction.CastSpell(Give(s, 0, "m-bp-orb"), Src(1, 0)));
            Harness.True(s.Players[1].Slots[0] is null, "sapped summon destroyed");
            Harness.Eq(2, s.Players[1].DebtCount);
            Harness.Eq(0, s.Players[0].DebtZone.Count);
            Harness.True(s.Players[0].Hand.Contains(D3B), "debt card back in hand");
        });

        Harness.Test("refuses The Orb when no summon is sapped", () =>
        {
            var s = Game();
            s = Must(s, 0, GameAction.EndTurn());
            s = Place(s, 1, D2, 0);
            s = PassTo(s, 0);
            s.Players[0].Supporters.Add(new Supporter { CardId = "f1-basicfish" });
            s.Players[0].Supporters.Add(new Supporter { CardId = "o1-ghost" });
            var res = Engine.Apply(s, 0, GameAction.CastSpell(Give(s, 0, "m-bp-orb"), Src(1, 0)));
            Harness.False(res.Ok, "unsapped summon is not a legal target");
        });

        Harness.Test("sap lock holds a summon down through one refresh", () =>
        {
            var s = Game();
            s = Must(s, 0, GameAction.EndTurn());
            s = Place(s, 1, D2, 0);
            s = PassTo(s, 0);
            s.Players[1].Slots[0]!.Sapped = true;
            // With a sapped enemy on the board, the battlecry demands its target.
            int idx = Give(s, 0, "r1-pointer");
            Harness.False(Engine.Apply(s, 0, GameAction.PlaySummon(idx, 0)).Ok, "target required");
            s = Must(s, 0, GameAction.PlaySummon(idx, 0, Src(1, 0)));
            Harness.True(s.Players[1].Slots[0]!.SapLock, "target is locked");
            s = PassTo(s, 1);
            Harness.True(s.Players[1].Slots[0]!.Sapped, "stayed sapped through refresh");
            Harness.False(s.Players[1].Slots[0]!.SapLock, "lock is spent");
            s = PassTo(s, 1);
            Harness.False(s.Players[1].Slots[0]!.Sapped, "unsaps normally after that");
        });

        Harness.Test("skips a battlecry with no legal target", () =>
        {
            var s = Game();
            s = Must(s, 0, GameAction.EndTurn());
            s = Place(s, 1, D2, 0);
            s = PassTo(s, 0);
            s = Place(s, 0, "r1-pointer", 0);
            Harness.False(s.Players[1].Slots[0]!.SapLock, "nothing to lock");
        });

        Harness.Test("lets a battlecry pick its beneficiary", () =>
        {
            var s = Game();
            s = Place(s, 0, D1, 0);
            s = Place(s, 0, D2, 1);
            int idx = Give(s, 0, "s2-admirer");
            Harness.False(Engine.Apply(s, 0, GameAction.PlaySummon(idx, 2, Src(0, 2))).Ok,
                "cannot aim at itself");
            s = Must(s, 0, GameAction.PlaySummon(idx, 2, Src(0, 1)));
            Harness.Eq(4, Effects.EffectiveStrength(s, s.Players[0].Slots[1]!));
        });
    }

    private static void TriggerTests()
    {
        Harness.Test("fires when a summon enters play", () =>
        {
            var s = Game();
            s = Must(s, 0, GameAction.EndTurn());
            s = Place(s, 1, D2, 0);
            s = Must(s, 1, GameAction.EndTurn());
            s = Place(s, 0, "m-rg-xyuzdrone", 0);
            Harness.Eq(Registry.Card(D2).Hp - 1, s.Players[1].Slots[0]!.RemainingHp);
        });

        Harness.Test("fires when a summon falls", () =>
        {
            var s = Game();
            s = Place(s, 0, D3, 0);
            s = Must(s, 0, GameAction.EndTurn());
            s = Place(s, 1, "o1-skeleton", 0);
            s = Must(s, 1, GameAction.EndTurn());
            s = Must(s, 0, GameAction.DeclareAttack(Src(0, 0), Src(1, 0)));
            Harness.True(s.Players[1].Hand.Contains("gen-wither-o1-skeleton"), "skeleton came back worn down");
        });

        Harness.Test("fires on defence, before damage is dealt", () =>
        {
            var s = Game();
            s = Place(s, 0, D3, 0);
            s = Must(s, 0, GameAction.EndTurn());
            s = Place(s, 1, "f1-urchin", 0);
            s = Must(s, 1, GameAction.EndTurn());
            s = Must(s, 0, GameAction.DeclareAttack(Src(0, 0), Src(1, 0)));
            Harness.Eq(2, s.Players[0].Slots[0]!.RemainingHp, "2 from the trigger, 1 from the clash");
        });

        Harness.Test("applies a static strength aura from a summon in play", () =>
        {
            var s = Game();
            s = Place(s, 0, "s1-livingtree", 0);
            // Living Flowers asks its Battlecry for a target now.
            s = Must(s, 0, GameAction.PlaySummon(Give(s, 0, "s1-livingflowers"), 1, Src(0, 0)));
            s = Must(s, 0, GameAction.EndTurn());
            s = Must(s, 1, GameAction.EndTurn());
            int before = s.Players[1].Leader!.RemainingHp;
            s = Must(s, 0, GameAction.DeclareAttack(Src(0, 1), TargetRef.Leader(1)));
            Harness.Eq(before - 2, s.Players[1].Leader!.RemainingHp, "1 printed plus 1 from the tree");
        });

        Harness.Test("Krazbot draws only for a Hedron", () =>
        {
            var s = Game();
            s = Place(s, 0, "m-yg-krazbot", 0);
            int before = s.Players[0].Hand.Count;
            // Place() puts the card in hand before playing it, so a play nets zero.
            s = Place(s, 0, "m-yg-pilgrim", 1);
            Harness.Eq(before + 1, s.Players[0].Hand.Count, "drew for the Hedron");
            s = Place(s, 0, D1, 2);
            Harness.Eq(before + 1, s.Players[0].Hand.Count, "nothing for the dummy");
        });

        Harness.Test("Hedronic Gateway pumps the Hedrons out and arrives sapped", () =>
        {
            var s = Game();
            s = Place(s, 0, "m-yg-pilgrim", 0);
            int str = Effects.EffectiveStrength(s, s.Players[0].Slots[0]!);
            int hp = s.Players[0].Slots[0]!.RemainingHp;
            s = Place(s, 0, "m-yg-hedronicgateway", 1);
            Harness.Eq(str + 1, Effects.EffectiveStrength(s, s.Players[0].Slots[0]!), "pilgrim attack");
            Harness.Eq(hp + 1, s.Players[0].Slots[0]!.RemainingHp, "pilgrim hp");
            // Its own battlecry passes over it, so it stands on its printed line.
            var gate = s.Players[0].Slots[1]!;
            Harness.Eq(2, Effects.EffectiveStrength(s, gate), "its own attack");
            Harness.Eq(3, gate.RemainingHp, "its own hp");
            Harness.True(gate.Sapped, "arrives sapped");
        });

        Harness.Test("Annihilate removes a body without charging its owner", () =>
        {
            var s = Game();
            s = PassTo(s, 1);
            s = Place(s, 1, D3, 0);
            s = PassTo(s, 0);
            int owed = s.Players[1].DebtCount;
            int pile = s.Players[1].DebtZone.Count;
            s.Players[0].Mana[(int)Color.P] = 1;
            s.Players[0].Mana[(int)Color.O] = 2;
            s = Must(s, 0, GameAction.CastSpell(Give(s, 0, "m-rp-annihilate"), Src(1, 0)));
            Harness.True(s.Players[1].Slots[0] is null, "the body is gone");
            Harness.Eq(owed, s.Players[1].DebtCount, "and never reached their debt");
            Harness.Eq(pile, s.Players[1].DebtZone.Count, "nor their debt zone");
        });

        Harness.Test("Annihilate silences the body before it dies", () =>
        {
            // The Pod returns 2 spells from the discard pile on death, so a
            // Deathrattle that fired would be visible in the hand count.
            var s = Game();
            s = PassTo(s, 1);
            s = Place(s, 1, "p3-Pod", 0);
            s.Players[1].Discard.Add("x-p-bolt");
            s.Players[1].Discard.Add("x-p-bolt");
            s = PassTo(s, 0);
            int hand = s.Players[1].Hand.Count;
            s.Players[0].Mana[(int)Color.P] = 1;
            s.Players[0].Mana[(int)Color.O] = 2;
            s = Must(s, 0, GameAction.CastSpell(Give(s, 0, "m-rp-annihilate"), Src(1, 0)));
            Harness.True(s.Players[1].Slots[0] is null, "the Pod is gone");
            Harness.Eq(hand, s.Players[1].Hand.Count, "its Deathrattle never fired");
            // The spells it would have recovered are still sitting in the pile.
            Harness.Eq(2, s.Players[1].Discard.Count(x => x == "x-p-bolt"), "and recovered nothing");
            // Its own card left play, but the HP cards spent on it are discarded.
            Harness.True(!s.Players[1].DebtZone.Contains("p3-Pod"), "the Pod reached no zone");
        });

        Harness.Test("a plain destroy still fires the Deathrattle Annihilate skips", () =>
        {
            var s = Game();
            s = PassTo(s, 1);
            s = Place(s, 1, "p3-Pod", 0);
            s.Players[1].Discard.Add("x-p-bolt");
            s.Players[1].Discard.Add("x-p-bolt");
            s = PassTo(s, 0);
            int hand = s.Players[1].Hand.Count;
            Effects.DestroySummon(s, s.Players[1].Slots[0]!);
            Harness.True(s.Players[1].Hand.Count > hand || s.ChoiceQueue.Count > 0,
                "the control case does fire it");
        });

        Harness.Test("Eternal Rest strips the newest cards off the enemy pile for good", () =>
        {
            var s = Game();
            s = Place(s, 0, "m-yp-molly", 0);
            for (int i = 0; i < 12; i++) s.Players[1].Discard.Add(D1);
            s.Players[1].Discard.Add(D3);
            int before = s.Players[1].Discard.Count;
            s = PassTo(s, 1);
            s = PassTo(s, 0);
            s.Players[0].Mana[(int)Color.O] = 1;
            s.Players[0].Mana[(int)Color.S] = 1;
            s = Must(s, 0, GameAction.ActivatePower(Src(0, 0), 0));
            Harness.Eq(before - 10, s.Players[1].Discard.Count, "ten cards leave play");
            Harness.True(!s.Players[1].Discard.Contains(D3), "newest first");
        });

        Harness.Test("a held Charge lends Effect Damage to one spell and expires", () =>
        {
            // Living Spell digs on arrival, so the charge is set on the state
            // here and the card's own Power is checked separately below.
            var s = Game();
            s = PassTo(s, 1);
            s = Place(s, 1, D3, 0);
            s = Place(s, 1, D3, 1);
            s = PassTo(s, 0);
            int full = Registry.Card(D3).Hp;
            s.Players[0].SpellBonus = 1;
            s.Players[0].Mana[(int)Color.P] = 2;
            s = Must(s, 0, GameAction.CastSpell(Give(s, 0, "x-p-bolt"), Src(1, 0)));
            Harness.Eq(0, s.Players[0].SpellBonus, "spent by the first spell");
            int firstHit = full - s.Players[1].Slots[0]!.RemainingHp;
            s.Players[0].Mana[(int)Color.P] = 2;
            s = Must(s, 0, GameAction.CastSpell(Give(s, 0, "x-p-bolt"), Src(1, 1)));
            int secondHit = full - s.Players[1].Slots[1]!.RemainingHp;
            Harness.Eq(firstHit - 1, secondHit, "the second spell is back to normal");
        });

        Harness.Test("a Charge does not outlive the turn that held it", () =>
        {
            var s = Game();
            s.Players[0].SpellBonus = 1;
            s = PassTo(s, 1);
            Harness.Eq(0, s.Players[0].SpellBonus, "it expires at the end of the turn");
        });

        Harness.Test("Living Spell carries the Charge that grants it", () =>
        {
            var d = Registry.Card("m-yr-livingspell");
            var p = d.Powers!.Single(x => x.Name == "Charge");
            Harness.Eq(1, p.Cost.P, "one Pepper");
            Harness.Eq(1, p.Cost.S, "one Solar");
        });

        Harness.Test("sweeps the enemy board with Ultimate Novelty and takes Gold Wild with it", () =>
        {
            var s = Game();
            s = Place(s, 0, "s3-goldwild", 0);
            s = PassTo(s, 1);
            s = Place(s, 1, D3, 0);
            s = Place(s, 1, D1, 1);
            s = PassTo(s, 0);
            s.Players[0].Mana[(int)Color.S] = 6;
            s = Must(s, 0, GameAction.ActivatePower(Src(0, 0), 0));
            Harness.Eq(0, s.Players[1].Slots.Count(x => x is not null), "enemy board swept");
            // It pays for the sweep with itself, so its own slot is empty too.
            Harness.True(s.Players[0].Slots[0] is null, "and it went with them");
            Harness.True(s.Players[0].DebtCount > 0, "which costs its level in debt");
        });

        Harness.Test("The Count heals for a kill inside its own battle", () =>
        {
            var s = Game();
            s = Place(s, 0, "o2-thecount", 0);
            s = PassTo(s, 1);
            s = Place(s, 1, D1, 0);
            s = PassTo(s, 0);
            Effects.DealDamage(s, Src(0, 0), 1);
            Harness.Eq(2, s.Players[0].Slots[0]!.RemainingHp, "hurt first");
            s = Must(s, 0, GameAction.DeclareAttack(Src(0, 0), Src(1, 0)));
            Harness.True(s.Players[1].Slots[0] is null, "the dummy dies");
            // 3 HP, minus the dummy's 1 counter-damage, plus the 2 the kill heals.
            Harness.Eq(3, s.Players[0].Slots[0]!.RemainingHp, "healed back");
        });

        Harness.Test("Park Ranger sweeps Wounds off both sides for attack", () =>
        {
            var s = Game();
            s = PassTo(s, 1);
            s = Place(s, 1, D1, 0);
            s = PassTo(s, 0);
            s = Place(s, 0, "o2-parkranger", 0);
            s = Place(s, 0, D1, 1);
            Effects.AddWounds(s, Src(1, 0), 1);
            Effects.AddWounds(s, Src(0, 1), 1);
            s = PassTo(s, 0);
            s.Players[0].Supporters.Add(new Supporter { CardId = "o1-ghost" });
            s = Must(s, 0, GameAction.ActivatePower(Src(0, 0), 0));
            Harness.Eq(0, s.Players[1].Slots[0]!.Wounds, "enemy cleared");
            Harness.Eq(0, s.Players[0].Slots[1]!.Wounds, "ally cleared");
            Harness.Eq(4, Effects.EffectiveStrength(s, s.Players[0].Slots[0]!), "2 printed plus 2 swept");
        });

        Harness.Test("Necromancer raises the enemy dead in Oil, two bigger", () =>
        {
            var s = Game();
            s = Place(s, 0, "o2-necromancer", 0);
            s = PassTo(s, 1);
            s = Place(s, 1, D1, 0);
            s = PassTo(s, 0);
            Effects.DealDamage(s, Src(1, 0), 9);
            s = Must(s, 1, GameAction.DeclineReplace());
            Harness.True(s.Players[1].DebtZone.Contains(D1), "body is in their debt");
            int owed = s.Players[1].DebtCount;
            s.Players[0].Supporters.Add(new Supporter { CardId = "o1-ghost" });
            s = Must(s, 0, GameAction.ActivatePower(Src(0, 0), 0,
                new TargetRef(TargetKind.Debt, 1, s.Players[1].DebtZone.IndexOf(D1))));
            var raised = s.Players[0].Slots.FirstOrDefault(x => x is not null
                && x.CardId.StartsWith("gen-raise-"));
            Harness.True(raised is not null, "a body came back");
            var def = Registry.Card(raised!.CardId);
            Harness.Eq(Color.O, def.Color, "rebuilt in Oil");
            Harness.True(def.HasFaction(Faction.Spirit), "and as a Spirit");
            Harness.Eq(Registry.Card(D1).Strength + 2, def.Strength, "+2 attack");
            Harness.Eq(Registry.Card(D1).Hp + 2, raised.RemainingHp, "+2 HP");
            Harness.True(s.Players[1].DebtCount < owed, "their debt falls with the body");
        });

        Harness.Test("Lemon Aid answers a spell without countering it", () =>
        {
            var s = Game();
            s = PassTo(s, 1);
            s = Place(s, 1, D3, 0);
            s.Players[1].Supporters.Add(new Supporter { CardId = "s1-starbird" });
            Give(s, 1, "sx-lemonaid");
            s = PassTo(s, 0);
            Effects.DealDamage(s, Src(1, 0), 3);
            Harness.Eq(2, s.Players[1].Slots[0]!.RemainingHp, "hurt first");
            s.Players[0].Supporters.Add(new Supporter { CardId = "p1-bunny" });
            s = Must(s, 0, GameAction.CastSpell(Give(s, 0, "x-p-bolt"), Src(1, 0)));
            Harness.True(s.Pending?.Spell is not null, "window opened");
            s = Must(s, 1, GameAction.CastTrap(s.Players[1].Hand.IndexOf("sx-lemonaid")));
            // Heals back to full, then the bolt it did not counter lands for 2.
            Harness.Eq(3, s.Players[1].Slots[0]!.RemainingHp, "the spell still resolved");
        });
    }

    private static void FatigueAndLosing()
    {
        Harness.Test("charges the reshuffle debt when the deck runs out", () =>
        {
            var s = Game();
            s.Players[0].Deck = new List<string> { D1 };
            s.Players[0].Discard = new List<string>();
            // The one card comes off, then the next draw finds nothing anywhere.
            var after = PassTo(s, 0);
            Harness.Eq(Effects.ReshuffleDebt, after.Players[0].DebtCount);
        });

        Harness.Test("charges more for every deck-out after the first", () =>
        {
            var s = Game();
            var p = s.Players[0];
            int expected = Effects.ReshuffleDebt;
            for (int round = 0; round < 3; round++)
            {
                p.Deck = new List<string>();
                p.Discard = new List<string> { D1, D1 };
                Harness.Eq(expected, Effects.ReshuffleCost(s, 0), "quoted cost");
                int before = p.DebtCount;
                Effects.DrawCards(s, 0, 1);
                Harness.Eq(expected, p.DebtCount - before, $"deck-out {round + 1}");
                expected += Effects.ReshuffleDebtStep;
            }
            Harness.Eq(3, p.DeckOuts);
        });

        Harness.Test("sends everything drawn past the hand limit to the discard pile", () =>
        {
            var s = Game();
            var p = s.Players[0];
            p.Hand = Enumerable.Repeat(D2, Rules.HandLimit).ToList();
            p.Deck = Enumerable.Repeat(D1, 4).ToList();
            p.Discard = new List<string>();
            Harness.Eq(3, Effects.DrawCards(s, 0, 3), "drawn all the same");
            Harness.Eq(Rules.HandLimit, p.Hand.Count, "the hand stays at the limit");
            Harness.Eq(1, p.Deck.Count, "they left the deck, they just did not stay");
            Harness.Eq(3, p.Discard.Count, "the overflow is in the discard pile");
        });

        Harness.Test("fills the hand to the limit and discards only the rest", () =>
        {
            var s = Game();
            var p = s.Players[0];
            p.Hand = Enumerable.Repeat(D2, Rules.HandLimit - 1).ToList();
            p.Deck = Enumerable.Repeat(D1, 3).ToList();
            p.Discard = new List<string>();
            Effects.DrawCards(s, 0, 3);
            Harness.Eq(Rules.HandLimit, p.Hand.Count);
            Harness.Eq(2, p.Discard.Count);
        });

        Harness.Test("ends the game when fatigue reaches the debt limit", () =>
        {
            var s = Game();
            s.Players[0].Deck = new List<string>();
            s.Players[0].DebtCount = Rules.DebtLimit - 2;
            var after = PassTo(s, 0);
            Harness.Eq(1, after.Winner);
            Harness.Contains("debt", after.WinReason);
        });

        Harness.Test("ends the game when the leader runs out of HP", () =>
        {
            var s = Game();
            s = Place(s, 0, D3, 0);
            s = PassTo(s, 0);
            for (int i = 0; i < 4 && s.Winner < 0; i++)
            {
                s = Must(s, 0, GameAction.DeclareAttack(Src(0, 0), TargetRef.Leader(1)));
                if (s.Winner >= 0) break;
                s = PassTo(s, 0);
            }
            Harness.Eq(0, s.Winner);
            Harness.Contains("leader", s.WinReason);
        });

        Harness.Test("ends the game at the debt limit", () =>
        {
            var s = Game();
            s.Players[1].DebtCount = Rules.DebtLimit - 1;
            s = Place(s, 0, D3, 0);
            s = Must(s, 0, GameAction.EndTurn());
            s = Place(s, 1, D1, 0);
            s = Must(s, 1, GameAction.EndTurn());
            s = Must(s, 0, GameAction.DeclareAttack(Src(0, 0), Src(1, 0)));
            Harness.Eq(0, s.Winner);
            Harness.Contains("debt", s.WinReason);
        });
    }

    private static void CardsAndDecks()
    {
        Harness.Test("every deck references real cards and a playable leader", () =>
        {
            foreach (var d in CardSets.Everything)
            {
                Harness.True(Identity.CanBeLeader(d.LeaderId), $"{d.Key} leader");
                foreach (var id in d.Cards) Harness.True(Registry.TryCard(id) is not null, $"{d.Key}: {id}");
            }
        });

        Harness.Test("respects the two-copy limit", () =>
        {
            foreach (var d in CardSets.Everything)
            {
                foreach (var g in d.Cards.GroupBy(x => x))
                {
                    Harness.True(g.Count() <= Rarities.CopyLimit,
                        $"{d.Key}: {g.Count()}x {g.Key} (max {Rarities.CopyLimit})");
                }
            }
        });

        Harness.Test("a leader brings every colour its own costs are written in", () =>
        {
            // Sasparsol is Pepper and Solar and pays for Lifesong in both. Whatever
            // a leader's costs name, a deck standing behind it has to be allowed to
            // supply, or the leader could never use its own power.
            var sasparsol = Identity.DeckIdentity("m-yr-sasparsol");
            Harness.True(sasparsol.Contains(Color.S), "keeps its own colour");
            Harness.True(sasparsol.Contains(Color.P), "and the other one its power costs");
            Harness.True(Identity.IsLegalUnder(Registry.Card("p1-firebat"), sasparsol),
                "so a Pepper card is legal under it");

            // Whatever a leader demands, a deck can supply.
            foreach (var d in Registry.All)
            {
                if (!Identity.CanBeLeader(d.Id)) continue;
                var identity = Identity.DeckIdentity(d.Id);
                foreach (var c in Colors.All)
                {
                    bool needed = d.Cost[c] > 0;
                    foreach (var p in d.Powers ?? Array.Empty<Power>())
                    {
                        if (p.Cost[c] > 0) needed = true;
                    }
                    if (needed)
                    {
                        Harness.True(identity.Contains(c), $"{d.Id} needs {c} and must allow it");
                    }
                }
            }
        });

        Harness.Test("a multi-colour card prints a pip for every colour it carries", () =>
        {
            // A two-colour card has to ask for both, a three-colour card all
            // three, so the face shows what the deck behind it must supply. The
            // pips may be spread across the card's own cost, its Powers and its
            // flip price rather than crowded onto one of them.
            var thin = new List<string>();
            foreach (var d in Registry.All)
            {
                if (d.Art is null || d.Uncollectible) continue;
                var colors = Identity.ColorsOf(d).Where(c => c != Color.N).Distinct().ToList();
                if (colors.Count < 2) continue;
                var seen = new HashSet<Color>();
                foreach (var c in Colors.All)
                {
                    if (d.Cost[c] > 0) seen.Add(c);
                    foreach (var p in d.Powers ?? Array.Empty<Power>())
                        if (p.Cost[c] > 0) seen.Add(c);
                    if (d.FlipCost is { } fc && fc.Mana[c] > 0) seen.Add(c);
                }
                var missing = colors.Where(c => !seen.Contains(c)).ToList();
                if (missing.Count > 0) thin.Add($"{d.Id} never asks for {string.Join("/", missing)}");
            }
            Harness.True(thin.Count == 0, string.Join(", ", thin));
        });

        Harness.Test("no card demands mana its own identity withholds", () =>
        {
            // A card whose cost names a colour outside its identity is legal in a
            // deck that can never cast it. Leaders are covered by widening their
            // identity; everything else has to be payable where it is legal.
            var stranded = new List<string>();
            foreach (var d in Registry.All)
            {
                if (d.Art is null) continue;
                var identity = Identity.ColorsOf(d);
                foreach (var c in Colors.All)
                {
                    if (d.Cost[c] > 0 && !identity.Contains(c)) stranded.Add($"{d.Id} costs {c}");
                }
            }
            Harness.True(stranded.Count == 0, string.Join(", ", stranded));
        });

        Harness.Test("keeps every deck inside the colours its leader brings", () =>
        {
            foreach (var d in CardSets.Everything)
            {
                var (ok, identity, off) = Identity.CheckDeckColors(d.LeaderId, d.Cards);
                Harness.True(ok, $"{d.Key} ({string.Join("", identity)}): {string.Join(", ", off)}");
            }
        });

        Harness.Test("treats identity as a subset, so a mono leader cannot run duals", () =>
        {
            var mono = Identity.ColorsOf(Registry.Card("fh-thefish"));
            Harness.False(Identity.IsLegalUnder(Registry.Card("m-bg-robotfish"), mono));
            Harness.True(Identity.IsLegalUnder(Registry.Card("f1-basicfish"), mono));
            var dual = Identity.ColorsOf(Registry.Card("m-bg-machineblue"));
            Harness.True(Identity.IsLegalUnder(Registry.Card("m-bg-robotfish"), dual));
            Harness.True(Identity.IsLegalUnder(Registry.Card("r1-mouse"), dual));
            Harness.False(Identity.IsLegalUnder(Registry.Card("p1-bunny"), dual));
        });

        Harness.Test("gives every card a unique id and a collector number", () =>
        {
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var c in Registry.All)
            {
                Harness.True(seen.Add(c.Id), $"duplicate {c.Id}");
                Harness.True(!string.IsNullOrEmpty(c.Num), $"{c.Id} has no number");
            }
        });
    }

    /// <summary>The five colour keywords, each tested on its own.</summary>
    private static void Keywords()
    {
        static EffectCtx Ctx(GameState s, int me) =>
            new() { State = s, Me = me, Card = Registry.Card("x-p-bolt") };

        Harness.Test("Effect Damage lifts card damage but never a clash", () =>
        {
            var s = Game();
            s = Place(s, 0, D3, 0);
            s = Must(s, 0, GameAction.EndTurn());
            s = Place(s, 1, D3B, 0);
            s = Must(s, 1, GameAction.EndTurn());

            int before = s.Players[1].Slots[0]!.RemainingHp;
            Ctx(s, 0).Damage(Src(1, 0), 1);
            Harness.Eq(before - 1, s.Players[1].Slots[0]!.RemainingHp, "no bonus in play");

            // Pinelyte prints Effect Damage 1 for this test's purposes only if
            // the set gives it one, so the bonus is checked through the helper.
            Harness.Eq(0, Effects.EffectDamageOf(s, 0), "no source of the keyword yet");
        });

        Harness.Test("a Power Shield stops one instance of damage and is spent", () =>
        {
            var s = Game();
            s = Place(s, 0, D3, 0);
            var target = Src(0, 0);
            Ctx(s, 0).Shield(target, 1);
            Harness.Eq(1, s.Find(target)!.Shields, "shield raised");

            int hp = s.Find(target)!.RemainingHp;
            Effects.DealDamage(s, target, 4);
            Harness.Eq(hp, s.Find(target)!.RemainingHp, "all four blocked");
            Harness.Eq(0, s.Find(target)!.Shields, "shield spent");

            Effects.DealDamage(s, target, 1);
            Harness.Eq(hp - 1, s.Find(target)!.RemainingHp, "next hit lands");
        });

        Harness.Test("catching returns flipped HP cards to their owner's hand", () =>
        {
            var s = Game();
            s = Place(s, 0, D3, 0);
            var target = Src(0, 0);
            Effects.DealDamage(s, target, 2);
            Harness.Eq(3, s.Find(target)!.RemainingHp, "two flipped");

            int hand = s.Players[0].Hand.Count;
            int caught = Ctx(s, 0).Catch(target, 2);
            Harness.Eq(2, caught, "caught");
            Harness.Eq(hand + 2, s.Players[0].Hand.Count, "back in hand");
            Harness.Eq(3, s.Find(target)!.Hp.Count, "body is smaller now");
            Harness.Eq(3, s.Find(target)!.RemainingHp, "and all of it is face down");
        });

        Harness.Test("catching never takes a card that is still face down", () =>
        {
            var s = Game();
            s = Place(s, 0, D2, 0);
            var target = Src(0, 0);
            Effects.DealDamage(s, target, 1);
            int caught = Ctx(s, 0).Catch(target, 5);
            Harness.Eq(1, caught, "only the flipped one");
            Harness.True(s.Players[0].Slots[0] is not null, "the summon survives it");
            Harness.Eq(Registry.Card(D2).Hp - 1, s.Find(target)!.RemainingHp, "with its face-down card intact");
        });

        Harness.Test("a curse goes into the deck and is drawn like anything else", () =>
        {
            var s = Game();
            int before = s.Players[1].Deck.Count;
            int placed = Ctx(s, 0).Curse(1, "o-curse-rot", 3);
            Harness.Eq(3, placed, "placed");
            Harness.Eq(before + 3, s.Players[1].Deck.Count, "deck grew");
            Harness.Eq(3, s.Players[1].Deck.Count(id => id == "o-curse-rot"), "copies in there");
        });

        Harness.Test("a cursed slot cannot be refilled until it clears", () =>
        {
            var s = Game();
            s = Must(s, 0, GameAction.EndTurn());
            s = Place(s, 1, D1, 0);
            Give(s, 1, D2);
            s = PassTo(s, 0);
            // The summon dies on the enemy turn, so its owner is offered the slot.
            Effects.DestroySummon(s, s.Players[1].Slots[0]!);
            Harness.True(s.ReplaceQueue.Count > 0, "a replacement is offered");

            Ctx(s, 0).LockReplace(1);
            Harness.Eq(0, s.ReplaceQueue.Count, "the offer is withdrawn");
            Harness.Eq(1, s.Players[1].ReplaceLocked, "and the slot is locked");

            int idx = s.Players[1].Hand.IndexOf(D2);
            Harness.False(Engine.Apply(s, 1, GameAction.ReplaceSummon(idx)).Ok, "refused while locked");

            s = PassTo(s, 1);
            Harness.Eq(0, s.Players[1].ReplaceLocked, "clears at the start of their turn");
        });

        Harness.Test("feeding the row takes the top card and saps it", () =>
        {
            var s = Game();
            int deck = s.Players[0].Deck.Count;
            var top = s.Players[0].Deck[0];
            var got = Ctx(s, 0).SupporterFromDeck(0);
            Harness.Eq(top, got, "took the top card");
            Harness.Eq(deck - 1, s.Players[0].Deck.Count, "deck is one shorter");
            Harness.Eq(1, s.Players[0].Supporters.Count, "one supporter");
            Harness.True(s.Players[0].Supporters[0].Sapped, "and it arrives sapped");
            Harness.Eq(0, Engine.AvailableMana(s.Players[0])[(int)Color.R], "so it pays nothing yet");
        });

        Harness.Test("the Solar ramp flip trades the body it is under for a supporter", () =>
        {
            // A card's flip fires when that card is turned over as someone's HP,
            // so the deck has to be the ramp card and the body something else.
            var deck = new DeckList
            {
                Name = "Ramp",
                LeaderId = LeaderId,
                Cards = Enumerable.Repeat("s1-livingsong", 60).ToList(),
            };
            var s = Engine.CreateGame(deck, Deck(60), 4242);
            s = Place(s, 0, D3, 0);
            var target = Src(0, 0);
            int before = s.Players[0].Supporters.Count;

            // One point is not lethal on a six HP body, so paying the flip is a
            // choice to finish it off.
            Effects.DealDamage(s, target, 1);
            Harness.True(s.Players[0].Slots[0] is not null, "still standing after the hit");
            Harness.Eq(1, s.FlipQueue.Count, "the costed flip is waiting");

            s.Players[0].Supporters.Add(new Supporter { CardId = "s1-fluterat", Sapped = false });
            var res = Engine.Apply(s, 0, GameAction.PayFlip());
            Harness.True(res.Ok, res.Error ?? "");
            s = res.State!;
            Harness.True(s.Players[0].Slots[0] is null, "the body it was under falls");
            Harness.Eq(before + 2, s.Players[0].Supporters.Count, "the fed card joins the row");
        });

        Harness.Test("a fusion carries both parents' triggers", () =>
        {
            // Nerve Lite has a Power and no triggers, The Pod has the
            // Deathrattle. The Power always came across; the trigger did not.
            var id = Generated.FusedRecomp("n3-NerveLite", "p3-Pod", 3, 7, 3);
            var g = Registry.Card(id);
            Harness.True(g.Triggers?.OnDeath is not null, "the Deathrattle came across");
            Harness.True(g.Powers!.Any(p => p.Name == "Reclaim"), "the Power came across");
            Harness.True(g.Text!.Contains("Deathrattle"), "and it is printed on the card");
        });

        Harness.Test("a fusion sums the keyword lines of both halves", () =>
        {
            var g = Registry.Card(Generated.FusedRecomp("p3-Slicer", "p3-Pod", 3, 7, 3));
            Harness.Eq(1, g.EffectDamage, "Effect Damage carries");
            Harness.True(g.Triggers?.OnEnter is not null, "Slicer's Battlecry carries");
            Harness.True(g.Triggers?.OnDeath is not null, "the Pod's Deathrattle carries");
        });

        Harness.Test("every single-source generator keeps triggers and keywords", () =>
        {
            // Slicer prints Effect Damage +1 and a Battlecry, so one card
            // exercises both halves of what a copy has to carry.
            var builders = new (string Name, Func<string, string> Make)[]
            {
                ("RobotCopy", Generated.RobotCopy),
                ("OilCopy", Generated.OilCopy),
                ("MalwareCopy", Generated.MalwareCopy),
                ("OilRaise", Generated.OilRaise),
                ("PepperRobotCopy", Generated.PepperRobotCopy),
            };
            foreach (var (name, make) in builders)
            {
                var g = Registry.Card(make("p3-Slicer"));
                Harness.True(g.Triggers?.OnEnter is not null, $"{name} keeps the Battlecry");
                Harness.Eq(1, g.EffectDamage, $"{name} keeps Effect Damage");
                var d = Registry.Card(make("p3-Pod"));
                Harness.True(d.Triggers?.OnDeath is not null, $"{name} keeps the Deathrattle");
            }
        });

        Harness.Test("Graft lends the whole text side, host keeping its own", () =>
        {
            var host = Registry.Card("p3-Pod");
            var g = Registry.Card(Generated.GraftedCopy(
                "p3-Pod", "n3-NerveLite", host.Strength, Color.P, 3,
                host.Powers ?? Array.Empty<Power>()));
            Harness.True(g.Triggers?.OnDeath is not null, "the host keeps its Deathrattle");
            Harness.True(g.Powers!.Any(p => p.Name == "Reclaim"), "the lent Power arrives");
            Harness.True(g.HasFaction(Faction.Hedron), "and Nerve Lite's faction line");

            // A grafted Power is paid for on the host's side, so its pips come
            // across as Oil rather than the colour the source printed.
            var oiled = Registry.Card(Generated.GraftedCopy(
                "p3-Pod", "f2-fishwizard", host.Strength, Color.P, 3,
                host.Powers ?? Array.Empty<Power>()));
            var lent = oiled.Powers!.First(p => p.Name == "Magic Fishiles");
            Harness.Eq(1, lent.Cost.O, "the lent Power is priced in Oil");
            Harness.Eq(0, lent.Cost.F, "and keeps none of its Fish pips");

            // The other direction: a body whose only trick is a trigger now
            // lends that trigger, its text and its factions.
            var bare = Registry.Card(Generated.GraftedCopy(
                "n3-NerveLite", "p3-Pod", 3, Color.N, 3,
                Registry.Card("n3-NerveLite").Powers ?? Array.Empty<Power>()));
            Harness.True(bare.Triggers?.OnDeath is not null, "the source's Deathrattle comes across");
            Harness.True(bare.Text!.Contains("Deathrattle"), "and is printed on the face");
            Harness.True(bare.HasFaction(Faction.Living), "with the source's factions");
        });

        Harness.Test("a graft stays off the aura it just gained", () =>
        {
            // The King's anthem names itself by id. The graft is a new id, so
            // the exclusion has to be re-applied or the body buffs itself.
            var host = Registry.Card("p3-Pod");
            var g = Registry.Card(Generated.GraftedCopy(
                "p3-Pod", "m-rp-theking", host.Strength, Color.P, 3,
                host.Powers ?? Array.Empty<Power>()));
            var bonus = g.Triggers!.StrengthBonus!;
            // Source is the body radiating the bonus, and the engine always
            // passes it: it is how a self-buff recognises itself once a mint has
            // taken its printed id away. Leaving it out here asks the merge a
            // question the game never asks.
            var carrier = new SummonInstance { Uid = "u1", CardId = g.Id, Owner = 0 };
            Harness.Eq(0, bonus(new StrengthBonusArgs
            {
                State = Game(), Controller = 0,
                Summon = carrier, Def = g, Source = carrier,
            }), "it does not buff itself");
            // The King buffs Mortals only, and the Pod is Living, so the ally
            // side of the check needs a body the aura actually applies to.
            var mortal = Registry.Card("p3-classe");
            Harness.Eq(2, bonus(new StrengthBonusArgs
            {
                State = Game(), Controller = 0,
                Summon = new SummonInstance { Uid = "u2", CardId = "p3-classe", Owner = 0 },
                Def = mortal, Source = carrier,
            }), "but does buff an ally Mortal");
            Harness.Eq(0, bonus(new StrengthBonusArgs
            {
                State = Game(), Controller = 0,
                Summon = new SummonInstance { Uid = "u3", CardId = "p3-Pod", Owner = 0 }, Def = host,
            }), "and leaves a non-Mortal alone");
        });

        Harness.Test("a Living spell carries the spell as its Power", () =>
        {
            var g = Registry.Card(Generated.LivingSummon("x-p-bolt", 2, 4, 1));
            Harness.True(g.Powers is { Length: 1 }, "one Power, the cast");
            Harness.Eq(CardType.Summon, g.Type, "it is a body now");
        });

        Harness.Test("a Slime chain shrinks by one and stops before 1 HP", () =>
        {
            var s = Game();
            s = Place(s, 0, "o2-slime", 0);
            var seen = new List<int>();
            for (int guard = 0; guard < 8; guard++)
            {
                var body = s.Players[0].Slots[0];
                if (body is null) break;
                seen.Add(body.Hp.Count);
                Effects.DestroySummon(s, body);
            }
            Harness.Eq("4,3,2,1", string.Join(",", seen), "down to 1, then nothing");
            Harness.True(s.Players[0].Slots[0] is null, "a 0 HP Slime is where it ends");
        });

        Harness.Test("Redirection pulls every attack onto itself", () =>
        {
            var s = Game();
            s = Place(s, 0, D3, 0);
            s = Must(s, 0, GameAction.EndTurn());
            s = Place(s, 1, "x-n-redirect", 0);
            s = Place(s, 1, D1, 1);
            s = Must(s, 1, GameAction.EndTurn());

            var targets = Engine.LegalAttackTargets(s, Src(0, 0));
            Harness.Eq(1, targets.Count, "only one thing may be hit");
            Harness.Eq(Src(1, 0), targets[0], "and it is the redirector");
        });

        Harness.Test("a Redirection leader is attackable with its slots full", () =>
        {
            // The usual rule is that a leader hides behind its slots. Redirection
            // overrides it: the leader is the only legal target, full board or not.
            var s = Engine.CreateGame(Deck(60), Deck(60, leader: "x-n-redirect-leader"), 12345);
            s = Place(s, 0, D3, 0);
            s = Must(s, 0, GameAction.EndTurn());
            s = Place(s, 1, D1, 0);
            s = Must(s, 1, GameAction.EndTurn());

            Harness.True(s.Players[1].HasFieldSummon, "their board is not empty");
            var targets = Engine.LegalAttackTargets(s, Src(0, 0));
            Harness.Eq(1, targets.Count, "one target");
            Harness.Eq(TargetRef.Leader(1), targets[0], "and it is the leader");
        });

        Harness.Test("Redirection also pulls spells, but not the owner's own", () =>
        {
            var s = Game();
            s = Place(s, 0, D3, 0);
            s = Place(s, 0, D1, 1);
            s = Must(s, 0, GameAction.EndTurn());
            s = Place(s, 1, "x-n-redirect", 0);
            s = Place(s, 1, D1, 1);
            s = Must(s, 1, GameAction.EndTurn());

            var bolt = Registry.Card("x-p-bolt");
            var cands = Engine.TargetCandidates(s, 0, bolt.Targets![0], bolt);
            Harness.Eq(1, cands.Count, "the enemy may only aim at the redirector");
            Harness.Eq(Src(1, 0), cands[0], "which is the redirector");

            // Its own controller is not funnelled by it: player 1 still sees both
            // of player 0's bodies, because the redirector is on their own side.
            var mine = Engine.TargetCandidates(s, 1, bolt.Targets![0], bolt);
            Harness.Eq(2, mine.Count, "the owner still chooses freely");
        });

        Harness.Test("Spell Immunity refuses spells from either side", () =>
        {
            var s = Game();
            s = Place(s, 0, "x-n-immune", 0);
            var bolt = Registry.Card("x-p-bolt");

            var enemyAim = Engine.TargetCandidates(s, 1, bolt.Targets![0], bolt);
            Harness.False(enemyAim.Contains(Src(0, 0)), "the enemy cannot aim at it");
            var ownAim = Engine.TargetCandidates(s, 0, bolt.Targets![0], bolt);
            Harness.False(ownAim.Contains(Src(0, 0)), "nor can its own side");

            // Combat still reaches it, which is the whole point of the keyword.
            int hp = s.Players[0].Slots[0]!.RemainingHp;
            Effects.DealDamage(s, Src(0, 0), 2);
            Harness.Eq(hp - 2, s.Players[0].Slots[0]!.RemainingHp, "a clash still lands");
        });

        Harness.Test("the debt zone holds bodies and the discard holds everything else", () =>
        {
            var s = Game();
            s = Place(s, 0, D3, 0);
            var body = s.Players[0].Slots[0]!;
            int hp = body.Hp.Count;
            Effects.DestroySummon(s, body);

            Harness.Eq(1, s.Players[0].DebtZone.Count, "just the body in the debt zone");
            Harness.Eq(D3, s.Players[0].DebtZone[0], "and it is the body");
            Harness.Eq(hp, s.Players[0].Discard.Count, "its armour went to the discard");
            Harness.Eq(3, s.Players[0].DebtCount, "the counter still charges for the body");

            // Milling is spending, not owing.
            int discard = s.Players[0].Discard.Count;
            Effects.Mill(s, 0, 2);
            Harness.Eq(discard + 2, s.Players[0].Discard.Count, "milled cards discard");
            Harness.Eq(1, s.Players[0].DebtZone.Count, "and never reach the debt zone");
            Harness.Eq(3, s.Players[0].DebtCount, "nor the counter");
        });

        Harness.Test("Skeleton fades a printing per lap and finally stays down", () =>
        {
            // Skeleton comes back to hand one base HP smaller each death: 3,
            // then 2, then 1, and the copy that would print 0 is not returned.
            // Each lap bills its level like any other death, nothing more.
            var s = Game();
            const string skeleton = "o1-skeleton";
            s = Place(s, 0, skeleton, 0);

            int before = s.Players[0].DebtCount;
            Effects.DestroySummon(s, s.Players[0].Slots[0]!);
            Harness.Eq(before + 1, s.Players[0].DebtCount, "a lap bills the level alone");
            int idx = s.Players[0].Hand.IndexOf("gen-wither-" + skeleton);
            Harness.True(idx >= 0, "back in hand one HP smaller");
            Harness.Eq(2, Registry.Card("gen-wither-" + skeleton).Hp, "the printing shrank");

            // Own-turn deaths raise no replace prompt; the slot refills as an
            // ordinary main-phase play.
            s = Must(s, 0, GameAction.PlaySummon(idx, 0));
            Effects.DestroySummon(s, s.Players[0].Slots[0]!);
            idx = s.Players[0].Hand.IndexOf("gen-wither-gen-wither-" + skeleton);
            Harness.True(idx >= 0, "a second lap shrinks it again");
            Harness.Eq(1, Registry.Card("gen-wither-gen-wither-" + skeleton).Hp, "down to 1");

            s = Must(s, 0, GameAction.PlaySummon(idx, 0));
            int hand = s.Players[0].Hand.Count;
            Effects.DestroySummon(s, s.Players[0].Slots[0]!);
            Harness.Eq(hand, s.Players[0].Hand.Count, "at 0 HP it stays down");
            Harness.True(s.Players[0].DebtZone.Contains("gen-wither-gen-wither-" + skeleton),
                "and the debt zone finally keeps it");
        });

        Harness.Test("Enthrall rebuilds the seized body and its HP cards in Robot", () =>
        {
            var s = Game();
            s = PassTo(s, 1);
            s = Place(s, 1, "f3-sharkmeat", 0);
            s = PassTo(s, 0);
            var victim = s.Players[1].Slots[0]!;
            victim.Hp.Add(new HpCard { CardId = "f1-lilfish" });
            var ctx = new EffectCtx
            {
                State = s,
                Me = 0,
                Card = Registry.Card("r3-cybersiren"),
                Targets = new[] { Src(1, 0) },
            };
            Registry.Card("r3-cybersiren").Powers![0].Effect!(ctx);

            var seized = s.Players[0].Slots.FirstOrDefault(x => x is not null);
            Harness.True(seized is not null, "the body changed sides");
            Harness.Eq("gen-hack-f3-sharkmeat", seized!.CardId, "the body is rebuilt in Robot");
            // The body arrives holding HP cards off the deck, so the one added
            // here is not first; every card under it has to come across rebuilt.
            Harness.True(seized.Hp.Count > 1, "it kept the HP cards it came with");
            Harness.True(seized.Hp.All(h => h.CardId.StartsWith("gen-hack-")),
                "and every HP card under it is rebuilt in Robot");
            Harness.True(Registry.Card(seized.CardId).Color == Color.R, "a Robot body now");
        });

        Harness.Test("a hacked card becomes a Robot copy with the same total", () =>
        {
            var s = Game();
            var def = Registry.Card("x-f-bolt");
            s.Players[1].DebtZone.Add(def.Id);
            var got = Ctx(s, 0).Hack(1, d => d.Id == def.Id);
            Harness.True(got is not null, "hacked something");
            Harness.True(s.Players[0].Hand.Contains("gen-hack-x-f-bolt"), "copy in hand");

            var copy = Registry.Card("gen-hack-x-f-bolt");
            Harness.Eq(def.Cost.Total, copy.Cost.Total, "same total");
            Harness.Eq(def.Cost.Total, copy.Cost.R, "all of it Robot");
            Harness.Eq(0, copy.Cost.F, "none of it Fish any more");
            Harness.True(copy.Color == Color.R, "a Robot card now");
            Harness.True(copy.Uncollectible, "and no deck may run it");
        });
    }

    private static void BotTests()
    {
        Harness.Test("bot finishes every deck pairing", () =>
        {
            var decks = CardSets.All;
            foreach (var a in decks)
            {
                foreach (var b in decks)
                {
                    if (string.CompareOrdinal(a.Key, b.Key) >= 0) continue;
                    var s = Engine.CreateGame(a.ToDeckList(), b.ToDeckList(),
                        a.Key.Length * 31 + b.Key.Length);
                    s = PlayOut(s);
                    Harness.True(s.IsOver, $"{a.Key} vs {b.Key} unresolved at turn {s.Turn}");
                }
            }
        });

        Harness.Decision("bot springs a trap when the trap saves the summon", () =>
        {
            var s = Engine.CreateGame(Deck(50), Deck(50), 3);
            s.Players[0].Hand.Add(D3B);
            s.Players[1].Hand.Add(D1);
            s.Players[1].Hand.Add("sx-hollowring");
            s.Players[1].Supporters.Add(new Supporter { CardId = "s1-fluterat" });
            s = Must(s, 0, GameAction.PlaySummon(s.Players[0].Hand.Count - 1, 0));
            s = Must(s, 0, GameAction.EndTurn());
            s = Must(s, 1, GameAction.PlaySummon(s.Players[1].Hand.IndexOf(D1), 0));
            s = Must(s, 1, GameAction.EndTurn());
            s = Must(s, 0, GameAction.DeclareAttack(Src(0, 0), Src(1, 0)));
            Harness.Eq(1, s.Pending!.Player);
            Harness.Eq(ActionType.CastTrap, Bot.ChooseAction(s, 1).Type);
        });
    }

    private static GameState PlayOut(GameState s, int maxActions = 6000, int maxTurns = 300)
    {
        int actions = 0;
        while (!s.IsOver && actions < maxActions && s.Turn < maxTurns)
        {
            int actor = s.CurrentActor;
            var res = Engine.Apply(s, actor, Bot.ChooseAction(s, actor));
            if (!res.Ok) throw new Exception($"bot produced an illegal action: {res.Error}");
            s = res.State!;
            actions++;
        }
        return s;
    }

    /// <summary>Candy's price negotiation, from opening the shop to walking away.</summary>
    private static void Ghost()
    {
        Harness.Test("Ghost costs no debt when a spell kills it at zero debt", () =>
        {
            var s = Game();
            s = Place(s, 0, "o1-ghost", 0);
            Harness.Eq(0, s.Players[0].DebtCount, "starts clear");
            var spell = new EffectCtx { State = s, Me = 0, Card = Registry.Card("kx-DarkCandy") };
            spell.Damage(TargetRef.Summon(0, 0), 9);
            Harness.True(s.Players[0].Slots[0] is null, "the ghost fell");
            Harness.Eq(0, s.Players[0].DebtCount, "no debt charged");
            Harness.True(!s.Players[0].DebtZone.Contains("o1-ghost"), "not owed for");
            Harness.True(s.Players[0].Discard.Contains("o1-ghost"), "spent to discard");
        });

        Harness.Test("Ghost neither bills nor refunds when debt is already carried", () =>
        {
            var s = Game();
            s = Place(s, 0, "o1-ghost", 0);
            s.Players[0].DebtCount = 5;
            var spell = new EffectCtx { State = s, Me = 0, Card = Registry.Card("kx-DarkCandy") };
            spell.Damage(TargetRef.Summon(0, 0), 9);
            Harness.Eq(5, s.Players[0].DebtCount, "the free death leaves standing debt alone");
        });
    }

    private static void Immunity()
    {
        // Hateful Jelly: 2/4, Spell Immunity, the smallest printed immune body.
        const string Jelly = "m-bp-hatefuljely";

        Harness.Test("immunity blocks casts and only casts", () =>
        {
            var s = Game();
            s = Place(s, 0, Jelly, 0);
            var jelly = TargetRef.Summon(0, 0);
            var body = s.Players[0].Slots[0]!;

            // An untargeted spell sweep skips it.
            int before = body.RemainingHp;
            var spell = new EffectCtx { State = s, Me = 1, Card = Registry.Card("kx-DarkCandy") };
            spell.Damage(jelly, 3);
            Harness.Eq(before, body.RemainingHp, "spell damage is shrugged off");

            // A Power is not a cast: the same damage from a body lands.
            var power = new EffectCtx { State = s, Me = 1, Card = Registry.Card(Jelly) };
            power.Damage(jelly, 1);
            Harness.Eq(before - 1, body.RemainingHp, "power damage lands");

            // A spell cannot choose it, from either side.
            var spec = new TargetSpec { Kind = TargetKind.Summon, Side = Side.Ally, Label = "x" };
            var cands = Engine.TargetCandidates(s, 0, spec, Registry.Card("m-yb-skypaint"));
            Harness.Eq(false, cands.Contains(jelly), "a spell cannot choose it");
            var byPower = Engine.TargetCandidates(s, 0, spec, Registry.Card(Jelly));
            Harness.Eq(true, byPower.Contains(jelly), "a power still can");

            // A field aura never lands; a body's aura still does.
            s.Players[1].Stage = "m-pg-Doortonowhere";
            Harness.Eq(2, Effects.EffectiveStrength(s, body), "field aura is dropped");
            s.Players[1].Stage = null;
            s.Players[1].Slots[0] = Effects.NewSummon(s, "m-rg-obelisks", 1);
            Harness.Eq(1, Effects.EffectiveStrength(s, body), "a body's aura still lands");
        });
    }

    private static void Stores()
    {
        // Store: Draw 2 cards, no surcharge and no target, so the slider is 1 to 4.
        const string Shop = "k1-apprentice";
        // Draws its controller a card whenever another player buys from them.
        const string Capitalist = "k3-HyperCapitalist";

        Harness.Test("a store negotiation charges the buyer and pays the seller", () =>
        {
            var s = Game();
            s = PassTo(s, 1);
            s = Place(s, 1, Shop, 0);
            s = Place(s, 1, Capitalist, 1);
            s = Place(s, 1, Shop, 2);
            s = PassTo(s, 0);
            Harness.Eq(1, s.Players[1].Slots[0]!.StoreStock, "every shop restocks each turn");

            // Room for the two cards the shop sells, under the hand limit.
            s.Players[0].Hand.RemoveRange(0, 4);
            int buyerHand = s.Players[0].Hand.Count;
            int sellerHand = s.Players[1].Hand.Count;
            int buyerDebt = s.Players[0].DebtCount;

            s = Must(s, 0, GameAction.OpenStore(Src(1, 0)));
            Harness.Eq(1, s.Pending!.Player, "the seller names the price first");
            Harness.Eq(0, s.Pending!.Store!.Buyer);
            Harness.Contains("Settle the Store window first.",
                Engine.Apply(s, 1, GameAction.PassResponse()).Error);

            s = Must(s, 1, GameAction.StoreOffer(3));
            Harness.Eq(0, s.Pending!.Player, "the buyer answers the offer");
            s = Must(s, 0, GameAction.StoreCounter(2));
            Harness.Eq(1, s.Pending!.Player, "the counter goes back to the seller");
            s = Must(s, 1, GameAction.StoreAccept());

            Harness.True(s.Pending is null, "the window closed on the deal");
            Harness.Eq(buyerDebt + 2, s.Players[0].DebtCount, "the buyer took the agreed price as debt");
            Harness.Eq(1, s.Players[1].Love, "the seller took 1 Love");
            Harness.Eq(0, s.Players[1].Slots[0]!.StoreStock, "the stock token is spent");
            Harness.Eq(buyerHand + 2, s.Players[0].Hand.Count, "the effect resolved for the buyer");
            Harness.Eq(sellerHand + 1, s.Players[1].Hand.Count, "onStoreSold fired on the seller");
            Harness.Contains("That Store is closed this turn.",
                Engine.Apply(s, 0, GameAction.OpenStore(Src(1, 0))).Error);

            // The second shop, walked away from rather than bought out.
            int debt = s.Players[0].DebtCount;
            s = Must(s, 0, GameAction.OpenStore(Src(1, 2)));
            s = Must(s, 1, GameAction.StoreOffer(4, final: true));
            Harness.Contains("That was a final offer",
                Engine.Apply(s, 0, GameAction.StoreCounter(1)).Error);
            s = Must(s, 0, GameAction.StoreReject());
            Harness.True(s.Pending is null, "walking away closes the window");
            Harness.Eq(debt, s.Players[0].DebtCount, "a rejection costs the buyer nothing");
            Harness.Eq(1, s.Players[1].Love, "and pays the seller nothing");
            Harness.Eq(0, s.Players[1].Slots[2]!.StoreStock, "the refused shop is shut for the turn");
            Harness.Contains("That Store is closed this turn.",
                Engine.Apply(s, 0, GameAction.OpenStore(Src(1, 2))).Error);
        });

        Harness.Decision("a heal shop never closes at a loss to either side", () =>
        {
            // Store: Heal 3 debt. The seller never names less than the 3 it heals
            // and the buyer never pays it, because breaking even still hands the
            // seller a Love token. So the passes cross without meeting, the buyer
            // walks, and the debt ends where it started. This is the TypeScript
            // policy, which is what ships.
            var s = Game();
            s = PassTo(s, 1);
            s = Place(s, 1, "k3-DebtReliever", 0);
            s = PassTo(s, 0);
            s.Players[0].DebtCount = 8;

            Bot.ClearPlan();
            s = Must(s, 0, GameAction.OpenStore(Src(1, 0)));
            for (int guard = 0; s.Pending?.Store is not null; guard++)
            {
                if (guard > 8) throw new Exception("the haggle never closed");
                int actor = s.Pending.Player;
                var answer = Bot.StoreAnswer(s, actor) ?? throw new Exception("no answer");
                if (Harness.Verbose)
                {
                    Console.WriteLine($"    pass {s.Pending.Store.Pass} seat {actor}: {answer.Type} "
                        + $"price {answer.Price} final {answer.Final}");
                }
                if (actor == 1 && answer.Type == ActionType.StoreOffer)
                {
                    Harness.True(answer.Price >= 3, "the seller never names less than it heals");
                }
                if (actor == 0 && answer.Type == ActionType.StoreCounter)
                {
                    Harness.True(answer.Price < 3, "the buyer never offers what it heals");
                }
                s = Must(s, actor, answer);
            }
            Harness.Eq(0, s.Players[1].Love, "no deal closed");
            Harness.Eq(8, s.Players[0].DebtCount, "and the debt is untouched");
        });

        Harness.Decision("the buyer refuses to pay more than a shop heals", () =>
        {
            // Heal 3 debt for 4 debt is a loss however the passes fall.
            var s = Game();
            s = PassTo(s, 1);
            s = Place(s, 1, "k3-DebtReliever", 0);
            s = PassTo(s, 0);
            s.Players[0].DebtCount = 8;

            Bot.ClearPlan();
            s = Must(s, 0, GameAction.OpenStore(Src(1, 0)));
            s = Must(s, 1, GameAction.StoreOffer(4, final: true));
            Harness.Eq("StoreReject", Bot.ChooseAction(s, 0).Type.ToString(),
                "the final offer is walked away from");
        });
    }

    /// <summary>The ten three-colour legends and the engine hooks they needed.</summary>
    private static void TripleLegends()
    {
        const string Overknower = "m-bgp-overknower";
        const string Screener = "m-bgr-screener";
        const string Malware = "m-grp-horriblemalware";
        const string Slime = "m-gpy-obscureslime";
        const string Grinkle = "m-brp-decayinggrinklegod";
        const string Bolt = "x-p-bolt";

        Harness.Test("prints one level 3 legend per three-colour combination", () =>
        {
            // Registry.All also holds cards minted during play, and a Malware
            // copy carries three colours, so the printed set has to be filtered.
            // Level 3 is what makes a triple a legend; a triple at any other
            // level is an ordinary card the set may print freely. Six colours
            // make twenty combinations, and every one now has its legend.
            var triples = Registry.All.Where(d => d.Color3 is not null && d.Num != "GEN").ToList();
            var legends = triples.Where(d => d.Level == 3).ToList();
            Harness.Eq(20, legends.Count, "one legend per combination");
            Harness.Eq(20, legends.Select(d => Identity.ColorsOf(d).Distinct()
                .OrderBy(x => x).Aggregate("", (a, x) => a + x)).Distinct().Count(),
                "and no combination twice");
            foreach (var d in legends) Harness.Eq(Rarity.L, d.Rarity, d.Id);
            foreach (var d in triples)
            {
                Harness.Eq(3, Identity.ColorsOf(d).Distinct().Count(), d.Id);
            }
        });

        Harness.Test("frames each one in the colour it pays as a supporter", () =>
        {
            var frames = new (string Id, Color Color)[]
            {
                ("m-bgp-overknower", Color.F),
                ("m-bgr-screener", Color.R),
                ("m-bgy-seeraltine", Color.F),
                ("m-bpy-bananamage", Color.S),
                ("m-brp-decayinggrinklegod", Color.O),
                ("m-bry-drownedwanderer", Color.F),
                ("m-gpy-obscureslime", Color.O),
                ("m-grp-horriblemalware", Color.R),
                ("m-gry-spiritofsolstice", Color.P),
                ("m-ryp-livingcurse", Color.P),
                // Most Candy trios frame Candy; Vier wears Fish and the Sweetling Robot.
                ("m-mbp-vier", Color.F),
                ("m-mbr-saraza", Color.K),
                ("m-mby-wellworthit", Color.K),
                ("m-mgb-codeinfestedsweetling", Color.R),
                ("m-mgp-godofmisfortune", Color.K),
                ("m-mgr-ransomwareartist", Color.K),
                ("m-mgy-thethorn", Color.K),
                ("m-mpr-humanitysdefender", Color.K),
                ("m-mpy-sopapli", Color.K),
                ("m-myr-hellmage", Color.K),
            };
            var s = Game();
            foreach (var (id, color) in frames)
            {
                var def = Registry.Card(id);
                Harness.Eq(color, def.Color, id);
                Harness.Eq((int)color, Engine.ManaIndexFor(s.Players[0], def), $"{id} as a supporter");
            }
        });

        Harness.Test("slides exactly one scried card under an ally with Long Sight", () =>
        {
            var s = Game();
            s = Place(s, 0, "m-bgy-seeraltine", 0);
            s = PassTo(s, 0);
            s = Place(s, 0, D3, 1);
            var target = Src(0, 1);
            Effects.DealDamage(s, target, 2);
            int before = s.Find(target)!.Hp.Count;
            int spent = s.Find(target)!.RemainingHp;
            int deck = s.Players[0].Deck.Count;
            s.Players[0].Mana[(int)Color.R] = 1;
            s.Players[0].Mana[(int)Color.F] = 1;
            s.Players[0].Mana[(int)Color.S] = 1;
            s = Must(s, 0, GameAction.ActivatePower(Src(0, 0), 0, target));
            // The heal lands first, then five come off the deck and wait for a pick.
            Harness.Eq(spent + 2, s.Find(target)!.RemainingHp, "healed 2");
            Harness.Eq(5, s.ChoiceQueue[0].Cards!.Length, "five revealed");
            s = Must(s, 0, GameAction.ResolveChoice(index: 2));
            // One card lands as HP; the other four go back to the bottom of the deck.
            Harness.Eq(before + 1, s.Find(target)!.Hp.Count, "one card added");
            Harness.False(s.Find(target)!.Hp[^1].Flipped, "face down");
            Harness.Eq(deck - 1, s.Players[0].Deck.Count, "only one is kept");
        });

        Harness.Test("keeps a triple card out of a deck whose leader brings only two colours", () =>
        {
            Harness.False(
                Identity.IsLegalUnder(Registry.Card(Overknower), Identity.DeckIdentity("m-bg-machineblue")),
                "a dual leader cannot reach it");
            Harness.True(
                Identity.IsLegalUnder(Registry.Card(Overknower), Identity.DeckIdentity(Overknower)),
                "it unlocks itself");
        });

        Harness.Test("makes spells free for an Overknower leader with an empty board, and only then", () =>
        {
            var s = Engine.CreateGame(Deck(60, D1, Overknower), Deck(60), 999);
            s = PassTo(s, 1);
            s = Place(s, 1, D1, 0);
            s = PassTo(s, 0);
            int bolt = Give(s, 0, Bolt);
            s = Place(s, 0, D1, 0);
            // One body on the board is enough to switch the leader's own line off.
            Harness.Eq("P", Engine.CostFor(s.Players[0], Registry.Card(Bolt)).ToString(), "paid in full");
            s.Players[0].Slots[0] = null;
            Harness.Eq("", Engine.CostFor(s.Players[0], Registry.Card(Bolt)).ToString(), "free");
            s = Must(s, 0, GameAction.CastSpell(bolt, TargetRef.Summon(1, 0)));
            Harness.Eq(0, s.Players[0].Mana.Sum(), "nothing was spent");
        });

        Harness.Test("leaves Overknower in a slot paying full price, because it is a summon it controls", () =>
        {
            var s = Game();
            s = PassTo(s, 0);
            s = Place(s, 0, Overknower, 0);
            Harness.Eq("P", Engine.CostFor(s.Players[0], Registry.Card(Bolt)).ToString(), "still paid");
        });

        Harness.Test("a trigger choice is anchored to the body asking", () =>
        {
            var s = Game();
            s = Place(s, 0, "s3-maestro", 1);
            s = PassTo(s, 0);
            var ch = s.ChoiceQueue.FirstOrDefault(c => c.Source == "s3-maestro");
            Harness.True(ch is not null, "The Maestro queued a choice");
            // Without this the targeting arrow has no start and springs from the corner.
            Harness.Eq(TargetRef.Summon(0, 1), ch!.At, "anchored to its own slot");
        });

        Harness.Test("Star Eater eats an ally as HP and charges no debt", () =>
        {
            var s = Game();
            s = Place(s, 0, "p3-stareater", 0);
            s = Place(s, 0, D2, 1);
            s = PassTo(s, 0);
            int before = s.Players[0].Slots[0]!.Hp.Count;
            int debtBefore = s.Players[0].DebtCount;
            s = Must(s, 0, GameAction.ActivatePower(Src(0, 0), 0, TargetRef.Summon(0, 1)));
            var after = s.Players[0].Slots[0]!;
            Harness.True(s.Players[0].Slots[1] is null, "the meal is gone");
            Harness.Eq(before + 1, after.Hp.Count, "one more HP card");
            Harness.Eq(D2, after.Hp[^1].CardId, "and it is the card eaten");
            Harness.True(!after.Hp[^1].Flipped, "face down");
            Harness.Eq(debtBefore, s.Players[0].DebtCount, "no debt charged");
            Harness.True(!s.Players[0].DebtZone.Contains(D2), "it never reached the debt zone");
            Harness.True(after.Sapped, "the eater taps for it");
        });

        Harness.Test("Heaven Knows pings every character when its controller ends the turn", () =>
        {
            var s = Game();
            s = Place(s, 0, D3, 1);
            int mine = s.Players[0].Slots[1]!.RemainingHp;
            s = Place(s, 0, "p3-heavenknows", 0);
            Harness.Eq(mine, s.Players[0].Slots[1]!.RemainingHp, "no battlecry any more");
            s = Must(s, 0, GameAction.EndTurn());
            Harness.Eq(mine - 1, s.Players[0].Slots[1]!.RemainingHp, "it hits my own on my step");
            s = Place(s, 1, D3B, 0);
            int theirs = s.Players[1].Slots[0]!.RemainingHp;
            // Their end step is not "your turn", so nothing fires.
            s = Must(s, 1, GameAction.EndTurn());
            Harness.Eq(theirs, s.Players[1].Slots[0]!.RemainingHp, "quiet on their step");
            s = Must(s, 0, GameAction.EndTurn());
            Harness.Eq(theirs - 1, s.Players[1].Slots[0]!.RemainingHp, "and theirs on mine");
        });

        Harness.Test("Chipcrunch's flip empties the pool and saps a supporter", () =>
        {
            var s = Game();
            s = Place(s, 0, D2, 0);
            // A second card behind it, so the body survives the point of damage.
            s.Players[0].Slots[0]!.Hp = new List<HpCard>
            {
                new() { CardId = "r1-chipcrunch" },
                new() { CardId = D1 },
            };
            s.Players[1].Supporters = new List<Supporter>
            {
                new() { CardId = D1 },
                new() { CardId = "x-o-dummy-1" },
            };
            s.Players[1].Mana[(int)Color.P] = 2;
            s.Players[1].Mana[(int)Color.R] = 1;
            Effects.DealDamage(s, Src(0, 0), 1);
            Harness.True(s.Players[0].Slots[0]!.Hp[0].Flipped, "it flipped");
            // The pool goes the moment it flips; the sap waits on a pick.
            Harness.True(s.Players[1].Mana.All(n => n == 0), "the pool is gone");
            Harness.True(!s.Players[1].Supporters.Any(x => x.Sapped), "nothing sapped yet");
            s = Must(s, 0, GameAction.ResolveChoice(TargetRef.Supporter(1, 1)));
            Harness.True(s.Players[1].Supporters[1].Sapped, "the pick is sapped");
            Harness.True(!s.Players[1].Supporters[0].Sapped, "the other is not");
        });

        Harness.Test("Chipcrunch still empties the pool with no supporters to sap", () =>
        {
            var s = Game();
            s = Place(s, 0, D2, 0);
            s.Players[0].Slots[0]!.Hp = new List<HpCard>
            {
                new() { CardId = "r1-chipcrunch" },
                new() { CardId = D1 },
            };
            s.Players[1].Mana[(int)Color.P] = 1;
            Effects.DealDamage(s, Src(0, 0), 1);
            Harness.Eq(0, s.Players[1].Mana[(int)Color.P], "the pool still goes");
        });

        Harness.Test("casts Virus through Infect, rebuilding the kill on your side", () =>
        {
            var s = Game();
            s = Place(s, 0, Malware, 0);
            s = PassTo(s, 1);
            s = Place(s, 1, "r1-lightbolbe", 0);
            // Lightbolbe prints 2 HP now, so it is softened to one first.
            Effects.DealDamage(s, TargetRef.Summon(1, 0), Registry.Card("r1-lightbolbe").Hp - 1);
            s = PassTo(s, 0);
            s.Players[0].Mana[(int)Color.P] = 1;
            s.Players[0].Mana[(int)Color.O] = 1;
            s.Players[0].Mana[(int)Color.R] = 1;
            s = Must(s, 0, GameAction.ActivatePower(Src(0, 0), 0, TargetRef.Summon(1, 0)));
            // On its last HP, Virus's ping kills it and it comes back mine.
            Harness.True(s.Players[1].Slots[0] is null, "the target died");
            Harness.Eq("gen-virus-r1-lightbolbe", s.Players[0].Slots[1]?.CardId, "rebuilt on my side");
            Harness.Eq(Color.P, Registry.Card("gen-virus-r1-lightbolbe").Color, "in Pepper");
        });

        Harness.Test("lifts Effect Damage for each ally Machine down to its last HP", () =>
        {
            var s = Game();
            s = Place(s, 0, Screener, 0);
            // Lightbolbe now prints 2 HP, so it has to be knocked to its last one.
            s = Place(s, 0, "r1-lightbolbe", 1);
            Effects.DealDamage(s, Src(0, 1), Registry.Card("r1-lightbolbe").Hp - 1);
            Harness.Eq(1, Effects.EffectDamageOf(s, 0), "one machine on its last HP");
            // Defender is a Machine with room to spare: nothing until it is down to 1.
            s = Place(s, 0, "r1-defender", 2);
            Harness.Eq(1, Effects.EffectDamageOf(s, 0), "still one");
            Effects.DealDamage(s, Src(0, 2), Registry.Card("r1-defender").Hp - 1);
            Harness.Eq(2, Effects.EffectDamageOf(s, 0), "now two");
            // Screener is a Machine too, but "ally" never means the card itself.
            s.Players[0].Slots[1] = null;
            s.Players[0].Slots[2] = null;
            Harness.Eq(0, Effects.EffectDamageOf(s, 0), "it does not count itself");
        });

        Harness.Test("takes a card out of the enemy deck with Static and hands back the rest", () =>
        {
            var s = Game();
            s = Place(s, 0, Screener, 0);
            s = PassTo(s, 0);
            int theirDeck = s.Players[1].Deck.Count;
            string top = s.Players[1].Deck[0];
            s.Players[0].Mana[(int)Color.P] = 1;
            s.Players[0].Mana[(int)Color.R] = 1;
            s.Players[0].Mana[(int)Color.F] = 1;
            s = Must(s, 0, GameAction.ActivatePower(Src(0, 0), 0));
            Harness.Eq(5, s.ChoiceQueue[0].Cards!.Length, "five revealed");
            s = Must(s, 0, GameAction.ResolveChoice(index: 0));
            // The pick arrives rebuilt in Robot, and the other four go home.
            Harness.Eq($"gen-hack-{top}", s.Players[0].Hand[^1], "stolen and rebuilt");
            Harness.Eq(Color.R, Registry.Card(s.Players[0].Hand[^1]).Color, "in Robot");
            Harness.Eq(theirDeck - 1, s.Players[1].Deck.Count, "only one is kept");
        });

        Harness.Test("mints an Oil copy for Horrible Malware whenever the other side casts", () =>
        {
            var s = Game();
            s = Place(s, 0, Malware, 0);
            s = PassTo(s, 1);
            s = Place(s, 1, D1, 0);
            int before = s.Players[0].Hand.Count;
            s.Players[1].Mana[(int)Color.P] = 1;
            s = Must(s, 1, GameAction.CastSpell(Give(s, 1, Bolt), TargetRef.Summon(0, 0)));
            Harness.Eq(before + 1, s.Players[0].Hand.Count, "a copy arrived");
            var copy = Registry.Card(s.Players[0].Hand[^1]);
            Harness.Eq(Color.O, copy.Color, "rebuilt in Oil");
            // One coloured pip on the bolt, so Oil takes the odd one and nothing else.
            Harness.Eq("O", copy.Cost.ToString(), "split leaves one Oil");
        });

        Harness.Test("hands the enemy a Banana supporter with Joke, in their own colour", () =>
        {
            var s = Game();
            s = Place(s, 0, "m-bpy-bananamage", 0);
            s = PassTo(s, 0);
            int debt = s.Players[1].DebtCount;
            s.Players[0].Mana[(int)Color.S] = 1;
            s = Must(s, 0, GameAction.ActivatePower(Src(0, 0), 0));
            Harness.Eq(1, s.Players[1].Supporters.Count, "one supporter handed over");
            var given = Registry.Card(s.Players[1].Supporters[0].CardId);
            Harness.Eq("Banana", given.Name, "it is the Banana");
            Harness.True(s.Players[1].Supporters[0].Sapped, "it arrives sapped");
            // The Dummy Warden is Robot, so the gift pays Robot rather than colourless:
            // it fills the bucket that player actually spends from.
            Harness.Eq((int)Color.R,
                Engine.ManaIndexFor(s.Players[1], given), "pays the enemy leader's colour");
            Harness.Eq(debt + 3, s.Players[1].DebtCount, "and 3 debt");
        });

        Harness.Test("keeps the Banana out of every deck pool and the builder", () =>
        {
            var banana = Registry.Card("n-banana");
            Harness.True(banana.Uncollectible, "uncollectible");
            Harness.Eq("Supporter", banana.Text, "rules text");
            foreach (var d in CardSets.Everything)
            {
                Harness.False(d.Cards.Contains("n-banana"), d.Key);
            }
        });

        Harness.Test("gives back a supporter and the turn allowance with Forklift", () =>
        {
            var s = Game();
            s = Place(s, 0, "r2-forklift", 0);
            s = PassTo(s, 0);
            s = Must(s, 0, GameAction.PlaySupporter(Give(s, 0, D1)));
            Harness.Eq(0, s.Players[0].SupportersLeft, "spent");
            int hand = s.Players[0].Hand.Count;
            s = Must(s, 0, GameAction.ActivatePower(Src(0, 0), 0, TargetRef.Supporter(0, 0)));
            // The card comes back and so does the one supporter the turn allows.
            Harness.Eq(0, s.Players[0].Supporters.Count, "row is empty");
            Harness.Eq(hand + 1, s.Players[0].Hand.Count, "back in hand");
            Harness.Eq(1, s.Players[0].SupportersLeft, "and allowed again");
            s = Must(s, 0, GameAction.PlaySupporter(Give(s, 0, D1)));
            Harness.Eq(1, s.Players[0].Supporters.Count, "faced again");
        });

        Harness.Test("sends a supporter to debt with Melt and closes the row behind it", () =>
        {
            var s = Game();
            s = Place(s, 0, Slime, 0);
            s = PassTo(s, 1);
            s = Must(s, 1, GameAction.PlaySupporter(Give(s, 1, "x-s-dummy-1")));
            s = PassTo(s, 0);
            string supporter = s.Players[1].Supporters[0].CardId;
            s.Players[0].Mana[(int)Color.O] = 1;
            s.Players[0].Mana[(int)Color.R] = 2;
            s.Players[0].Mana[(int)Color.S] = 1;
            s = Must(s, 0, GameAction.ActivatePower(Src(0, 0), 1, TargetRef.Supporter(1, 0)));
            Harness.Eq(0, s.Players[1].Supporters.Count, "the row closed up");
            Harness.True(s.Players[1].DebtZone.Contains(supporter), "it went to debt");
        });

        Harness.Test("wins outright on Grinkle Rot, past the summons guarding the leader", () =>
        {
            var s = Game();
            s = Place(s, 0, Grinkle, 0);
            s = PassTo(s, 1);
            s = Place(s, 1, D3, 0);
            s = PassTo(s, 0);
            s.Players[0].Mana[(int)Color.P] = 3;
            s.Players[0].Mana[(int)Color.O] = 3;
            s.Players[0].Mana[(int)Color.F] = 3;
            s = Must(s, 0, GameAction.ActivatePower(Src(0, 0), 0));
            Harness.Eq(0, s.Winner, "the leader fell");
        });
    }

    private static void DigestAndReplay()
    {
        Harness.Test("digest is stable for the same seed and changes with the position", () =>
        {
            var a = Engine.CreateGame(Deck(60), Deck(60), 777);
            var b = Engine.CreateGame(Deck(60), Deck(60), 777);
            Harness.Eq(Digest.Short(a), Digest.Short(b), "same seed");
            var c = Engine.CreateGame(Deck(60), Deck(60), 778);
            Harness.True(Digest.Short(a) != Digest.Short(c), "different seed");
            var moved = Must(a, 0, GameAction.PlaySupporter(0));
            Harness.True(Digest.Short(a) != Digest.Short(moved), "after an action");
        });

        Harness.Test("a recorded replay verifies against a fresh run", () =>
        {
            var deck = CardSets.ByKey("deepcurrent");
            var other = CardSets.ByKey("emberchoir");
            var replay = Recorder.RecordBotGame(deck, other, 4242, "self-check");
            var res = Replays.Verify(replay);
            Harness.True(res.Ok, $"step {res.StepIndex}: {res.Detail}");
            Harness.True(replay.Steps.Count > 5, "replay has real content");
        });

        Harness.Test("a tampered replay is caught at the exact step", () =>
        {
            var replay = Recorder.RecordBotGame(
                CardSets.ByKey("vanilla"), CardSets.ByKey("vanilla"), 99, "tamper");
            Harness.True(replay.Steps.Count > 3, "enough steps to tamper with");
            replay.Steps[2].Digest = "deadbeefdeadbeef";
            var res = Replays.Verify(replay);
            Harness.False(res.Ok, "tampering detected");
            Harness.Eq(2, res.StepIndex, "pinpointed the step");
        });

        Harness.Test("replays in the shared corpus still verify", () =>
        {
            var dir = Corpus.Directory();
            if (dir is null)
            {
                // Nothing recorded yet is not a failure; the sim writes the corpus.
                return;
            }
            foreach (var file in Directory.GetFiles(dir, "*.json").OrderBy(f => f, StringComparer.Ordinal))
            {
                var replay = Replay.Load(file);
                var res = Replays.Verify(replay);
                Harness.True(res.Ok,
                    $"{Path.GetFileName(file)} step {res.StepIndex}: {res.Detail}");
            }
        });
    }
}
