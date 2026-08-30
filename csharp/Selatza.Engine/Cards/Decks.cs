namespace Selatza.Cards;

public sealed class StarterDeck
{
    public required string Key { get; init; }
    public required string Name { get; init; }
    public required string Blurb { get; init; }
    public required string LeaderId { get; init; }
    public required IReadOnlyList<string> Cards { get; init; }
    /// <summary>Test decks exist to exercise one mechanic, not to be balanced.</summary>
    public bool Test { get; init; }

    public DeckList ToDeckList(string? name = null) =>
        new() { Name = name ?? Name, LeaderId = LeaderId, Cards = Cards };
}

public static class CardSets
{
    private static bool _registered;

    /// <summary>Idempotent, so tests and the simulator can both call it freely.</summary>
    public static void RegisterAll()
    {
        if (_registered) return;
        _registered = true;
        Kit.ResetNumbering();
        SharedChoices.Register();
        Registry.Register(Placeholder.Build());
        Registry.Register(Red.Build());
        Registry.Register(Purple.Build());
        Registry.Register(Green.Build());
        Registry.Register(Blue.Build());
        Registry.Register(Yellow.Build());
        Registry.Register(Mixed.Build());
        Triple.Register();
        Registry.Register(Triple.Build());
        Registry.Register(Neutral.Build());
    }

    private static List<string> Build(params (string Id, int Count)[] entries)
    {
        var outList = new List<string>();
        foreach (var (id, n) in entries)
        {
            for (int i = 0; i < n; i++) outList.Add(id);
        }
        return outList;
    }

    public static readonly StarterDeck[] Starters =
    {
        new()
        {
            Key = "emberchoir",
            Name = "Archlife",
            Blurb = "Aggressive swarm of pepper summons empowered by increased effect damage",
            LeaderId = "ph-archlife",
            Cards = Build(
                ("p2-deathknight", 2), ("p3-Pod", 2), ("n3-IneptRuler", 2), ("p3-Looker", 2),
                ("p2-ash demon", 2), ("px-potion", 2), ("n3-AcolyteofGrinkle", 2),
                ("p3-helaks", 2), ("px-flower", 2), ("n3-GrinkleBeast", 2),
                ("nx-ColdBread", 2), ("n2-Smithee", 2), ("p2-pinelyte", 2),
                ("px-planetblast", 2), ("p3-stareater", 2), ("p1-moonkrag", 2),
                ("p3-Tryybus", 2), ("p2-livingfort", 2), ("n1-lizard", 2), ("n1-Wallguy", 2),
                ("px-treasure", 2), ("p2-dragon", 2), ("ph-archlife", 2), ("n3-NerveLite", 2)),
        },
        new()
        {
            Key = "longnoon",
            Name = "Aetus Vox",
            Blurb = "Solar control deck that musters powerful effects after building up additional mana throughout the game.",
            LeaderId = "s3-aetusvox",
            Cards = Build(
                ("n3-IneptRuler", 2), ("s2-livingruin", 2), ("nx-RockThrow", 2),
                ("sx-aetalglob", 2), ("s2-admirer", 2), ("s2-druid", 2), ("s2-ragick", 2),
                ("n3-Seam", 2), ("s2-bubblemancer", 2), ("s2-sunwalker", 2),
                ("sx-inkybook", 2), ("n1-lizard", 2), ("n2-LowWizard", 2), ("n1-Wallguy", 2),
                ("s2-orangefarmer", 2), ("nx-Mousetrap", 2), ("n1-mammal", 2),
                ("s3-brokensun", 2), ("s1-livingboot", 2), ("s1-livingraincloud", 2),
                ("sx-musicalflow", 2), ("sx-flowerpower", 2), ("sx-aetuscollection", 2),
                ("sx-plusfifty", 2)),
        },
        new()
        {
            Key = "rustmire",
            Name = "Cyber Siren",
            Blurb = "Machine and traps that stall the game until Enthrall steals the enemies best cards",
            LeaderId = "r3-cybersiren",
            Cards = Build(
                ("rx-grab", 2), ("r3-strangestation", 2), ("rh-player1", 2),
                ("r1-slicebot", 2), ("r2-digital nomad", 2), ("n3-IneptRuler", 2),
                ("r3-chemicalmen", 2), ("n3-Seam", 2), ("rx-battery", 2), ("n1-Wallguy", 2),
                ("n2-SecretLetter", 2), ("rx-stundevice", 2), ("rx-connect", 2),
                ("r2-badglitch", 2), ("r2-securitybot", 2), ("rx-plugzap", 2), ("n3-Ivy", 2),
                ("n1-weirdBird", 2), ("rx-siphon", 2), ("r3-maliciouscode", 2),
                ("n1-mammal", 2), ("rx-videogame", 2), ("r2-hobbyist", 2),
                ("r3-hatemachine", 2)),
        },
        new()
        {
            Key = "hollowvigil",
            Name = "Rain God",
            Blurb = "Oil Spirits that grind out the game while wounds add up damage across the enemy board.",
            LeaderId = "o3-raingod",
            Cards = Build(
                ("o2-slime", 2), ("n1-mammal", 2), ("n3-Seam", 2), ("o2-boneknown", 2),
                ("o3-fungal", 2), ("n3-AcolyteofGrinkle", 2), ("o3-thelake", 2),
                ("ox-mysterycabin", 2), ("n1-weirdBird", 2), ("n3-GrinkleBeast", 2),
                ("o3-bighatsalze", 2), ("n3-Relica", 2), ("ox-graft", 2), ("ox-campfire", 2),
                ("ox-lazyeye", 2), ("o1-skeleton", 2), ("o2-stabber", 2), ("o2-thecount", 2),
                ("o3-wickerman", 2), ("n2-SecretLetter", 2), ("n2-UngratefulBeast", 2),
                ("o1-jacklebox", 2), ("o2-evilflower", 2), ("o2-witch", 2)),
        },
        new()
        {
            Key = "deepcurrent",
            Name = "The Fish",
            Blurb = "Weak Fish that flood the board early, and an endgame about winning the war of attrition.",
            LeaderId = "fh-thefish",
            Cards = Build(
                ("n3-IneptRuler", 2), ("fx-catch", 2), ("fx-fishgoop", 2),
                ("fx-puddlewarp", 2), ("n1-Wallguy", 2), ("f2-fishamalgam", 2),
                ("n3-GrinkleBeast", 2), ("f3-serpant", 2), ("fx-rainstorm", 2),
                ("fx-snacklebox", 2), ("f1-whaleshark", 2), ("f1-seasnake", 2),
                ("f1-swordfish", 2), ("fx-fishideology", 2), ("f1-longfish", 2),
                ("nx-ColdBread", 2), ("fx-scooba", 2), ("n3-Seam", 2), ("f1-urchin", 2),
                ("f3-infiniteship", 2), ("fx-error", 2), ("fx-riptide", 2),
                ("f2-jellyking", 2), ("n2-LesserGrinkle", 2)),
        },
    };

    public static readonly StarterDeck[] TestDecks =
    {
        new()
        {
            Key = "tidewatch",
            Name = "Tidewatch Machine",
            Blurb = "Fish and Robot. A dual leader is what makes the dual cards legal.",
            Test = true,
            LeaderId = "m-bg-machineblue",
            Cards = Build(
                ("f1-basicfish", 2), ("f1-lilfish", 2), ("f1-longfish", 2), ("f1-octopi", 2),
                ("f1-seabunny", 2), ("f1-seahorse", 2), ("f1-seasnake", 2), ("f1-urchin", 2),
                ("f2-coralhead", 2), ("f2-fishwizard", 2), ("fx-catch", 2), ("fx-chumbucket", 1),
                ("fx-fishgoop", 2), ("m-bg-fishcode", 2), ("m-bg-greenorblue", 2), ("m-bg-hedronheart", 2),
                ("m-bg-robotfish", 2), ("r1-lapgrob", 2), ("r1-mouse", 2), ("r2-badglitch", 2),
                ("r2-bellobot", 2), ("r2-engineer", 2), ("rx-battery", 2), ("rx-plugzap", 2),
                ("rx-siphon", 2)),
        },
        new()
        {
            Key = "vanilla",
            Name = "Vanilla Dummies",
            Blurb = "No abilities anywhere. The baseline for combat maths.",
            LeaderId = "x-hero-dummy-warden",
            Test = true,
            Cards = Build(
                ("x-f-bolt", 2), ("x-f-dummy-1", 2), ("x-f-dummy-2", 2), ("x-f-dummy-3", 2),
                ("x-o-bolt", 2), ("x-o-dummy-1", 2), ("x-o-dummy-2", 2), ("x-o-dummy-3", 2),
                ("x-p-bolt", 2), ("x-p-dummy-1", 2), ("x-p-dummy-2", 2), ("x-p-dummy-3", 2),
                ("x-r-bolt", 2), ("x-r-dummy-1", 2), ("x-r-dummy-2", 2), ("x-r-dummy-3", 2),
                ("x-s-bolt", 2), ("x-s-dummy-1", 2), ("x-s-dummy-2", 2), ("x-s-dummy-3", 2)),
        },
        new()
        {
            Key = "trap-lab",
            Name = "Trap Lab",
            Blurb = "Every trap in the game, so response windows open constantly.",
            LeaderId = "x-hero-dummy-warden",
            Test = true,
            Cards = Build(
                ("fx-scooba", 2), ("m-rb-sordidmark", 2), ("ox-lazyeye", 2), ("px-banner", 2),
                ("rx-stundevice", 2), ("sx-hollowring", 2), ("x-f-bolt", 2), ("x-f-dummy-1", 2),
                ("x-f-dummy-2", 2), ("x-f-dummy-3", 2), ("x-o-bolt", 2), ("x-o-dummy-1", 2),
                ("x-o-dummy-2", 2), ("x-o-dummy-3", 2), ("x-p-bolt", 2), ("x-p-dummy-1", 2),
                ("x-p-dummy-2", 2), ("x-p-dummy-3", 2), ("x-r-dummy-1", 2), ("x-r-dummy-2", 2),
                ("x-r-dummy-3", 2), ("x-s-dummy-1", 2), ("x-s-dummy-2", 2), ("x-s-dummy-3", 2)),
        },
        new()
        {
            Key = "flip-lab",
            Name = "Flip Lab",
            Blurb = "Nothing but flip effects, so every point of damage triggers something.",
            LeaderId = "x-hero-dummy-warden",
            Test = true,
            Cards = Build(
                ("f1-basicfish", 2), ("f1-lilfish", 2), ("f1-longfish", 2), ("f1-octopi", 2),
                ("f1-seabunny", 2), ("f1-seahorse", 2), ("f1-urchin", 2), ("o1-butterfly", 2),
                ("o1-ghost", 2), ("o1-ghostbeast", 2), ("o1-jacklebox", 2), ("o1-spider", 2),
                ("p1-beetle", 2), ("p1-bunny", 2), ("r1-chipcrunch", 2), ("r1-lapgrob", 2),
                ("r1-lightbolbe", 2), ("s1-fluterat", 2), ("s1-livingflowers", 2), ("s1-shrubbunny", 2),
                ("x-f-dummy-1", 2), ("x-o-dummy-1", 2), ("x-p-dummy-1", 2), ("x-r-dummy-1", 2)),
        },
        new()
        {
            Key = "aura-lab",
            Name = "Aura Lab",
            Blurb = "Stages and lords in two colors, to watch continuous effects stack up.",
            LeaderId = "x-hero-dummy-warden",
            Test = true,
            Cards = Build(
                ("f2-coralhead", 2), ("fx-fishideology", 2), ("fx-rainstorm", 2), ("m-yb-themoon", 2),
                ("m-yg-pragmistlaw", 2), ("s1-livingtree", 2), ("s2-sunwalker", 2), ("s3-oldgod", 2),
                ("s3-yellowplanet", 2), ("sx-musicalflow", 2), ("sx-party", 2), ("x-f-bolt", 2),
                ("x-f-dummy-1", 2), ("x-f-dummy-2", 2), ("x-f-dummy-3", 2), ("x-o-dummy-1", 2),
                ("x-o-dummy-2", 2), ("x-p-dummy-1", 2), ("x-p-dummy-2", 2), ("x-r-dummy-1", 2),
                ("x-s-bolt", 2), ("x-s-dummy-1", 2), ("x-s-dummy-2", 2), ("x-s-dummy-3", 2)),
        },
    };

    /// <summary>
    /// Decks the tournament built rather than a person. Every body that can
    /// stand as a leader was handed to an agent, and the population rebuilt its
    /// decks over nine hundred rounds; the best deck for each colour and
    /// colour pair is kept. Regenerate with scripts/export-evolved.mjs.
    /// </summary>
    public static readonly StarterDeck[] Evolved =
    {
        new()
        {
            Key = "evo-f-infiniteship",
            Name = "The Infinite Ship",
            Blurb = "Fish. Evolved: 25 level 3 bodies and 8 spells, leaning on Error and Fish Goop.",
            LeaderId = "f3-infiniteship",
            Cards = Build(
                ("f1-swordfish", 2), ("f1-whaleshark", 2), ("f2-fishamalgam", 2), ("f2-fishfolk", 2),
                ("f2-jellyking", 1), ("f2-scubadoba", 2), ("f3-abyssalwalker", 2), ("f3-crabcity", 2),
                ("f3-darkness", 1), ("f3-deepseaheart", 2), ("f3-eternalalbatross", 2), ("f3-infiniteship", 1),
                ("f3-serpant", 2), ("fh-thefish", 2), ("fx-error", 2), ("fx-fishgoop", 2),
                ("fx-puddlewarp", 2), ("fx-snacklebox", 2), ("n2-HonorableKnight", 1), ("n2-LowWizard", 2),
                ("n2-UngratefulBeast", 1), ("n3-AcolyteofGrinkle", 2), ("n3-GambleLord", 1), ("n3-GrinkleBeast", 2),
                ("n3-IneptRuler", 2), ("n3-NerveLite", 2), ("n3-Seam", 2)),
        },
        new()
        {
            Key = "evo-o-eyesnight",
            Name = "Eyes of Night",
            Blurb = "Oil. Evolved: 19 level 3 bodies and 4 spells, leaning on Black Candle and Field: Campfire.",
            LeaderId = "o3-eyesnight",
            Cards = Build(
                ("n1-Thing", 1), ("n2-LowWizard", 2), ("n3-AcolyteofGrinkle", 2), ("n3-IneptRuler", 2),
                ("n3-Ivy", 1), ("n3-NerveLite", 2), ("n3-Seam", 2), ("nx-HomeOnAHill", 1),
                ("nx-Mousetrap", 1), ("o1-ghostbeast", 1), ("o1-jacklebox", 1), ("o1-skeleton", 1),
                ("o2-boneknown", 2), ("o2-evilflower", 1), ("o2-necromancer", 1), ("o2-slime", 2),
                ("o2-stabber", 2), ("o2-thecount", 2), ("o2-witch", 2), ("o3-devourer", 2),
                ("o3-fungal", 2), ("o3-mothhorror", 2), ("o3-raingod", 2), ("o3-wickerman", 2),
                ("ox-blackcandle", 2), ("ox-campfire", 2), ("ox-corruptedritual", 1), ("ox-lazyeye", 1),
                ("ox-mysterycabin", 2), ("ox-wishingclaw", 1)),
        },
        new()
        {
            Key = "evo-p-slicer",
            Name = "Slicer",
            Blurb = "Pepper. Evolved: 18 level 3 bodies and 6 spells, leaning on Ember Flower and Ember Tonic.",
            LeaderId = "p3-Slicer",
            Cards = Build(
                ("n1-CorruptGrinkling", 2), ("n1-LittleBunny", 1), ("n1-Thing", 1), ("n1-mammal", 1),
                ("n2-HonorableKnight", 2), ("n2-LesserGrinkle", 1), ("n2-NobodysFriend", 1), ("n2-Smithee", 2),
                ("n3-AcolyteofGrinkle", 2), ("n3-IneptRuler", 2), ("n3-Ivy", 1), ("n3-PowerBird", 2),
                ("p1-bunny", 2), ("p1-devil", 2), ("p2-ash demon", 2), ("p2-deathknight", 2),
                ("p2-dragon", 2), ("p2-lazylord", 1), ("p2-wizard", 1), ("p3-Looker", 2),
                ("p3-Pod", 2), ("p3-heavenknows", 2), ("p3-helaks", 1), ("p3-stareater", 2),
                ("ph-archlife", 2), ("px-castle", 1), ("px-flower", 2), ("px-planetblast", 1),
                ("px-poisondagger", 1), ("px-potion", 2)),
        },
        new()
        {
            Key = "evo-r-strangestation",
            Name = "Strange Station",
            Blurb = "Robot. Evolved: 16 level 3 bodies and 8 spells, leaning on Trap: Mousetrap and Rock Throw.",
            LeaderId = "r3-strangestation",
            Cards = Build(
                ("n1-BeautifulBug", 2), ("n1-CorruptGrinkling", 1), ("n1-mammal", 1), ("n2-Sorter", 1),
                ("n3-AcolyteofGrinkle", 1), ("n3-FlyingCastle", 1), ("n3-GrinkleBeast", 2), ("n3-IneptRuler", 2),
                ("n3-Ivy", 1), ("n3-NerveLite", 2), ("n3-Seam", 2), ("nx-Mousetrap", 2),
                ("nx-RockThrow", 2), ("r1-automoton", 1), ("r1-chipcrunch", 2), ("r1-computerbug", 1),
                ("r1-lapgrob", 1), ("r1-mouse", 2), ("r1-slicebot", 2), ("r2-badglitch", 1),
                ("r2-securitybot", 2), ("r3-hatemachine", 2), ("r3-infinitemind", 1), ("r3-maliciouscode", 2),
                ("rx-connect", 1), ("rx-grab", 2), ("rx-npcgenerator", 2), ("rx-plugzap", 2),
                ("rx-stundevice", 2), ("rx-thedodecahedron", 2)),
        },
        new()
        {
            Key = "evo-s-aetusvox",
            Name = "Aetus Vox",
            Blurb = "Solar. Evolved: 19 level 3 bodies and 7 spells, leaning on Flower Power and Trap: Hollow Ring.",
            LeaderId = "s3-aetusvox",
            Cards = Build(
                ("n1-CorruptGrinkling", 1), ("n2-Deedsigner", 1), ("n2-LowWizard", 1), ("n3-AcolyteofGrinkle", 1),
                ("n3-GrinkleBeast", 2), ("n3-IneptRuler", 2), ("n3-Seam", 2), ("nx-ColdBread", 1),
                ("nx-HomeOnAHill", 1), ("nx-RockThrow", 1), ("s1-starbird", 2), ("s1-starsprite", 2),
                ("s2-admirer", 2), ("s2-druid", 2), ("s2-happybard", 2), ("s2-livingruin", 2),
                ("s2-orangefarmer", 2), ("s2-ragick", 2), ("s3-aetusvox", 2), ("s3-brokensun", 2),
                ("s3-goldwild", 2), ("s3-maestro", 2), ("s3-smallgod", 2), ("s3-yellowplanet", 2),
                ("sx-aetalglob", 1), ("sx-flowerpower", 2), ("sx-hollowring", 2), ("sx-inkybook", 1),
                ("sx-plusfifty", 1)),
        },
        new()
        {
            Key = "evo-of-enigmastelf",
            Name = "Enigmastelf",
            Blurb = "Oil and Fish. Evolved: 28 level 3 bodies and 9 spells, leaning on Baited and Fish Goop.",
            LeaderId = "m-bp-enigmastelf",
            Cards = Build(
                ("f2-jellyking", 2), ("f3-abyssalwalker", 2), ("f3-darkness", 2), ("f3-riverdrinker", 2),
                ("f3-serpant", 2), ("fx-catch", 2), ("fx-fishgoop", 2), ("m-bp-orb", 2),
                ("m-bp-voidbug", 2), ("n1-Wallguy", 1), ("n2-Deedsigner", 1), ("n3-AcolyteofGrinkle", 2),
                ("n3-GambleLord", 1), ("n3-GrinkleBeast", 2), ("n3-IneptRuler", 2), ("n3-NerveLite", 2),
                ("n3-Seam", 2), ("nx-Mousetrap", 1), ("o2-boneknown", 2), ("o2-parkranger", 1),
                ("o2-witch", 1), ("o3-fungal", 2), ("o3-mothhorror", 2), ("o3-raingod", 2),
                ("o3-wickerman", 1), ("ox-blackcandle", 2), ("ox-mysterycabin", 2), ("ox-wishingclaw", 1)),
        },
        new()
        {
            Key = "evo-pf-sordidbeast",
            Name = "Sordid Beast",
            Blurb = "Pepper and Fish. Evolved: 21 level 3 bodies and 9 spells, leaning on Baited and Fish Goop.",
            LeaderId = "m-rb-sordidbeast",
            Cards = Build(
                ("f1-whaleshark", 1), ("f2-jellyking", 1), ("f3-abyssalwalker", 2), ("f3-darkness", 2),
                ("f3-eternalalbatross", 2), ("f3-serpant", 2), ("f3-sharkmeat", 1), ("fx-catch", 2),
                ("fx-fishgoop", 2), ("fx-fishify", 1), ("fx-snacklebox", 2), ("m-rb-xyliss", 1),
                ("n2-LowWizard", 2), ("n2-NobodysFriend", 2), ("n2-SecretLetter", 1), ("n2-Smithee", 2),
                ("n2-UngratefulBeast", 1), ("n3-AcolyteofGrinkle", 1), ("n3-IneptRuler", 2), ("n3-NerveLite", 1),
                ("p1-bunny", 1), ("p1-devil", 1), ("p2-evil squire", 2), ("p2-lazylord", 2),
                ("p3-Pod", 2), ("p3-Slicer", 1), ("p3-Tryybus", 1), ("p3-helaks", 1),
                ("p3-stareater", 2), ("px-banner", 1), ("px-castle", 1), ("px-flower", 2)),
        },
        new()
        {
            Key = "evo-rf-machineblue",
            Name = "Machine Blue",
            Blurb = "Robot and Fish. Evolved: 24 level 3 bodies and 10 spells, leaning on Fish Goop and Trap: Mousetrap.",
            LeaderId = "m-bg-machineblue",
            Cards = Build(
                ("f1-whaleshark", 2), ("f2-jellyking", 2), ("f3-abyssalwalker", 2), ("f3-darkness", 2),
                ("f3-serpant", 2), ("fx-fishgoop", 2), ("fx-scooba", 1), ("m-bg-machineblue", 2),
                ("n1-CorruptGrinkling", 1), ("n1-Wallguy", 1), ("n2-LowWizard", 1), ("n3-AcolyteofGrinkle", 2),
                ("n3-GrinkleBeast", 1), ("n3-IneptRuler", 2), ("n3-Seam", 2), ("nx-Mousetrap", 2),
                ("nx-RockThrow", 2), ("r2-badglitch", 1), ("r2-digital nomad", 2), ("r2-nommer", 1),
                ("r3-chemicalmen", 2), ("r3-hatemachine", 2), ("r3-infinitemind", 2), ("r3-maliciouscode", 1),
                ("r3-strangestation", 2), ("rx-battery", 2), ("rx-npcgenerator", 2), ("rx-plugzap", 2)),
        },
        new()
        {
            Key = "evo-fs-themoon",
            Name = "The Moon",
            Blurb = "Fish and Solar. Evolved: 27 level 3 bodies and 7 spells, leaning on Baited and Celebrate.",
            LeaderId = "m-yb-themoon",
            Cards = Build(
                ("f1-seasnake", 1), ("f1-whaleshark", 2), ("f2-fishamalgam", 1), ("f3-darkness", 2),
                ("f3-eternalalbatross", 2), ("f3-serpant", 2), ("fx-catch", 2), ("fx-error", 1),
                ("fx-puddlewarp", 1), ("m-yb-ambrosia", 2), ("m-yb-livingriver", 1), ("m-yb-themoon", 2),
                ("n2-Starfly", 1), ("n3-AcolyteofGrinkle", 2), ("n3-IneptRuler", 2), ("n3-NerveLite", 1),
                ("nx-RockThrow", 1), ("s1-starbird", 1), ("s2-druid", 1), ("s2-hiker", 2),
                ("s2-sunwalker", 2), ("s3-aetusvox", 2), ("s3-brokensun", 2), ("s3-maestro", 2),
                ("s3-smallgod", 2), ("s3-solusdetteri", 2), ("s3-yellowplanet", 2), ("sx-celebrate", 2),
                ("sx-hollowring", 2)),
        },
        new()
        {
            Key = "evo-po-theking",
            Name = "The King",
            Blurb = "Pepper and Oil. Evolved: 25 level 3 bodies and 3 spells, leaning on Bucket and Black Candle.",
            LeaderId = "m-rp-theking",
            Cards = Build(
                ("m-rp-falsehumanity", 2), ("m-rp-theking", 2), ("n2-LowWizard", 1), ("n2-Smithee", 2),
                ("n3-AcolyteofGrinkle", 2), ("n3-GrinkleBeast", 2), ("n3-IneptRuler", 2), ("n3-Ivy", 1),
                ("nx-Bucket", 1), ("o1-butterfly", 1), ("o1-jacklebox", 2), ("o2-boneknown", 2),
                ("o2-slime", 2), ("o3-fungal", 2), ("o3-mothhorror", 2), ("o3-raingod", 2),
                ("o3-wickerman", 2), ("ox-blackcandle", 1), ("ox-wishingclaw", 1), ("p1-beast", 1),
                ("p1-bunny", 2), ("p1-devil", 2), ("p2-ash demon", 2), ("p2-deathknight", 1),
                ("p3-Looker", 1), ("p3-classe", 2), ("p3-heavenknows", 2), ("p3-helemy", 1),
                ("p3-stareater", 1), ("ph-archlife", 1)),
        },
        new()
        {
            Key = "evo-or-cybergore",
            Name = "Cybergore",
            Blurb = "Oil and Robot. Evolved: 24 level 3 bodies and 9 spells, leaning on Rock Throw and Black Candle.",
            LeaderId = "m-pg-Cybergore",
            Cards = Build(
                ("m-pg-AncientVirus", 1), ("m-pg-Cybergore", 2), ("n1-LittleBunny", 2), ("n1-Wallguy", 1),
                ("n2-Starfly", 1), ("n3-AcolyteofGrinkle", 1), ("n3-IneptRuler", 2), ("n3-Relica", 2),
                ("nx-HomeOnAHill", 1), ("nx-RockThrow", 2), ("o1-jacklebox", 2), ("o1-owl", 2),
                ("o3-darksideofthemoon", 2), ("o3-fungal", 2), ("o3-mothhorror", 2), ("o3-raingod", 1),
                ("ox-blackcandle", 2), ("r1-chipcrunch", 2), ("r2-securitybot", 1), ("r3-chemicalmen", 2),
                ("r3-greenstar", 2), ("r3-hatemachine", 2), ("r3-infinitemind", 2), ("r3-strangestation", 2),
                ("rx-battery", 1), ("rx-grab", 2), ("rx-plugzap", 2), ("rx-thedodecahedron", 2)),
        },
        new()
        {
            Key = "evo-os-xalbriss",
            Name = "M-Xalbriss",
            Blurb = "Oil and Solar. Evolved: 27 level 3 bodies and 4 spells, leaning on Trap: Mousetrap and Aetal Glob.",
            LeaderId = "m-yp-m-xalbriss",
            Cards = Build(
                ("m-yp-m-xalbriss", 2), ("m-yp-parthultfanatic", 1), ("n2-Starfly", 1), ("n3-AcolyteofGrinkle", 1),
                ("n3-GrinkleBeast", 1), ("n3-IneptRuler", 2), ("n3-Relica", 1), ("n3-Seam", 2),
                ("nx-Mousetrap", 2), ("o2-boneknown", 2), ("o2-slime", 2), ("o2-stabber", 1),
                ("o3-darksideofthemoon", 2), ("o3-fungal", 2), ("o3-raingod", 2), ("o3-thelake", 2),
                ("ox-campfire", 1), ("s2-admirer", 2), ("s2-happybard", 1), ("s2-livingruin", 1),
                ("s2-orangefarmer", 2), ("s2-sunwalker", 2), ("s3-aetusvox", 2), ("s3-maestro", 2),
                ("s3-smallgod", 2), ("s3-solusdetteri", 2), ("s3-yellowplanet", 2), ("sx-aetalglob", 2),
                ("sx-flowerpower", 1)),
        },
        new()
        {
            Key = "evo-pr-obelisks",
            Name = "The Obelisks",
            Blurb = "Pepper and Robot. Evolved: 15 level 3 bodies and 12 spells, leaning on Recompiler and Ember Flower.",
            LeaderId = "m-rg-obelisks",
            Cards = Build(
                ("m-rg-recompiler", 2), ("n1-Wallguy", 1), ("n2-LesserGrinkle", 1), ("n2-UngratefulBeast", 1),
                ("n3-AcolyteofGrinkle", 2), ("n3-GrinkleBeast", 1), ("n3-IneptRuler", 1), ("n3-Ivy", 2),
                ("n3-NerveLite", 1), ("n3-PowerBird", 1), ("p2-ash demon", 2), ("p2-deathknight", 2),
                ("p2-lazylord", 2), ("p3-Pod", 2), ("p3-stareater", 1), ("px-flower", 2),
                ("r1-defender", 2), ("r2-digital nomad", 2), ("r2-nommer", 2), ("r2-securitybot", 1),
                ("r3-greenstar", 2), ("r3-strangestation", 2), ("rx-battery", 2), ("rx-connect", 2),
                ("rx-npcgenerator", 2), ("rx-plugzap", 2), ("rx-siphon", 2), ("rx-thedodecahedron", 1),
                ("rx-videogame", 2)),
        },
        new()
        {
            Key = "evo-ps-sasparsol",
            Name = "Saspar-Sol",
            Blurb = "Pepper and Solar. Evolved: 19 level 3 bodies and 5 spells, leaning on Ember Flower and Ember Tonic.",
            LeaderId = "m-yr-sasparsol",
            Cards = Build(
                ("m-yr-scarletbloom", 2), ("n1-BucketGuardian", 1), ("n1-weirdBird", 1), ("n2-LesserGrinkle", 1),
                ("n2-Smithee", 2), ("n2-UngratefulBeast", 1), ("n3-IneptRuler", 2), ("n3-NerveLite", 1),
                ("nx-HomeOnAHill", 1), ("p1-bunny", 2), ("p1-devil", 1), ("p2-ash demon", 2),
                ("p2-dragon", 2), ("p3-Looker", 2), ("p3-Tryybus", 2), ("p3-heavenknows", 2),
                ("p3-helaks", 2), ("px-banner", 1), ("px-flower", 2), ("px-potion", 2),
                ("px-treasure", 1), ("s1-fluterat", 2), ("s1-starbird", 1), ("s2-happybard", 1),
                ("s2-livingruin", 1), ("s2-ragick", 2), ("s3-brokensun", 2), ("s3-maestro", 2),
                ("s3-smallgod", 2), ("s3-solusdetteri", 2)),
        },
        new()
        {
            Key = "evo-rs-pilgrim",
            Name = "Pilgrim",
            Blurb = "Robot and Solar. Evolved: 23 level 3 bodies and 6 spells, leaning on Field: Home on a Hill and Grab.",
            LeaderId = "m-yg-pilgrim",
            Cards = Build(
                ("n1-weirdBird", 1), ("n2-Smithee", 2), ("n2-UngratefulBeast", 1), ("n3-GrinkleBeast", 2),
                ("n3-IneptRuler", 2), ("n3-Ivy", 1), ("n3-NerveLite", 2), ("n3-Seam", 1),
                ("nx-HomeOnAHill", 2), ("r3-hatemachine", 2), ("r3-infinitemind", 2), ("r3-strangestation", 2),
                ("rx-grab", 2), ("rx-plugzap", 2), ("rx-stundevice", 2), ("rx-videogame", 2),
                ("s1-livingrock", 1), ("s2-admirer", 2), ("s2-hiker", 2), ("s2-livingruin", 1),
                ("s2-ragick", 1), ("s2-sunwalker", 2), ("s3-aetusvox", 2), ("s3-brokensun", 1),
                ("s3-maestro", 2), ("s3-smallgod", 2), ("s3-solusdetteri", 2), ("sx-hollowring", 2)),
        },
    };

    /// <summary>The curated decks, which is what the sweeps and the corpus use.</summary>
    public static StarterDeck[] All => Starters.Concat(TestDecks).ToArray();

    /// <summary>Everything selectable, evolved decks included.</summary>
    public static StarterDeck[] Everything => All.Concat(Evolved).ToArray();

    public static StarterDeck ByKey(string key) =>
        Everything.FirstOrDefault(d => d.Key == key)
        ?? throw new KeyNotFoundException($"unknown deck: {key}");
}
