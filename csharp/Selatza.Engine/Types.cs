namespace Selatza;

/// <summary>
/// The six that pay mana, plus Neutral and Ernum. N sits at
/// <see cref="Rules.Colorless"/>, so a neutral card lands in the colourless pool
/// whichever path reaches it, and E at <see cref="Rules.Ernum"/>. K (Candy) sits
/// before both so every colour's ordinal is its mana index.
/// </summary>
public enum Color { P, O, R, F, S, K, N, E }

public enum CardType { Summon, Spell, Trap, Stage }

public enum Faction { Fish, Machine, Spirit, Beast, Living, Mortal, Scholar, Star, Hedron, Grinkle, Saccharine, Ernum }

public enum Rarity { C, R, E, L, P }

public enum Phase { Awake, Draw, Main, End }

public enum TargetKind { Summon, Leader, Hand, Supporter, Debt, Discard, ColorPick }

public static class Colors
{
    public static readonly Color[] All = { Color.P, Color.O, Color.R, Color.F, Color.S, Color.K };

    public static string Name(Color c) => c switch
    {
        Color.P => "Pepper",
        Color.O => "Oil",
        Color.R => "Robot",
        Color.F => "Fish",
        Color.S => "Solar",
        Color.K => "Candy",
        Color.E => "Ernum",
        _ => "Neutral",
    };

    /// <summary>Folder name in the art pack, which is also the plain-language colour.</summary>
    public static string Art(Color c) => c switch
    {
        Color.P => "Red",
        Color.O => "Purple",
        Color.R => "Green",
        Color.F => "Blue",
        Color.K => "Pink",
        _ => "Yellow",
    };

    public static string Letter(Color c) => c.ToString();
}

public static class Rarities
{
    /// <summary>
    /// Copies of any one card a deck may run. Rarity used to cap this, from four
    /// down to a singleton legend. It no longer does: levels 1 to 3 carry the
    /// trade-off instead, and rarity is a printed measure of how much rules text
    /// a card makes a player read. At two, a 48-card deck is at least 24
    /// different cards.
    /// </summary>
    public const int CopyLimit = 2;

    /// <summary>Kept as a method because the limit was once a function of rarity.</summary>
    public static int Limit(Rarity r) => CopyLimit;

    /// <summary>Characters of rules text at which a card moves up a rarity.</summary>
    public const int RareAt = 40;
    public const int EpicAt = 70;
    public const int LegendaryAt = 100;

    /// <summary>
    /// Characters a summon's level is worth on top of its rules text. A level 1
    /// body is the smallest commitment in the set and a level 3 the largest, so
    /// the two ends pull apart: most level 1s should be Common and most level
    /// 3s should not. Index 0 is unused.
    /// </summary>
    public static readonly int[] LevelAdjust = { 0, -15, -8, 15 };

    /// <summary>
    /// Every card's printed tier, set once from the character-count rule and
    /// frozen here. A card only changes tier when someone changes it in this
    /// table; ForCard derives a tier only for ids the table has never seen.
    /// </summary>
    public static readonly Dictionary<string, Rarity> Fixed = new()
    {
        // Prismatic is this card's alone: nothing else carries every colour.
        ["m-ernum"] = Rarity.P,
        ["f1-basicfish"] = Rarity.C,
        ["f1-lilfish"] = Rarity.R,
        ["f1-longfish"] = Rarity.R,
        ["f1-octopi"] = Rarity.C,
        ["f1-seabunny"] = Rarity.C,
        ["f1-seahorse"] = Rarity.E,
        ["f1-seasnake"] = Rarity.R,
        ["f1-swordfish"] = Rarity.C,
        ["f1-urchin"] = Rarity.E,
        ["f1-whaleshark"] = Rarity.R,
        ["f2-coralhead"] = Rarity.C,
        ["f2-fishamalgam"] = Rarity.R,
        ["f2-fishfolk"] = Rarity.C,
        ["f2-fishwizard"] = Rarity.C,
        ["f2-jellyking"] = Rarity.L,
        ["f2-lighthousekeeper"] = Rarity.R,
        ["f2-riverfolk"] = Rarity.L,
        ["f2-scubadoba"] = Rarity.C,
        ["f2-submariner"] = Rarity.R,
        ["f2-undersearesearcher"] = Rarity.C,
        ["f3-abyssalwalker"] = Rarity.C,
        ["f3-crabcity"] = Rarity.L,
        ["f3-darkness"] = Rarity.L,
        ["f3-deepseaheart"] = Rarity.R,
        ["f3-eternalalbatross"] = Rarity.C,
        ["f3-infiniteship"] = Rarity.R,
        ["f3-riverdrinker"] = Rarity.C,
        ["f3-serpant"] = Rarity.E,
        ["f3-sharkmeat"] = Rarity.C,
        ["fh-thefish"] = Rarity.L,
        ["fx-catch"] = Rarity.E,
        ["fx-chumbucket"] = Rarity.E,
        ["fx-error"] = Rarity.E,
        ["fx-fishgoop"] = Rarity.E,
        ["fx-fishideology"] = Rarity.R,
        ["fx-fishify"] = Rarity.C,
        ["fx-puddlewarp"] = Rarity.R,
        ["fx-rainstorm"] = Rarity.E,
        ["fx-riptide"] = Rarity.L,
        ["fx-scooba"] = Rarity.C,
        ["fx-snacklebox"] = Rarity.R,
        ["hidden"] = Rarity.C,
        ["m-bg-fishcode"] = Rarity.R,
        ["m-bg-greenorblue"] = Rarity.R,
        ["m-bg-hedronheart"] = Rarity.L,
        ["m-bg-machineblue"] = Rarity.E,
        ["m-bg-robotfish"] = Rarity.E,
        ["m-bgp-overknower"] = Rarity.L,
        ["m-bgr-screener"] = Rarity.L,
        ["m-bgy-seeraltine"] = Rarity.L,
        ["m-bp-enigmastelf"] = Rarity.L,
        ["m-bp-hatefuljely"] = Rarity.E,
        ["m-bp-orb"] = Rarity.E,
        ["m-bp-visitor"] = Rarity.R,
        ["m-bp-voidbug"] = Rarity.E,
        ["m-bpy-bananamage"] = Rarity.L,
        ["m-brp-decayinggrinklegod"] = Rarity.L,
        ["m-bry-drownedwanderer"] = Rarity.L,
        ["m-gpy-obscureslime"] = Rarity.L,
        ["m-grp-horriblemalware"] = Rarity.L,
        ["m-gry-spiritofsolstice"] = Rarity.L,
        ["m-mb-CandyCraver"] = Rarity.R,
        ["m-mb-CandyFish"] = Rarity.R,
        ["m-mb-IcecubeCandy"] = Rarity.R,
        ["m-mb-TropicalBlueDrink"] = Rarity.R,
        ["m-mb-loanshark"] = Rarity.E,
        ["m-mbp-vier"] = Rarity.L,
        ["m-mbr-saraza"] = Rarity.L,
        ["m-mby-wellworthit"] = Rarity.L,
        ["m-mg-AbsurdlySourCandy"] = Rarity.R,
        ["m-mg-CandyVirus"] = Rarity.R,
        ["m-mg-CuriousPilgrim"] = Rarity.R,
        ["m-mg-HedronFragments"] = Rarity.R,
        ["m-mg-NewGrad"] = Rarity.E,
        ["m-mgb-codeinfestedsweetling"] = Rarity.L,
        ["m-mgp-godofmisfortune"] = Rarity.L,
        ["m-mgr-ransomwareartist"] = Rarity.L,
        ["m-mgy-thethorn"] = Rarity.L,
        ["m-mp-LenAphelion"] = Rarity.E,
        ["m-mp-MarkOfTheFalseKing"] = Rarity.R,
        ["m-mp-PairOfCritters"] = Rarity.E,
        ["m-mp-RottenCandy"] = Rarity.R,
        ["m-mp-SoldBones"] = Rarity.R,
        ["m-mpr-humanitysdefender"] = Rarity.L,
        ["m-mpy-sopapli"] = Rarity.L,
        ["m-mr-AbsurdlySpicyCandy"] = Rarity.E,
        ["m-mr-CandyAxeman"] = Rarity.R,
        ["m-mr-DeflateCurrency"] = Rarity.R,
        ["m-mr-RedSweets"] = Rarity.L,
        ["m-mr-RedTape"] = Rarity.R,
        ["m-my-CandySun"] = Rarity.R,
        ["m-my-LittleGummyBear"] = Rarity.R,
        ["m-my-MoltenCandyBolt"] = Rarity.R,
        ["m-my-PinkLemonader"] = Rarity.L,
        ["m-my-SourSoda"] = Rarity.R,
        ["m-myr-hellmage"] = Rarity.L,
        ["m-pg-AncientVirus"] = Rarity.R,
        ["m-pg-Cybergore"] = Rarity.E,
        ["m-pg-Doortonowhere"] = Rarity.R,
        ["m-pg-Slimewitch"] = Rarity.L,
        ["m-pg-vilebrew"] = Rarity.R,
        ["m-rb-savetheuniverse"] = Rarity.R,
        ["m-rb-sordidbeast"] = Rarity.L,
        ["m-rb-sordidfruit"] = Rarity.R,
        ["m-rb-sordidmark"] = Rarity.R,
        ["m-rb-xyliss"] = Rarity.E,
        ["m-rg-obelisks"] = Rarity.E,
        ["m-rg-professorpistachio"] = Rarity.L,
        ["m-rg-recomp"] = Rarity.R,
        ["m-rg-recompiler"] = Rarity.L,
        ["m-rg-virus"] = Rarity.E,
        ["m-rg-xyuzdrone"] = Rarity.E,
        ["m-rp-alchemy"] = Rarity.R,
        ["m-rp-annihilate"] = Rarity.R,
        ["m-rp-falsehumanity"] = Rarity.R,
        ["m-rp-greedandfear"] = Rarity.R,
        ["m-rp-theking"] = Rarity.E,
        ["m-ryp-livingcurse"] = Rarity.L,
        ["m-yb-ambrosia"] = Rarity.E,
        ["m-yb-fishsong"] = Rarity.R,
        ["m-yb-livingriver"] = Rarity.E,
        ["m-yb-skypaint"] = Rarity.R,
        ["m-yb-themoon"] = Rarity.E,
        ["m-yg-hedronicgateway"] = Rarity.L,
        ["m-yg-hedronshard"] = Rarity.R,
        ["m-yg-krazbot"] = Rarity.R,
        ["m-yg-pilgrim"] = Rarity.L,
        ["m-yg-pragmistlaw"] = Rarity.R,
        ["m-yp-crotalbell"] = Rarity.E,
        ["m-yp-gardener"] = Rarity.E,
        ["m-yp-m-xalbriss"] = Rarity.R,
        ["m-yp-molly"] = Rarity.R,
        ["m-yp-parthultfanatic"] = Rarity.R,
        ["m-yr-burnsong"] = Rarity.E,
        ["m-yr-livingspell"] = Rarity.L,
        ["m-yr-sasparsol"] = Rarity.L,
        ["m-yr-sasparsparadise"] = Rarity.R,
        ["m-yr-scarletbloom"] = Rarity.R,
        ["n-banana"] = Rarity.C,
        ["n1-BeautifulBug"] = Rarity.C,
        ["n1-BucketGuardian"] = Rarity.C,
        ["n1-CorruptGrinkling"] = Rarity.C,
        ["n1-FishBones"] = Rarity.R,
        ["n1-LittleBunny"] = Rarity.C,
        ["n1-Thing"] = Rarity.E,
        ["n1-Wallguy"] = Rarity.C,
        ["n1-lizard"] = Rarity.C,
        ["n1-mammal"] = Rarity.C,
        ["n1-weirdBird"] = Rarity.C,
        ["n2-Deedsigner"] = Rarity.C,
        ["n2-HonorableKnight"] = Rarity.C,
        ["n2-LesserGrinkle"] = Rarity.C,
        ["n2-LowWizard"] = Rarity.C,
        ["n2-NobodysFriend"] = Rarity.E,
        ["n2-SecretLetter"] = Rarity.C,
        ["n2-Smithee"] = Rarity.C,
        ["n2-Sorter"] = Rarity.C,
        ["n2-Starfly"] = Rarity.C,
        ["n2-UngratefulBeast"] = Rarity.C,
        ["n3-AcolyteofGrinkle"] = Rarity.C,
        ["n3-FlyingCastle"] = Rarity.C,
        ["n3-GambleLord"] = Rarity.R,
        ["n3-GrinkleBeast"] = Rarity.R,
        ["n3-IneptRuler"] = Rarity.L,
        ["n3-Ivy"] = Rarity.E,
        ["n3-NerveLite"] = Rarity.E,
        ["n3-PowerBird"] = Rarity.R,
        ["n3-Relica"] = Rarity.C,
        ["n3-Seam"] = Rarity.C,
        ["nx-Bucket"] = Rarity.C,
        ["nx-ColdBread"] = Rarity.C,
        ["nx-HomeOnAHill"] = Rarity.R,
        ["nx-Mousetrap"] = Rarity.R,
        ["nx-RockThrow"] = Rarity.C,
        ["o-curse-dread"] = Rarity.R,
        ["o-curse-rot"] = Rarity.R,
        ["o-curse-ruin"] = Rarity.C,
        ["o-curse-spite"] = Rarity.R,
        ["o1-Kapigras"] = Rarity.L,
        ["o1-butterfly"] = Rarity.C,
        ["o1-ghost"] = Rarity.C,
        ["o1-ghostbeast"] = Rarity.C,
        ["o1-jacklebox"] = Rarity.R,
        ["o1-mothman"] = Rarity.C,
        ["o1-owl"] = Rarity.C,
        ["o1-pumpkineater"] = Rarity.R,
        ["o1-skeleton"] = Rarity.E,
        ["o1-snakecoil"] = Rarity.C,
        ["o1-spider"] = Rarity.C,
        ["o2-boneknown"] = Rarity.L,
        ["o2-evilflower"] = Rarity.C,
        ["o2-mooncat"] = Rarity.R,
        ["o2-necromancer"] = Rarity.C,
        ["o2-parkranger"] = Rarity.C,
        ["o2-scientist"] = Rarity.R,
        ["o2-slime"] = Rarity.L,
        ["o2-stabber"] = Rarity.C,
        ["o2-thecount"] = Rarity.C,
        ["o2-witch"] = Rarity.C,
        ["o3-bighatsalze"] = Rarity.R,
        ["o3-darksideofthemoon"] = Rarity.R,
        ["o3-devourer"] = Rarity.R,
        ["o3-eyesnight"] = Rarity.C,
        ["o3-fungal"] = Rarity.L,
        ["o3-mothhorror"] = Rarity.E,
        ["o3-raingod"] = Rarity.L,
        ["o3-thelake"] = Rarity.R,
        ["o3-wickerman"] = Rarity.E,
        ["oh-spectralking"] = Rarity.L,
        ["ox-blackcandle"] = Rarity.E,
        ["ox-bomb"] = Rarity.R,
        ["ox-bonedivination"] = Rarity.E,
        ["ox-campfire"] = Rarity.R,
        ["ox-corruptedritual"] = Rarity.E,
        ["ox-ghostshadow"] = Rarity.R,
        ["ox-graft"] = Rarity.E,
        ["ox-lazyeye"] = Rarity.C,
        ["ox-mysterycabin"] = Rarity.R,
        ["ox-wishingclaw"] = Rarity.E,
        ["p1-beast"] = Rarity.C,
        ["p1-beetle"] = Rarity.C,
        ["p1-bugbert"] = Rarity.C,
        ["p1-bunny"] = Rarity.R,
        ["p1-devil"] = Rarity.C,
        ["p1-firebat"] = Rarity.C,
        ["p1-firesprite"] = Rarity.C,
        ["p1-minimage"] = Rarity.C,
        ["p1-moonkrag"] = Rarity.R,
        ["p1-thinker"] = Rarity.C,
        ["p2-ash demon"] = Rarity.L,
        ["p2-burnflayer"] = Rarity.R,
        ["p2-deathknight"] = Rarity.L,
        ["p2-dragon"] = Rarity.E,
        ["p2-evil squire"] = Rarity.C,
        ["p2-lazylord"] = Rarity.R,
        ["p2-livingfort"] = Rarity.R,
        ["p2-pinelyte"] = Rarity.L,
        ["p2-warmateer"] = Rarity.C,
        ["p2-wizard"] = Rarity.R,
        ["p3-Looker"] = Rarity.E,
        ["p3-Pod"] = Rarity.L,
        ["p3-Slicer"] = Rarity.R,
        ["p3-Tryybus"] = Rarity.C,
        ["p3-classe"] = Rarity.R,
        ["p3-heavenknows"] = Rarity.C,
        ["p3-helaks"] = Rarity.L,
        ["p3-helemy"] = Rarity.R,
        ["p3-stareater"] = Rarity.E,
        ["ph-archlife"] = Rarity.L,
        ["px-banner"] = Rarity.C,
        ["px-castle"] = Rarity.R,
        ["px-firebolt"] = Rarity.R,
        ["px-flower"] = Rarity.E,
        ["px-planetblast"] = Rarity.E,
        ["px-poisondagger"] = Rarity.R,
        ["px-potion"] = Rarity.E,
        ["px-towerofmystery"] = Rarity.C,
        ["px-treasure"] = Rarity.E,
        ["px-vaporize"] = Rarity.E,
        ["r1-automoton"] = Rarity.C,
        ["r1-chipcrunch"] = Rarity.C,
        ["r1-cogbeast"] = Rarity.R,
        ["r1-computerbug"] = Rarity.R,
        ["r1-defender"] = Rarity.C,
        ["r1-lapgrob"] = Rarity.C,
        ["r1-lightbolbe"] = Rarity.C,
        ["r1-mouse"] = Rarity.R,
        ["r1-pointer"] = Rarity.C,
        ["r1-slicebot"] = Rarity.E,
        ["r2-badglitch"] = Rarity.R,
        ["r2-bellobot"] = Rarity.C,
        ["r2-blackhat"] = Rarity.C,
        ["r2-digital nomad"] = Rarity.E,
        ["r2-digitalrabbits"] = Rarity.C,
        ["r2-engineer"] = Rarity.R,
        ["r2-forklift"] = Rarity.C,
        ["r2-hobbyist"] = Rarity.C,
        ["r2-nommer"] = Rarity.R,
        ["r2-securitybot"] = Rarity.R,
        ["r3-chemicalmen"] = Rarity.L,
        ["r3-cybersiren"] = Rarity.L,
        ["r3-greenstar"] = Rarity.C,
        ["r3-hatemachine"] = Rarity.L,
        ["r3-infinitemind"] = Rarity.L,
        ["r3-maliciouscode"] = Rarity.R,
        ["r3-scoobertsingularity"] = Rarity.C,
        ["r3-shapethink"] = Rarity.C,
        ["r3-strangestation"] = Rarity.L,
        ["rh-player1"] = Rarity.L,
        ["rx-battery"] = Rarity.E,
        ["rx-connect"] = Rarity.R,
        ["rx-download"] = Rarity.R,
        ["rx-grab"] = Rarity.E,
        ["rx-npcgenerator"] = Rarity.E,
        ["rx-plugzap"] = Rarity.E,
        ["rx-siphon"] = Rarity.R,
        ["rx-stundevice"] = Rarity.R,
        ["rx-thedodecahedron"] = Rarity.E,
        ["rx-videogame"] = Rarity.E,
        ["s1-fluterat"] = Rarity.C,
        ["s1-livingboot"] = Rarity.R,
        ["s1-livingflowers"] = Rarity.C,
        ["s1-livingraincloud"] = Rarity.C,
        ["s1-livingrock"] = Rarity.C,
        ["s1-livingsong"] = Rarity.C,
        ["s1-livingtree"] = Rarity.R,
        ["s1-shrubbunny"] = Rarity.C,
        ["s1-starbird"] = Rarity.E,
        ["s1-starsprite"] = Rarity.C,
        ["s2-admirer"] = Rarity.R,
        ["s2-bubblemancer"] = Rarity.R,
        ["s2-bugleist"] = Rarity.R,
        ["s2-druid"] = Rarity.R,
        ["s2-happybard"] = Rarity.C,
        ["s2-hiker"] = Rarity.C,
        ["s2-livingruin"] = Rarity.L,
        ["s2-orangefarmer"] = Rarity.R,
        ["s2-ragick"] = Rarity.L,
        ["s2-sunwalker"] = Rarity.E,
        ["s3-aetusvox"] = Rarity.L,
        ["s3-brokensun"] = Rarity.R,
        ["s3-divergentlight"] = Rarity.C,
        ["s3-goldwild"] = Rarity.C,
        ["s3-maestro"] = Rarity.E,
        ["s3-oldgod"] = Rarity.L,
        ["s3-smallgod"] = Rarity.E,
        ["s3-solusdetteri"] = Rarity.R,
        ["s3-yellowplanet"] = Rarity.C,
        ["sh-thejudge"] = Rarity.L,
        ["sx-aetalglob"] = Rarity.E,
        ["sx-aetuscollection"] = Rarity.R,
        ["sx-celebrate"] = Rarity.L,
        ["sx-flowerpower"] = Rarity.E,
        ["sx-hollowring"] = Rarity.E,
        ["sx-inkybook"] = Rarity.R,
        ["sx-lemonaid"] = Rarity.R,
        ["sx-musicalflow"] = Rarity.C,
        ["sx-party"] = Rarity.C,
        ["sx-plusfifty"] = Rarity.E,
        ["x-f-bolt"] = Rarity.C,
        ["x-f-dummy-1"] = Rarity.C,
        ["x-f-dummy-2"] = Rarity.C,
        ["x-f-dummy-3"] = Rarity.C,
        ["x-hero-dummy-warden"] = Rarity.L,
        ["x-n-immune"] = Rarity.C,
        ["x-n-redirect"] = Rarity.C,
        ["x-n-redirect-leader"] = Rarity.L,
        ["x-o-bolt"] = Rarity.C,
        ["x-o-dummy-1"] = Rarity.C,
        ["x-o-dummy-2"] = Rarity.C,
        ["x-o-dummy-3"] = Rarity.C,
        ["x-p-bolt"] = Rarity.C,
        ["x-p-dummy-1"] = Rarity.C,
        ["x-p-dummy-2"] = Rarity.C,
        ["x-p-dummy-3"] = Rarity.C,
        ["x-r-bolt"] = Rarity.C,
        ["x-r-dummy-1"] = Rarity.C,
        ["x-r-dummy-2"] = Rarity.C,
        ["x-r-dummy-3"] = Rarity.C,
        ["x-s-bolt"] = Rarity.C,
        ["x-s-dummy-1"] = Rarity.C,
        ["x-s-dummy-2"] = Rarity.C,
        ["x-s-dummy-3"] = Rarity.C,
        // Candy. Tiers from the character-count rule at the list's first printing.
        ["k1-SugarBug"] = Rarity.E,
        ["k1-apprentice"] = Rarity.R,
        ["k1-candymouse"] = Rarity.R,
        ["k1-gingerbreadgirl"] = Rarity.C,
        ["k1-icecreambird"] = Rarity.E,
        ["k1-livingbubbles"] = Rarity.C,
        ["k1-livingcandy"] = Rarity.C,
        ["k1-lovecat"] = Rarity.C,
        ["k1-patheticbonbon"] = Rarity.R,
        ["k1-sleepybeast"] = Rarity.E,
        ["k2-Briber"] = Rarity.C,
        ["k2-CandyGuardSeller"] = Rarity.C,
        ["k2-CandyWizard"] = Rarity.R,
        ["k2-GunForHire"] = Rarity.R,
        ["k2-HotcakeSeller"] = Rarity.R,
        ["k2-Nurse"] = Rarity.E,
        ["k2-PrivateDetective"] = Rarity.R,
        ["k2-Recycler"] = Rarity.E,
        ["k2-SnoozingGiant"] = Rarity.R,
        ["k2-spellsell"] = Rarity.C,
        ["k3-AncientSugar"] = Rarity.C,
        ["k3-DebtReliever"] = Rarity.R,
        ["k3-DerangedCandyfolk"] = Rarity.L,
        ["k3-Eidola"] = Rarity.C,
        ["k3-Final Unicorn"] = Rarity.E,
        ["k3-HyperCapitalist"] = Rarity.E,
        ["k3-InfiniteLove"] = Rarity.R,
        ["k3-LastLollipop"] = Rarity.L,
        ["k3-SweetHarmony"] = Rarity.L,
        ["kh-PinkDeus"] = Rarity.L,
        ["kx-Candycane"] = Rarity.C,
        ["kx-DarkCandy"] = Rarity.L,
        ["kx-FieldClearanceSale"] = Rarity.R,
        ["kx-GiftOfGiving"] = Rarity.E,
        ["kx-LineGoesUp"] = Rarity.C,
        ["kx-Loan"] = Rarity.L,
        ["kx-LoveForAPrice"] = Rarity.C,
        ["kx-cuffed"] = Rarity.R,
        ["kx-trapExpensiveSecurity"] = Rarity.C,
        ["kx-trapSugarCrash"] = Rarity.C,
        ["k-candyguard"] = Rarity.C,
    };

    /// <summary>
    /// Everything a player has to read to play the card: its passive line, the
    /// text of each Power and its flip line, joined by single spaces. Name,
    /// factions, cost and the stat line are not rules text.
    /// </summary>
    public static int TextLength(string? text, Power[]? powers, string? flipText)
    {
        var parts = new List<string>();
        if (!string.IsNullOrEmpty(text)) parts.Add(text);
        foreach (var p in powers ?? Array.Empty<Power>()) parts.Add(p.Text);
        if (!string.IsNullOrEmpty(flipText)) parts.Add(flipText);
        return string.Join(" ", parts).Length;
    }

    /// <summary>
    /// Prices a card that has no tier yet. Rules text is the baseline and the
    /// adjustments below move it off that. The answer is written into Fixed once
    /// and read from there afterwards, so editing a card's text never reprints it
    /// at a new tier. Mirrors rarityForCard in src/engine/types.ts.
    /// </summary>
    public static Rarity ForCard(CardDef def)
    {
        if (Fixed.TryGetValue(def.Id, out var fixedTier)) return fixedTier;
        if (def.Starter) return Rarity.L;
        int printed = TextLength(def.Text, def.Powers, def.FlipText);
        int n = printed;
        if (def.Type == CardType.Summon && def.Level >= 1 && def.Level <= 3)
            n += LevelAdjust[def.Level];
        // A dual card asks a deck for two colours, so nothing about it is common
        // and nothing may push it below what its own text already earned.
        if (def.Color2 is not null) n = Math.Max(n, Math.Max(printed, RareAt));
        // A triple card can only be run by a leader that brings all three
        // colours, so a deck is built around it rather than including it. At
        // level 3 that is the largest commitment the set can ask for, and it
        // prints Legendary whatever its text.
        if (def.Color3 is not null) return def.Level == 3 ? Rarity.L : Rarity.E;
        if (n >= LegendaryAt) return printed >= LegendaryAt ? Rarity.L : Rarity.E;
        if (n >= EpicAt) return Rarity.E;
        if (n >= RareAt) return Rarity.R;
        return Rarity.C;
    }
}

/// <summary>A mana cost. Small counters rather than a dictionary, so it copies cheaply.</summary>
public readonly record struct Cost(int P = 0, int O = 0, int R = 0, int F = 0, int S = 0, int C = 0, int K = 0)
{
    public int this[Color c] => c switch
    {
        Color.P => P,
        Color.O => O,
        Color.R => R,
        Color.F => F,
        Color.K => K,
        _ => S,
    };

    /// <summary>Coloured pips only. Colourless is deliberately not a colour.</summary>
    public int Colored => P + O + R + F + S + K;

    public int Total => Colored + C;

    public bool IsFree => Total == 0;

    public override string ToString()
    {
        var sb = new System.Text.StringBuilder();
        foreach (var c in Colors.All) sb.Append(Colors.Letter(c)[0], this[c]);
        sb.Append('C', C);
        return sb.ToString();
    }
}

/// <summary>
/// Where a targeted thing lives. A flat struct rather than a union, so it is
/// cheap to compare and trivial to serialise into a replay.
/// </summary>
public readonly record struct TargetRef(TargetKind Kind, int Player, int Index = 0)
{
    public static TargetRef Summon(int player, int slot) => new(TargetKind.Summon, player, slot);
    public static TargetRef Leader(int player) => new(TargetKind.Leader, player);
    public static TargetRef Hand(int player, int index) => new(TargetKind.Hand, player, index);
    public static TargetRef Supporter(int player, int index) => new(TargetKind.Supporter, player, index);
    public static TargetRef Debt(int player, int index) => new(TargetKind.Debt, player, index);
    public static TargetRef Discard(int player, int index) => new(TargetKind.Discard, player, index);

    public bool IsBody => Kind == TargetKind.Summon || Kind == TargetKind.Leader;

    public override string ToString() => $"{Kind}:{Player}:{Index}";
}

public sealed class TargetFilterArgs
{
    public required GameState State { get; init; }
    public required int Me { get; init; }
    public required TargetRef Ref { get; init; }
    public CardDef? Card { get; init; }
    public SummonInstance? Summon { get; init; }
}

public enum Side { Ally, Enemy, Any }

public sealed class TargetSpec
{
    public required TargetKind Kind { get; init; }
    public required string Label { get; init; }
    public Side Side { get; init; } = Side.Any;
    public bool IncludeLeader { get; init; }
    public bool Optional { get; init; }
    public Func<TargetFilterArgs, bool>? Filter { get; init; }
}

public sealed class Power
{
    public required string Name { get; init; }
    public Cost Cost { get; init; }
    public string Text { get; init; } = "";
    public TargetSpec[]? Targets { get; init; }
    public bool OncePerTurn { get; init; }

    /// <summary>Sapping this summon is part of the cost, shown as a symbol on the cost line.</summary>
    public bool SapSelf { get; init; }

    /// <summary>
    /// Candy: a power whose whole text is a Love line spends the pool to do
    /// anything, so with 0 Love it is refused rather than wasting the sap.
    /// </summary>
    public bool NeedsLove { get; init; }

    /// <summary>
    /// HP this summon spends off itself as part of the cost. It has to survive
    /// paying, so a body down to this many cards is refused rather than sapped
    /// for an effect that cannot happen.
    /// </summary>
    public int HpCost { get; init; }

    public required Action<EffectCtx> Effect { get; init; }
}

/// <summary>
/// Candy's shop, printed as a "Store:" line in the card's text. Its controller
/// may run it once per turn for 2 debt (plus the surcharge), never on the turn
/// the card entered play. In the TypeScript engine other players buy it through
/// a price negotiation; this engine carries the self-use half, which is the
/// floor the balance harness measures.
/// </summary>
public sealed class StoreDef
{
    /// <summary>Added to the self-use price and to every offered price.</summary>
    public int Surcharge { get; init; }
    /// <summary>At most one: the target is collected as a deferred choice.</summary>
    public TargetSpec[]? Targets { get; init; }
    /// <summary>Whether the store could do anything for this user right now.</summary>
    public Func<GameState, int, bool>? Useful { get; init; }
    public required Action<EffectCtx> Effect { get; init; }
}

/// <summary>What a card is told when it is asked what Effect Damage it contributes.</summary>
public sealed class EffectDamageArgs
{
    public required GameState State { get; init; }
    /// <summary>Player who controls the card being asked.</summary>
    public required int Controller { get; init; }
}

public sealed class StrengthBonusArgs
{
    public required GameState State { get; init; }
    public required int Controller { get; init; }
    public required SummonInstance Summon { get; init; }
    public required CardDef Def { get; init; }
    /// <summary>
    /// The body radiating the bonus, null when a field is. A card that only buffs
    /// itself compares uids against this rather than matching its own printed id,
    /// which a copy put into play as something else no longer carries.
    /// </summary>
    public SummonInstance? Source { get; init; }
}

/// <summary>
/// Continuous and triggered abilities on a summon in play. None of them ask the
/// player anything, so resolution never has to pause.
/// </summary>
public sealed class Triggers
{
    public Action<EffectCtx>? OnEnter { get; init; }
    public Action<EffectCtx>? OnDeath { get; init; }
    public Action<EffectCtx>? OnAttack { get; init; }
    public Action<EffectCtx>? OnDefend { get; init; }
    public Action<EffectCtx>? OnAwake { get; init; }

    /// <summary>During its controller's end step, after turn-length buffs expire.</summary>
    public Action<EffectCtx>? OnEndTurn { get; init; }

    /// <summary>When any other summon in play dies, on either side.</summary>
    public Action<EffectCtx>? OnOtherDeath { get; init; }

    /// <summary>When this summon's controller casts a spell, after it resolves.</summary>
    public Action<EffectCtx>? OnSpellCast { get; init; }

    /// <summary>When the other player casts a spell, after it resolves.</summary>
    public Action<EffectCtx>? OnEnemySpellCast { get; init; }

    /// <summary>
    /// When the other player activates a Power, after it resolves. The body
    /// that used it is Targets[0] when it is still on the board.
    /// </summary>
    public Action<EffectCtx>? OnEnemyPower { get; init; }

    /// <summary>
    /// Candy: when another player buys from one of this card's controller's
    /// Stores. Fires on the seller's side once per accepted purchase.
    /// </summary>
    public Action<EffectCtx>? OnStoreSold { get; init; }

    /// <summary>
    /// Candy: when this card's controller buys from another player's Store.
    /// Fires on the buyer's side once per accepted purchase; self-use is not a
    /// purchase and does not fire it.
    /// </summary>
    public Action<EffectCtx>? OnStoreBought { get; init; }

    /// <summary>
    /// When this card's controller takes debt, after the amount lands and only
    /// while the game is still going. Fires once per gain, whatever its size.
    /// </summary>
    public Action<EffectCtx>? OnDebtTaken { get; init; }

    /// <summary>When any summon is played from a hand. The body that landed is Targets[0].</summary>
    public Action<EffectCtx>? OnSummonPlayed { get; init; }

    /// <summary>Frenzy: the first time this body takes damage and lives.</summary>
    public Action<EffectCtx>? OnSurvive { get; init; }

    public Func<StrengthBonusArgs, int>? StrengthBonus { get; init; }

    /// <summary>
    /// Effect Damage this card contributes on top of its printed EffectDamage,
    /// for the cards whose bonus depends on the board rather than being flat.
    /// </summary>
    public Func<EffectDamageArgs, int>? EffectDamageBonus { get; init; }
}

/// <summary>
/// What a flip effect asks for before it fires. A flip with a cost is optional:
/// its owner is asked, and may decline. A flip without one resolves for free the
/// moment the card turns over, so only effects worth paying for interrupt.
/// </summary>
public sealed class FlipCost
{
    public Cost Mana { get; init; }
    /// <summary>Cards off the top of your own deck, into your debt zone.</summary>
    public int Mill { get; init; }
    /// <summary>Cards out of your hand, chosen when you pay.</summary>
    public int Discard { get; init; }
}

public sealed class StageHooks
{
    public Action<EffectCtx>? OnAwake { get; init; }
    public Func<StrengthBonusArgs, int>? StrengthBonus { get; init; }
    /// <summary>Fires for the stage's own controller; Target(0) is the summon that landed.</summary>
    public Action<EffectCtx>? OnSummonPlayed { get; init; }
    /// <summary>Candy: when another player buys from the controller's Store. TS-only.</summary>
    public Action<EffectCtx>? OnStoreSold { get; init; }
}

public sealed class CardDef
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required Color Color { get; init; }
    /// <summary>Second colour on a dual card.</summary>
    public Color? Color2 { get; init; }
    /// <summary>Third colour. Only the triple-colour legends carry one.</summary>
    public Color? Color3 { get; init; }
    public CardType Type { get; init; } = CardType.Summon;

    /// <summary>
    /// A card handed to a player who has not built a deck yet. It is a curation
    /// hint and nothing else: leading a deck is a seat any summon with HP may
    /// take and is chosen per deck, not a property a card carries.
    /// </summary>
    public bool Starter { get; init; }
    public string? Text { get; init; }
    public Cost Cost { get; init; }
    public int Strength { get; init; }
    /// <summary>Leaders enter play with double this value.</summary>
    public int Hp { get; init; }
    /// <summary>1-3. A dying summon adds this much to its owner's debt.</summary>
    public int Level { get; init; } = 1;
    public Faction[] Factions { get; init; } = Array.Empty<Faction>();
    /// <summary>Colour identity when it is wider than the frame colours.</summary>
    public Color[]? Identity { get; init; }

    /// <summary>
    /// Neutral cards belong to no colour, so every leader's identity contains them
    /// and any deck may run them. Faced as a supporter they pay colourless, which
    /// covers a colourless pip and nothing else.
    /// </summary>
    public bool Neutral { get; init; }

    /// <summary>
    /// Redirection. While this body is in play, the other side may only attack it
    /// and may only aim spells and traps at it. A leader with Redirection is
    /// attackable even with its slots full, because it is the only legal target.
    /// </summary>
    public bool Redirect { get; init; }

    /// <summary>
    /// Reborn. The first time this body would die it returns to its slot with
    /// 1 HP instead, once per body. It reaches no zone and charges no debt on
    /// that first death, so nothing that answers a Deathrattle answers this.
    /// </summary>
    public bool Reborn { get; init; }

    /// <summary>
    /// Frenzy. The first time this body takes damage and lives, its OnSurvive
    /// trigger fires, once per body. A body that dies to the hit never frenzies.
    /// </summary>
    public bool Frenzy { get; init; }

    /// <summary>
    /// Spell Immunity. No spell or trap may choose this body as a target, from
    /// either side of the table. Combat and triggers still reach it.
    /// </summary>
    public bool SpellImmune { get; init; }
    /// <summary>
    /// Effect Damage. While this card is in play, every point of damage its
    /// controller deals from a spell, power or flip is increased by this much.
    /// Combat is untouched: this is Pepper's keyword, not a strength buff.
    /// </summary>
    public int EffectDamage { get; init; }
    /// <summary>
    /// While this card is in play, wounds on enemy summons convert to damage
    /// one for one instead of two for one. Oil's payoff keyword.
    /// </summary>
    public bool WoundAmplify { get; init; }
    /// <summary>
    /// While this body is in play, every debt gain to every player is 1 bigger,
    /// once per copy, the controller's own bills included. Loanshark's aura.
    /// </summary>
    public bool DebtAmplify { get; init; }

    /// <summary>
    /// Supporter Lock. While this card is in play the other player may not face
    /// a supporter at all. It forbids rather than reduces, so it beats any
    /// allowance they have been given.
    /// </summary>
    public bool SupporterLock { get; init; }
    /// <summary>
    /// While this card is in play and its controller holds no slot summons,
    /// their spells and traps cost nothing. A summon standing in a slot is a
    /// summon its controller holds, so a body with this only turns it on from
    /// the leader seat.
    /// </summary>
    public bool FreeSpells { get; init; }
    /// <summary>
    /// Spell Trap. This trap's response window is the enemy casting a spell,
    /// not an attack. Springing it counters the spell before it resolves.
    /// </summary>
    public bool SpellTrap { get; init; }
    /// <summary>
    /// Spell Trap only. Springing this one does not counter: its effect runs
    /// first, then the spell resolves as though nothing had answered it.
    /// </summary>
    public bool LetSpellResolve { get; init; }
    /// <summary>While this card is in play, your spells resolve their effect twice.</summary>
    public bool SpellEcho { get; init; }
    /// <summary>
    /// While this card is in play, Rot and Dread in the enemy's deck have
    /// double effect.
    /// </summary>
    public bool CursePotency { get; init; }
    /// <summary>
    /// HP cards this summon's combat damage flips lose their FLIP effects, and
    /// it turns 1 of its own flipped HP cards back down for each one muted.
    /// </summary>
    public bool MuffleFlips { get; init; }

    /// <summary>
    /// While this is on your side, your HP cards and spells are annihilated
    /// instead of reaching your discard pile, so nothing recurs and there is
    /// nothing left to reshuffle when the deck runs out.
    /// </summary>
    public bool VoidsDiscard { get; init; }
    /// <summary>This spell removes itself from the game after it resolves; a countered copy still discards.</summary>
    public bool AnnihilateAfterCast { get; init; }
    /// <summary>
    /// Stationary. This body never declares an attack. It still deals its
    /// strength back when attacked.
    /// </summary>
    public bool Stationary { get; init; }
    /// <summary>Derived, never assigned. See Rarities.ForCard.</summary>
    public Rarity Rarity => Rarities.ForCard(this);

    /// <summary>
    /// A card the game creates rather than a deck: curses, fusion products. It
    /// has art and renders like any card, but no deck may run it.
    /// </summary>
    public bool Uncollectible { get; init; }

    public string? Art { get; init; }
    public string Artist { get; init; } = "klabss";
    public string? Num { get; init; }
    public Power[]? Powers { get; init; }
    public Triggers? Triggers { get; init; }
    public TargetSpec[]? Targets { get; init; }
    public Action<EffectCtx>? Effect { get; init; }
    public Action<FlipCtx>? Flip { get; init; }
    /// <summary>
    /// Whether paying for this flip would change anything. A card that answers
    /// no for a position keeps the game from stopping to offer a flip that has
    /// nothing to work on, and keeps its owner from being billed for it.
    /// </summary>
    public Func<FlipCtx, bool>? FlipUseful { get; init; }
    /// <summary>
    /// Whether this trap can answer the window that is open. A trap that prints
    /// no opinion always can; the one that does answers for a window its effect
    /// would find nothing to do in.
    /// </summary>
    public Func<TrapCheckCtx, bool>? TrapUseful { get; init; }
    public string? FlipText { get; init; }
    /// <summary>When set, the flip is optional and its owner must pay this.</summary>
    public FlipCost? FlipCost { get; init; }
    public StageHooks? StageHooks { get; init; }
    /// <summary>Candy: this summon is a shop. The printed line lives in Text.</summary>
    public StoreDef? Store { get; init; }
    /// <summary>
    /// Candy's Clearance Sale. While this is its controller's stage, their
    /// Stores hold 2 stock instead of 1, self-use costs 1 less, and every price
    /// a buyer pays them drops by 1, to a minimum of 1.
    /// </summary>
    public bool StoreBoost { get; init; }

    public bool HasFaction(Faction f) => Array.IndexOf(Factions, f) >= 0;
    public override string ToString() => $"{Id} ({Name})";
}
