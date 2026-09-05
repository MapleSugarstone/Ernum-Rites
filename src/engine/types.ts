/** Card colors. The letter is what appears in mana costs, e.g. "PSS". */
export type Color = 'P' | 'O' | 'R' | 'F' | 'S' | 'K';
/**
 * What a card prints. Neutral is its own colour: it pays with any mana and
 * belongs to no identity, so it is not one of the five and never indexes a
 * mana pool. Ernum is its own colour too, carried by the one card that prints
 * it: what it pays is Ernum mana, which covers a pip of any colour.
 */
export type CardColour = Color | 'N' | 'E';

// K sits last so the five original colours keep their positions everywhere a
// colour indexes something: the digest's mana row, cost strings, frame tables.
export const COLORS: Color[] = ['P', 'O', 'R', 'F', 'S', 'K'];

export const COLOR_NAME: Record<CardColour, string> = {
  P: 'Pepper',
  O: 'Oil',
  R: 'Robot',
  F: 'Fish',
  S: 'Solar',
  K: 'Candy',
  N: 'Neutral',
  E: 'Ernum',
};

/** Folder name in the art pack, which is also the plain-language colour. */
export const COLOR_ART: Record<Color, string> = {
  P: 'Red',
  O: 'Purple',
  R: 'Green',
  F: 'Blue',
  S: 'Yellow',
  K: 'Pink',
};

export type CardType = 'summon' | 'spell' | 'trap' | 'stage';

/**
 * Tribes. Kept few and mostly cosmetic: only a handful of cards read them, and
 * the cross-colour ones (Scholar, Mortal, Star) exist to let two colours share
 * a payoff without sharing a mana cost.
 */
export type Faction =
  | 'Fish'
  | 'Machine'
  | 'Spirit'
  | 'Beast'
  | 'Living'
  | 'Mortal'
  | 'Scholar'
  | 'Star'
  | 'Hedron'
  | 'Grinkle'
  | 'Saccharine'
  | 'Ernum';

export const FACTIONS: Faction[] = [
  'Fish',
  'Machine',
  'Spirit',
  'Beast',
  'Living',
  'Mortal',
  'Scholar',
  'Star',
  'Hedron',
  'Grinkle',
  'Saccharine',
  'Ernum',
];

export type Rarity = 'C' | 'R' | 'E' | 'L' | 'P';

export const RARITY_NAME: Record<Rarity, string> = {
  C: 'Common',
  R: 'Rare',
  E: 'Epic',
  L: 'Legendary',
  P: 'Prismatic',
};

/** Characters of rules text at which a card moves up a rarity. */
export const RARITY_CUTS: Record<'R' | 'E' | 'L', number> = { R: 40, E: 70, L: 100 };

/**
 * Characters a summon's level is worth on top of its rules text. A level 1 body
 * is the smallest commitment in the set and a level 3 the largest, so the two
 * ends pull apart: most level 1s should be Common and most level 3s should not.
 */
export const RARITY_LEVEL_ADJUST: Record<number, number> = { 1: -15, 2: -8, 3: 15 };

/**
 * Every card's printed tier, set once from the character-count rule below and
 * frozen here. Rarity is a property of the card as printed, so editing a card's
 * text later must not silently reprint it at a different tier: a card only moves
 * when someone moves it in this table. `rarityForCard` derives a tier only for
 * ids the table has never seen, which is how a newly written card gets a
 * sensible starting point.
 */
export const RARITY_FIXED: Record<string, Rarity> = {
  // Prismatic is this card's alone: nothing else carries every colour.
  'm-ernum': 'P',
  'f1-basicfish': 'C',
  'f1-lilfish': 'R',
  'f1-longfish': 'R',
  'f1-octopi': 'C',
  'f1-seabunny': 'C',
  'f1-seahorse': 'E',
  'f1-seasnake': 'R',
  'f1-swordfish': 'C',
  'f1-urchin': 'E',
  'f1-whaleshark': 'R',
  'f2-coralhead': 'C',
  'f2-fishamalgam': 'R',
  'f2-fishfolk': 'C',
  'f2-fishwizard': 'C',
  'f2-jellyking': 'L',
  'f2-lighthousekeeper': 'R',
  'f2-riverfolk': 'L',
  'f2-scubadoba': 'C',
  'f2-submariner': 'R',
  'f2-undersearesearcher': 'C',
  'f3-abyssalwalker': 'C',
  'f3-crabcity': 'L',
  'f3-darkness': 'L',
  'f3-deepseaheart': 'R',
  'f3-eternalalbatross': 'C',
  'f3-infiniteship': 'R',
  'f3-riverdrinker': 'C',
  'f3-serpant': 'E',
  'f3-sharkmeat': 'C',
  'fh-thefish': 'L',
  'fx-catch': 'E',
  'fx-chumbucket': 'E',
  'fx-error': 'E',
  'fx-fishgoop': 'E',
  'fx-fishideology': 'R',
  'fx-fishify': 'C',
  'fx-puddlewarp': 'R',
  'fx-rainstorm': 'E',
  'fx-riptide': 'L',
  'fx-scooba': 'C',
  'fx-snacklebox': 'R',
  'hidden': 'C',
  'm-bg-fishcode': 'R',
  'm-bg-greenorblue': 'R',
  'm-bg-hedronheart': 'L',
  'm-bg-machineblue': 'E',
  'm-bg-robotfish': 'E',
  'm-bgp-overknower': 'L',
  'm-bgr-screener': 'L',
  'm-bgy-seeraltine': 'L',
  'm-bp-enigmastelf': 'L',
  'm-bp-hatefuljely': 'E',
  'm-bp-orb': 'E',
  'm-bp-visitor': 'R',
  'm-bp-voidbug': 'E',
  'm-bpy-bananamage': 'L',
  'm-brp-decayinggrinklegod': 'L',
  'm-bry-drownedwanderer': 'L',
  'm-gpy-obscureslime': 'L',
  'm-grp-horriblemalware': 'L',
  'm-gry-spiritofsolstice': 'L',
  'm-mb-CandyCraver': 'R',
  'm-mb-CandyFish': 'R',
  'm-mb-IcecubeCandy': 'R',
  'm-mb-TropicalBlueDrink': 'R',
  'm-mb-loanshark': 'E',
  'm-mbp-vier': 'L',
  'm-mbr-saraza': 'L',
  'm-mby-wellworthit': 'L',
  'm-mg-AbsurdlySourCandy': 'R',
  'm-mg-CandyVirus': 'R',
  'm-mg-CuriousPilgrim': 'R',
  'm-mg-HedronFragments': 'R',
  'm-mg-NewGrad': 'E',
  'm-mgb-codeinfestedsweetling': 'L',
  'm-mgp-godofmisfortune': 'L',
  'm-mgr-ransomwareartist': 'L',
  'm-mgy-thethorn': 'L',
  'm-mp-LenAphelion': 'E',
  'm-mp-MarkOfTheFalseKing': 'R',
  'm-mp-PairOfCritters': 'E',
  'm-mp-RottenCandy': 'R',
  'm-mp-SoldBones': 'R',
  'm-mpr-humanitysdefender': 'L',
  'm-mpy-sopapli': 'L',
  'm-mr-AbsurdlySpicyCandy': 'E',
  'm-mr-CandyAxeman': 'R',
  'm-mr-DeflateCurrency': 'R',
  'm-mr-RedSweets': 'L',
  'm-mr-RedTape': 'R',
  'm-my-CandySun': 'R',
  'm-my-LittleGummyBear': 'R',
  'm-my-MoltenCandyBolt': 'R',
  'm-my-PinkLemonader': 'L',
  'm-my-SourSoda': 'R',
  'm-myr-hellmage': 'L',
  'm-pg-AncientVirus': 'R',
  'm-pg-Cybergore': 'E',
  'm-pg-Doortonowhere': 'R',
  'm-pg-Slimewitch': 'L',
  'm-pg-vilebrew': 'R',
  'm-rb-savetheuniverse': 'R',
  'm-rb-sordidbeast': 'L',
  'm-rb-sordidfruit': 'R',
  'm-rb-sordidmark': 'R',
  'm-rb-xyliss': 'E',
  'm-rg-obelisks': 'E',
  'm-rg-professorpistachio': 'L',
  'm-rg-recomp': 'R',
  'm-rg-recompiler': 'L',
  'm-rg-virus': 'E',
  'm-rg-xyuzdrone': 'E',
  'm-rp-alchemy': 'R',
  'm-rp-annihilate': 'R',
  'm-rp-falsehumanity': 'R',
  'm-rp-greedandfear': 'R',
  'm-rp-theking': 'E',
  'm-ryp-livingcurse': 'L',
  'm-yb-ambrosia': 'E',
  'm-yb-fishsong': 'R',
  'm-yb-livingriver': 'E',
  'm-yb-skypaint': 'R',
  'm-yb-themoon': 'E',
  'm-yg-hedronicgateway': 'L',
  'm-yg-hedronshard': 'R',
  'm-yg-krazbot': 'R',
  'm-yg-pilgrim': 'L',
  'm-yg-pragmistlaw': 'R',
  'm-yp-crotalbell': 'E',
  'm-yp-gardener': 'E',
  'm-yp-m-xalbriss': 'R',
  'm-yp-molly': 'R',
  'm-yp-parthultfanatic': 'R',
  'm-yr-burnsong': 'E',
  'm-yr-livingspell': 'L',
  'm-yr-sasparsol': 'L',
  'm-yr-sasparsparadise': 'R',
  'm-yr-scarletbloom': 'R',
  'n-banana': 'C',
  'n1-BeautifulBug': 'C',
  'n1-BucketGuardian': 'C',
  'n1-CorruptGrinkling': 'C',
  'n1-FishBones': 'R',
  'n1-LittleBunny': 'C',
  'n1-Thing': 'E',
  'n1-Wallguy': 'C',
  'n1-lizard': 'C',
  'n1-mammal': 'C',
  'n1-weirdBird': 'C',
  'n2-Deedsigner': 'C',
  'n2-HonorableKnight': 'C',
  'n2-LesserGrinkle': 'C',
  'n2-LowWizard': 'C',
  'n2-NobodysFriend': 'E',
  'n2-SecretLetter': 'C',
  'n2-Smithee': 'C',
  'n2-Sorter': 'C',
  'n2-Starfly': 'C',
  'n2-UngratefulBeast': 'C',
  'n3-AcolyteofGrinkle': 'C',
  'n3-FlyingCastle': 'C',
  'n3-GambleLord': 'R',
  'n3-GrinkleBeast': 'R',
  'n3-IneptRuler': 'L',
  'n3-Ivy': 'E',
  'n3-NerveLite': 'E',
  'n3-PowerBird': 'R',
  'n3-Relica': 'C',
  'n3-Seam': 'C',
  'nx-Bucket': 'C',
  'nx-ColdBread': 'C',
  'nx-HomeOnAHill': 'R',
  'nx-Mousetrap': 'R',
  'nx-RockThrow': 'C',
  'o-curse-dread': 'R',
  'o-curse-rot': 'R',
  'o-curse-ruin': 'C',
  'o-curse-spite': 'R',
  'o1-Kapigras': 'L',
  'o1-butterfly': 'C',
  'o1-ghost': 'C',
  'o1-ghostbeast': 'C',
  'o1-jacklebox': 'R',
  'o1-mothman': 'C',
  'o1-owl': 'C',
  'o1-pumpkineater': 'R',
  'o1-skeleton': 'E',
  'o1-snakecoil': 'C',
  'o1-spider': 'C',
  'o2-boneknown': 'L',
  'o2-evilflower': 'C',
  'o2-mooncat': 'R',
  'o2-necromancer': 'C',
  'o2-parkranger': 'C',
  'o2-scientist': 'R',
  'o2-slime': 'L',
  'o2-stabber': 'C',
  'o2-thecount': 'C',
  'o2-witch': 'C',
  'o3-bighatsalze': 'R',
  'o3-darksideofthemoon': 'R',
  'o3-devourer': 'R',
  'o3-eyesnight': 'C',
  'o3-fungal': 'L',
  'o3-mothhorror': 'E',
  'o3-raingod': 'L',
  'o3-thelake': 'R',
  'o3-wickerman': 'E',
  'oh-spectralking': 'L',
  'ox-blackcandle': 'E',
  'ox-bomb': 'R',
  'ox-bonedivination': 'E',
  'ox-campfire': 'R',
  'ox-corruptedritual': 'E',
  'ox-ghostshadow': 'R',
  'ox-graft': 'E',
  'ox-lazyeye': 'C',
  'ox-mysterycabin': 'R',
  'ox-wishingclaw': 'E',
  'p1-beast': 'C',
  'p1-beetle': 'C',
  'p1-bugbert': 'C',
  'p1-bunny': 'R',
  'p1-devil': 'C',
  'p1-firebat': 'C',
  'p1-firesprite': 'C',
  'p1-minimage': 'C',
  'p1-moonkrag': 'R',
  'p1-thinker': 'C',
  'p2-ash demon': 'L',
  'p2-burnflayer': 'R',
  'p2-deathknight': 'L',
  'p2-dragon': 'E',
  'p2-evil squire': 'C',
  'p2-lazylord': 'R',
  'p2-livingfort': 'R',
  'p2-pinelyte': 'L',
  'p2-warmateer': 'C',
  'p2-wizard': 'R',
  'p3-Looker': 'E',
  'p3-Pod': 'L',
  'p3-Slicer': 'R',
  'p3-Tryybus': 'C',
  'p3-classe': 'R',
  'p3-heavenknows': 'C',
  'p3-helaks': 'L',
  'p3-helemy': 'R',
  'p3-stareater': 'E',
  'ph-archlife': 'L',
  'px-banner': 'C',
  'px-castle': 'R',
  'px-firebolt': 'R',
  'px-flower': 'E',
  'px-planetblast': 'E',
  'px-poisondagger': 'R',
  'px-potion': 'E',
  'px-towerofmystery': 'C',
  'px-treasure': 'E',
  'px-vaporize': 'E',
  'r1-automoton': 'C',
  'r1-chipcrunch': 'C',
  'r1-cogbeast': 'R',
  'r1-computerbug': 'R',
  'r1-defender': 'C',
  'r1-lapgrob': 'C',
  'r1-lightbolbe': 'C',
  'r1-mouse': 'R',
  'r1-pointer': 'C',
  'r1-slicebot': 'E',
  'r2-badglitch': 'R',
  'r2-bellobot': 'C',
  'r2-blackhat': 'C',
  'r2-digital nomad': 'E',
  'r2-digitalrabbits': 'C',
  'r2-engineer': 'R',
  'r2-forklift': 'C',
  'r2-hobbyist': 'C',
  'r2-nommer': 'R',
  'r2-securitybot': 'R',
  'r3-chemicalmen': 'L',
  'r3-cybersiren': 'L',
  'r3-greenstar': 'C',
  'r3-hatemachine': 'L',
  'r3-infinitemind': 'L',
  'r3-maliciouscode': 'R',
  'r3-scoobertsingularity': 'C',
  'r3-shapethink': 'C',
  'r3-strangestation': 'L',
  'rh-player1': 'L',
  'rx-battery': 'E',
  'rx-connect': 'R',
  'rx-download': 'R',
  'rx-grab': 'E',
  'rx-npcgenerator': 'E',
  'rx-plugzap': 'E',
  'rx-siphon': 'R',
  'rx-stundevice': 'R',
  'rx-thedodecahedron': 'E',
  'rx-videogame': 'E',
  's1-fluterat': 'C',
  's1-livingboot': 'R',
  's1-livingflowers': 'C',
  's1-livingraincloud': 'C',
  's1-livingrock': 'C',
  's1-livingsong': 'C',
  's1-livingtree': 'R',
  's1-shrubbunny': 'C',
  's1-starbird': 'E',
  's1-starsprite': 'C',
  's2-admirer': 'R',
  's2-bubblemancer': 'R',
  's2-bugleist': 'R',
  's2-druid': 'R',
  's2-happybard': 'C',
  's2-hiker': 'C',
  's2-livingruin': 'L',
  's2-orangefarmer': 'R',
  's2-ragick': 'L',
  's2-sunwalker': 'E',
  's3-aetusvox': 'L',
  's3-brokensun': 'R',
  's3-divergentlight': 'C',
  's3-goldwild': 'C',
  's3-maestro': 'E',
  's3-oldgod': 'L',
  's3-smallgod': 'E',
  's3-solusdetteri': 'R',
  's3-yellowplanet': 'C',
  'sh-thejudge': 'L',
  'sx-aetalglob': 'E',
  'sx-aetuscollection': 'R',
  'sx-celebrate': 'L',
  'sx-flowerpower': 'E',
  'sx-hollowring': 'E',
  'sx-inkybook': 'R',
  'sx-lemonaid': 'R',
  'sx-musicalflow': 'C',
  'sx-party': 'C',
  'sx-plusfifty': 'E',
  'x-f-bolt': 'C',
  'x-f-dummy-1': 'C',
  'x-f-dummy-2': 'C',
  'x-f-dummy-3': 'C',
  'x-hero-dummy-warden': 'L',
  'x-n-immune': 'C',
  'x-n-redirect': 'C',
  'x-n-redirect-leader': 'L',
  'x-o-bolt': 'C',
  'x-o-dummy-1': 'C',
  'x-o-dummy-2': 'C',
  'x-o-dummy-3': 'C',
  'x-p-bolt': 'C',
  'x-p-dummy-1': 'C',
  'x-p-dummy-2': 'C',
  'x-p-dummy-3': 'C',
  'x-r-bolt': 'C',
  'x-r-dummy-1': 'C',
  'x-r-dummy-2': 'C',
  'x-r-dummy-3': 'C',
  'x-s-bolt': 'C',
  'x-s-dummy-1': 'C',
  'x-s-dummy-2': 'C',
  'x-s-dummy-3': 'C',
  // Candy. Tiers from the character-count rule at the list's first printing.
  'k1-SugarBug': 'E',
  'k1-apprentice': 'R',
  'k1-candymouse': 'R',
  'k1-gingerbreadgirl': 'C',
  'k1-icecreambird': 'E',
  'k1-livingbubbles': 'C',
  'k1-livingcandy': 'C',
  'k1-lovecat': 'C',
  'k1-patheticbonbon': 'R',
  'k1-sleepybeast': 'E',
  'k2-Briber': 'C',
  'k2-CandyGuardSeller': 'C',
  'k2-CandyWizard': 'R',
  'k2-GunForHire': 'R',
  'k2-HotcakeSeller': 'R',
  'k2-Nurse': 'E',
  'k2-PrivateDetective': 'R',
  'k2-Recycler': 'E',
  'k2-SnoozingGiant': 'R',
  'k2-spellsell': 'C',
  'k3-AncientSugar': 'C',
  'k3-DebtReliever': 'R',
  'k3-DerangedCandyfolk': 'L',
  'k3-Eidola': 'C',
  'k3-Final Unicorn': 'E',
  'k3-HyperCapitalist': 'E',
  'k3-InfiniteLove': 'R',
  'k3-LastLollipop': 'L',
  'k3-SweetHarmony': 'L',
  'kh-PinkDeus': 'L',
  'kx-Candycane': 'C',
  'kx-DarkCandy': 'L',
  'kx-FieldClearanceSale': 'R',
  'kx-GiftOfGiving': 'E',
  'kx-LineGoesUp': 'C',
  'kx-Loan': 'L',
  'kx-LoveForAPrice': 'C',
  'kx-cuffed': 'R',
  'kx-trapExpensiveSecurity': 'C',
  'kx-trapSugarCrash': 'C',
  'k-candyguard': 'C',
};


/**
 * Copies of any one card a deck may run. Rarity used to cap this, from four down
 * to a singleton legend. It no longer does: levels 1 to 3 carry the trade-off
 * instead, and rarity is a printed measure of how much rules text a card makes
 * a player read. At two, a 48-card deck is at least 24 different cards.
 */
export const COPY_LIMIT = 2;

/**
 * What a printed cost can ask for: the six colours, then colourless. Colourless
 * is deliberately not a colour, so it never widens a card's identity.
 */
export type CostKind = Color | 'C';

export const COST_KINDS: CostKind[] = [...COLORS, 'C'];

/**
 * A mana kind: everything a cost can ask for, then Ernum. Ernum is only ever
 * generated, never written into a cost, and one of it pays a pip of any kind.
 * It sits last so the kinds a cost uses keep the indices the digest's mana row
 * is written in.
 */
export type ManaKind = CostKind | 'E';

export const MANA_KINDS: ManaKind[] = [...COST_KINDS, 'E'];

/** A mana cost, e.g. { P: 1, S: 2 } for "PSS", { R: 1, C: 1 } for "RC". */
export type Cost = Partial<Record<CostKind, number>>;

export type PlayerIdx = 0 | 1 | 2 | 3;

export type Phase = 'awake' | 'draw' | 'main' | 'end';

/** Where a targeted thing lives. Resolved by the client before dispatching. */
export type TargetRef =
  | { kind: 'summon'; player: PlayerIdx; slot: number }
  | { kind: 'leader'; player: PlayerIdx }
  | { kind: 'hand'; player: PlayerIdx; index: number }
  | { kind: 'supporter'; player: PlayerIdx; index: number }
  | { kind: 'debt'; player: PlayerIdx; index: number }
  | { kind: 'discard'; player: PlayerIdx; index: number }
  | { kind: 'color'; color: Color };

export interface TargetFilterArgs {
  state: import('./state').GameState;
  /** Controller of the effect asking for targets. */
  me: PlayerIdx;
  ref: TargetRef;
  /** The card at the ref, when there is one. */
  card: CardDef | null;
  summon: import('./state').SummonInstance | null;
}

/** Declared up front so the client can collect targets before dispatching. */
export interface TargetSpec {
  /** 'summon' covers slot summons; set includeLeader to also allow leaders. */
  kind: 'summon' | 'hand' | 'supporter' | 'debt' | 'discard' | 'color';
  label: string;
  /** Relative to the controller. Defaults to 'any'. */
  side?: 'ally' | 'enemy' | 'any';
  includeLeader?: boolean;
  optional?: boolean;
  filter?: (args: TargetFilterArgs) => boolean;
}

export interface Power {
  name: string;
  cost: Cost;
  text: string;
  targets?: TargetSpec[];
  oncePerTurn?: boolean;
  /** Sapping this summon is part of the cost, shown as a symbol on the cost line. */
  sapSelf?: boolean;
  /**
   * Candy: a power whose whole text is a Love line spends the pool to do
   * anything, so with 0 Love it is refused rather than wasting the sap.
   */
  needsLove?: boolean;
  /**
   * HP this summon spends off itself as part of the cost. It has to survive
   * paying, so a body down to this many cards is refused rather than sapped for
   * an effect that cannot happen.
   */
  hpCost?: number;
  effect: EffectFn;
}

/**
 * Candy's shop, printed as a "Store:" line in the card's text. Its controller
 * may run it once per turn for 2 debt (plus the surcharge), never on the turn
 * the card entered play. Other players buy it through a price negotiation on
 * their own turn, and every sale pays the controller 1 Love. The effect always
 * resolves for whoever used it, controller or buyer, with any target asked of
 * them through the choice queue after the price is settled.
 */
export interface StoreDef {
  /** Added to the self-use price and to every offered price. */
  surcharge?: number;
  /**
   * Taken off the surcharge while this card is leading, so a Store can be priced
   * one way in a slot and another from the leader seat. Applied by `storeOf`,
   * which every price already reads its Store through.
   */
  leaderDiscount?: number;
  /** At most one: a bought target is collected as a deferred choice. */
  targets?: TargetSpec[];
  /**
   * Whether the store could do anything for this user right now. A store that
   * answers false cannot be used or bought, the way a useless costed flip is
   * never offered. Absent means always usable.
   */
  useful?: (state: import('./state').GameState, user: PlayerIdx) => boolean;
  effect: EffectFn;
}

/** Runs when this card is flipped as an HP card. Resolves without choices. */
export type FlipEffect = (ctx: FlipCtx) => void;

/**
 * What a flip effect asks for before it fires. A flip with a cost is optional:
 * its owner is asked, and may decline. A flip without one resolves for free the
 * moment the card turns over, so only the effects worth paying for interrupt.
 */
export interface FlipCost {
  mana?: Cost;
  /** Cards off the top of your own deck, into your discard pile. */
  mill?: number;
  /** Cards out of your hand, chosen when you pay. */
  discard?: number;
}

/** What a card is told when it is asked what Effect Damage it is contributing. */
export interface EffectDamageArgs {
  state: import('./state').GameState;
  /** Player who controls the card being asked. */
  controller: PlayerIdx;
}

export interface StrengthBonusArgs {
  state: import('./state').GameState;
  /** Player who controls the source of the bonus. */
  controller: PlayerIdx;
  /** The summon whose strength is being measured. */
  summon: import('./state').SummonInstance;
  def: CardDef;
  /**
   * The body radiating the bonus, absent when a field is. A card that only buffs
   * itself compares uids against this rather than matching its own printed id,
   * which a copy put into play as something else no longer carries.
   */
  source?: import('./state').SummonInstance;
}

/**
 * Continuous and triggered abilities on a summon in play. All of them fire
 * without asking the player anything, so resolution never needs to pause.
 */
export interface Triggers {
  /** After this summon lands and its HP has been dealt. */
  onEnter?: EffectFn;
  /** As it leaves the board, before its debt is counted. */
  onDeath?: EffectFn;
  /** When this summon declares an attack, before the trap window. */
  onAttack?: EffectFn;
  /** When this summon is the target of an attack, before damage. */
  onDefend?: EffectFn;
  /** During its controller's awake step. */
  onAwake?: EffectFn;
  /** During its controller's end step, after turn-length buffs have expired. */
  onEndTurn?: EffectFn;
  /** When any other summon in play dies, on either side. */
  onOtherDeath?: EffectFn;
  /** When this summon's controller casts a spell, after it resolves. */
  onSpellCast?: EffectFn;
  /** When the other player casts a spell, after it resolves. */
  onEnemySpellCast?: EffectFn;
  /**
   * When the other player activates a Power, after it resolves. The body that
   * used it is targets[0] when it is still on the board.
   */
  onEnemyPower?: EffectFn;
  /**
   * Candy: when another player buys from one of this card's controller's
   * Stores. Fires on the seller's side once per accepted purchase.
   */
  onStoreSold?: EffectFn;
  /**
   * Candy: when this card's controller buys from another player's Store.
   * Fires on the buyer's side once per accepted purchase; self-use is not a
   * purchase and does not fire it.
   */
  onStoreBought?: EffectFn;
  /**
   * When this card's controller takes debt, after the amount lands and only
   * while the game is still going. Fires once per gain, whatever its size.
   */
  onDebtTaken?: EffectFn;
  /** When any summon is played from a hand. The body that landed is targets[0]. */
  onSummonPlayed?: EffectFn;
  /** Frenzy: the first time this body takes damage and lives. */
  onSurvive?: EffectFn;
  /** Added to every summon's strength while this is in play. */
  strengthBonus?: (args: StrengthBonusArgs) => number;
  /**
   * Effect Damage this card contributes on top of its printed `effectDamage`,
   * for the cards whose bonus depends on the board rather than being flat.
   */
  effectDamageBonus?: (args: EffectDamageArgs) => number;
}

export interface StageHooks {
  /** Fires during the controller's awake step, before unsapping. */
  onAwake?: (ctx: EffectCtx) => void;
  /** Added to every summon's strength. Return 0 for summons it does not touch. */
  strengthBonus?: (args: StrengthBonusArgs) => number;
  /** Fires for the stage's own controller; targets[0] is the summon that landed. */
  onSummonPlayed?: (ctx: EffectCtx) => void;
  /** Candy: when another player buys from the controller's Store. */
  onStoreSold?: (ctx: EffectCtx) => void;
}

/**
 * How a rebuilt card's art is recoloured. One name per rebuild rather than one
 * per colour, because Malicious Code and Virus do more than lay a colour over
 * the piece.
 */
export type ArtTint = 'oil' | 'robot' | 'malware' | 'virus';

export interface CardDef {
  id: string;
  name: string;
  color: CardColour;
  /** Second colour on a dual card. Costs may use both. */
  color2?: Color;
  /** Third colour. Only the triple-colour legends carry one. */
  color3?: Color;
  type: CardType;
  text?: string;
  /**
   * Where a minted card came from, rather than anything it does. Printed under
   * its own smaller, fainter style so it never reads as a line of rules.
   */
  note?: string;
  /** Mana cost. Summons are free: their cost is the deck cards spent as HP. */
  cost?: Cost;
  /**
   * A card handed to a player who has not built a deck yet. It is a curation
   * hint and nothing else: leading a deck is a seat any summon with HP may take
   * and is chosen per deck, not a property a card carries.
   */
  starter?: boolean;
  /** summon only */
  strength?: number;
  /** Leaders enter play with double this value. */
  hp?: number;
  /** 1-3. A falling summon adds this much to its owner's debt. */
  level?: number;
  factions?: Faction[];
  /**
   * Colour identity, when it is wider than the frame colours. Only the test
   * leader uses this; ordinary cards derive identity from their frame colours.
   */
  identity?: Color[];
  /**
   * Neutral cards belong to no colour, so every leader's identity contains them
   * and any deck may run them. Faced as a supporter they pay colourless, which
   * covers a colourless pip and nothing else.
   */
  neutral?: boolean;
  /**
   * Redirection. While this body is in play, the other side may only attack it
   * and may only aim spells and traps at it. A leader with Redirection is
   * attackable even with its slots full, because it is the only legal target.
   */
  redirect?: boolean;
  /**
   * Spell Immunity. No spell or trap may choose this body as a target, from
   * either side of the table. Combat and triggers still reach it.
   */
  spellImmune?: boolean;
  /**
   * Reborn. The first time this body would die it returns to its slot with 1 HP
   * instead, once per body. It reaches no zone and charges no debt on that first
   * death, so nothing that answers a Deathrattle answers this.
   */
  reborn?: boolean;
  /**
   * Frenzy. The first time this body takes damage and lives, its onSurvive
   * trigger fires, once per body. A body that dies to the hit never frenzies.
   */
  frenzy?: boolean;
  /**
   * Effect Damage. While this card is in play, every point of damage its
   * controller deals from a spell, power or flip is increased by this much.
   * Combat is untouched: Pepper's keyword, not a strength buff.
   */
  effectDamage?: number;
  /**
   * While this card is in play, wounds on enemy summons convert to damage
   * one for one instead of two for one. Oil's payoff keyword.
   */
  woundAmplify?: boolean;
  /**
   * While this body is in play, every debt gain to every player is 1 bigger,
   * once per copy, the controller's own bills included. Loanshark's aura.
   */
  debtAmplify?: boolean;
  /**
   * Supporter Lock. While this card is in play the other player may not face a
   * supporter at all. It forbids rather than reduces, so it beats any allowance
   * they have been given.
   */
  supporterLock?: boolean;
  /**
   * While this card is in play and its controller holds no slot summons, their
   * spells and traps cost nothing. A summon standing in a slot is a summon its
   * controller holds, so a body with this only turns it on from the leader seat.
   */
  freeSpells?: boolean;
  /**
   * Stationary. This body never declares an attack. It still deals its
   * strength back when attacked.
   */
  stationary?: boolean;
  /**
   * Spell Trap. This trap's response window is the enemy casting a spell, not
   * an attack. Springing it counters the spell before it resolves.
   */
  spellTrap?: boolean;
  /**
   * Spell Trap only. Springing this one does not counter: its effect runs
   * first, then the spell resolves as though nothing had answered it.
   */
  letSpellResolve?: boolean;
  /**
   * While this card is in play, your spells resolve their effect twice.
   */
  spellEcho?: boolean;
  /**
   * While this card is in play, Rot and Dread in the enemy's deck have double
   * effect.
   */
  cursePotency?: boolean;
  /**
   * HP cards this summon's combat damage flips lose their FLIP effects, and it
   * turns 1 of its own flipped HP cards back down for each one muted.
   */
  muffleFlips?: boolean;
  /**
   * While this is on your side, your HP cards and spells are annihilated instead
   * of reaching your discard pile, so nothing recurs and there is nothing left to
   * reshuffle when the deck runs out.
   */
  voidsDiscard?: boolean;
  /**
   * This spell removes itself from the game after it resolves instead of
   * reaching the discard pile. A countered copy still discards: it was
   * answered rather than used.
   */
  annihilateAfterCast?: boolean;
  rarity?: Rarity;
  /**
   * A card the game creates rather than a deck: curses, fusion products. It
   * has art and renders like any card, but no deck may run it.
   */
  uncollectible?: boolean;
  /** Path under the art pack, without extension, e.g. 'Blue/2/fishwizard'. */
  art?: string;
  /**
   * Set when the card was minted as a rebuild of another card: the art is
   * recoloured to the colour it came out as, so a rebuild never wears the
   * colours of the card it was taken from.
   */
  artTint?: ArtTint;
  artist?: string;
  /** Collector number shown in the card footer. */
  num?: string;
  powers?: Power[];
  triggers?: Triggers;
  /** spell | trap | stage */
  targets?: TargetSpec[];
  effect?: EffectFn;
  /** Triggered when this card is flipped face up as damage. */
  flip?: FlipEffect;
  flipText?: string;
  /** When set, the flip is optional and its owner must pay this to fire it. */
  flipCost?: FlipCost;
  /**
   * Whether paying for this flip would actually do anything right now. A flip
   * that answers false is declined without ever asking, so no one is offered
   * the chance to pay a Fish for a summon their debt zone does not hold.
   * Absent means always worth asking.
   */
  flipUseful?: (ctx: FlipCheckCtx) => boolean;
  /**
   * Whether this trap can answer the window that is open. A trap that prints no
   * opinion always can; the one that does answers for a window its effect would
   * find nothing to do in, so the game does not offer it as a live response.
   */
  trapUseful?: (ctx: TrapCheckCtx) => boolean;
  /** stage only. A stage stays in play and applies these continuously. */
  stageHooks?: StageHooks;
  /** Candy: this summon is a shop. The printed line lives in `text`. */
  store?: StoreDef;
  /**
   * Candy's Clearance Sale. While this is its controller's stage, their Stores
   * hold 2 stock instead of 1, self-use costs 1 less, and every price a buyer
   * pays them drops by 1, to a minimum of 1.
   */
  storeBoost?: boolean;
}

export type EffectFn = (ctx: EffectCtx) => void;

export interface PutSummonOptions {
  /** Overrides printed strength, marking this as a card played as something else. */
  strength: number;
  color: CardColour;
  hp: number;
  /** Debt this instance is worth when it dies. Defaults to 1. */
  level?: number;
  /**
   * Enters as its printed self, keeping its powers and stats; only the hp
   * count is taken from the options. strength and color are ignored.
   */
  asPrinted?: boolean;
}

export interface EffectCtx {
  readonly state: import('./state').GameState;
  /** Controller of the effect. */
  readonly me: PlayerIdx;
  readonly opp: PlayerIdx;
  /** The summon whose power or trigger is running, if any. */
  readonly source: import('./state').SummonInstance | null;
  readonly card: CardDef;
  readonly targets: TargetRef[];

  log(message: string): void;
  damage(target: TargetRef, amount: number): void;
  /** Damage that skips Effect Damage, for a cost a card charges itself. */
  rawDamage(target: TargetRef, amount: number): void;
  wound(target: TargetRef, amount: number): void;
  /** Power Shields, each stopping one instance of damage outright. */
  shield(target: TargetRef, count: number): void;
  /**
   * From a Deathrattle: this body goes back to its owner's hand rather than into
   * the debt zone. The debt its level costs is still charged.
   */
  returnToHand(asId?: string): void;
  /**
   * From a Deathrattle: this death charges no debt at all. The card is spent to
   * the discard pile and the counter is never billed for it, whatever debt its
   * owner was carrying and whatever killed it.
   */
  freeDeath(): void;
  /** Fish: flipped HP cards come back to their owner's hand. */
  catch(target: TargetRef, count: number): number;
  /** Oil: junk shuffled into a deck, each copy a bad flip waiting to happen. */
  curse(player: PlayerIdx, cardId: string, count: number): number;
  /** Put a named card straight into a supporter row, from nowhere. */
  giveSupporter(player: PlayerIdx, cardId: string, sapped?: boolean): void;
  /** Send a supporter to its owner's debt zone. The row closes up behind it. */
  destroySupporter(target: TargetRef): boolean;
  /** Take a supporter back out of the row and into its owner's hand. */
  returnSupporter(target: TargetRef): boolean;
  /** Reveal the top `count` of another player's deck for this one to take from. */
  raidDeck(victim: PlayerIdx, chooser: PlayerIdx, count: number, effect: string): void;
  /** Oil: the hole a dead summon left stays open for a turn. */
  lockReplace(player: PlayerIdx, turns?: number): void;
  /** Robot: take something out of a debt zone and put it in your hand. */
  takeFromDebt(from: PlayerIdx, match: (c: CardDef) => boolean): CardDef | null;
  supporterFromDeck(player: PlayerIdx, sapped?: boolean): string | null;
  /** Robot: the same, but the card is rebuilt in Robot while you hold it. */
  hack(from: PlayerIdx, match: (c: CardDef) => boolean): CardDef | null;
  /** Oil and Robot: everything that player casts costs this much more, from now on. */
  taxSpells(player: PlayerIdx, amount: number): void;
  draw(player: PlayerIdx, count: number): void;
  /** Move the top `count` cards of a deck into the debt zone (no debt counters). */
  mill(player: PlayerIdx, count: number): void;
  /** Add `count` face-down HP cards off the top of the owner's deck. */
  reinforce(target: TargetRef, count: number): void;
  /** Effect Damage added to this body for as long as it stays in play. */
  grantEffectDamage(target: TargetRef, amount: number): void;
  buffStrength(target: TargetRef, amount: number, duration: 'turn' | 'permanent'): void;
  sap(target: TargetRef): void;
  unsap(target: TargetRef): void;
  /** Look at the top `count`, take the first match to hand, rest to the bottom. */
  /** Scry: reveal the top cards as a pending choice; the player takes a legal one. */
  dig(
    player: PlayerIdx,
    count: number,
    match: (c: CardDef) => boolean,
    opts?: { effect?: string; prompt?: string; at?: TargetRef },
  ): void;
  /** Search a whole deck for matching cards and offer only those. */
  search(
    player: PlayerIdx,
    match: (c: CardDef) => boolean,
    opts?: { effect?: string; prompt?: string; at?: TargetRef },
  ): void;
  /** Defer a board pick to this effect's controller, resolved by a registered key. */
  choose(
    effect: string,
    refs: TargetRef[],
    prompt: string,
    opts?: { optional?: boolean; at?: TargetRef; player?: PlayerIdx },
  ): void;
  /** Refs for every summon sitting in a player's debt zone. */
  debtSummons(player: PlayerIdx): TargetRef[];
  /** Refs for every spell sitting in a player's discard pile. */
  discardSpells(player: PlayerIdx): TargetRef[];
  /** Shuffle a player's discard pile and reveal its top cards as a scry. */
  scryDiscard(player: PlayerIdx, count: number, match: (c: CardDef) => boolean): void;
  /** Shuffle `count` random discard cards back into the deck. */
  recycleDiscard(player: PlayerIdx, count: number): void;
  /** The most recent discard card goes back into that player's deck. */
  recycleTopDiscard(player: PlayerIdx): boolean;
  summonAt(target: TargetRef): import('./state').SummonInstance | null;
  destroy(target: TargetRef): void;
  /** Removes a body from play for good: no debt zone, no coming back. */
  annihilate(target: TargetRef): void;
  /** Strips cards off a discard pile for good, newest first. */
  annihilateDiscard(player: PlayerIdx, count: number): number;
  /** Adds Effect Damage to this player's next spell this turn. */
  grantSpellBonus(amount: number): void;
  /**
   * Destroys a body and takes its card as face-down HP on the summon running
   * this effect. No debt is charged: the card never reaches the debt zone.
   */
  devour(target: TargetRef): boolean;
  reviveFromDebt(player: PlayerIdx, match: (c: CardDef) => boolean): CardDef | null;
  /** Takes the card at a debt-pile index, healing its level off the debt counter. */
  removeFromDebt(player: PlayerIdx, index: number): string | null;
  /** The most recent matching card in a discard pile comes back to your hand. */
  reviveFromDiscard(player: PlayerIdx, match?: (c: CardDef) => boolean): CardDef | null;
  /** A targeted discard-pile card comes back to your hand. */
  reclaim(target: TargetRef): CardDef | null;
  /** A random card out of a discard pile, into your hand. */
  drawRandomFromDiscard(player: PlayerIdx): CardDef | null;

  /** Index of an open summon slot, or null when the board is full. */
  emptySlot(player: PlayerIdx): number | null;
  /** Removes and returns the card id at a hand index. */
  takeFromHand(player: PlayerIdx, index: number): string | null;
  /** Puts a card into a slot as a summon, drawing its HP off the deck. */
  putSummon(
    player: PlayerIdx,
    cardId: string,
    slot: number,
    options: PutSummonOptions,
  ): import('./state').SummonInstance | null;

  // --- structural verbs, the ones cards get interesting with ---------------

  /** Slide a card from hand under a summon as face-down HP. */
  stackHp(target: TargetRef, handIndex: number): boolean;
  /** Move `count` face-down HP cards from one summon to another. */
  moveHp(from: TargetRef, to: TargetRef, count: number): number;
  /** Turn `count` flipped HP cards back face down. The only real healing. */
  unflip(target: TargetRef, count: number): number;
  /** Send a summon back to its owner's hand, HP cards to the debt zone. */
  bounce(target: TargetRef): boolean;
  /** A body in play goes back into its owner's deck, charging no debt. */
  shuffleIntoDeck(target: TargetRef): boolean;
  /** A player's whole hand goes back into their deck. Returns how many. */
  shuffleHandIntoDeck(player: PlayerIdx): number;
  /** Replace what a summon is, keeping its HP cards, wounds and sapped state. */
  transform(target: TargetRef, cardId: string): boolean;
  /** Move a summon to the other side of the board, if there is room. */
  takeControl(target: TargetRef): boolean;
  /** Add debt directly. Positive hurts the player named. */
  addDebt(player: PlayerIdx, amount: number, reason?: string): void;
  /** Pay debt off. Never goes below zero. */
  clearDebt(player: PlayerIdx, amount: number): void;
  /** Candy: add Love tokens to a player's count. */
  gainLove(player: PlayerIdx, amount: number): void;
  /** Candy: spend every Love token a player holds. Returns how many. */
  spendLove(player: PlayerIdx): number;
  /** Put a card from the debt zone under a summon as face-down HP. */
  debtToHp(target: TargetRef, debtIndex: number): boolean;
  /** How many summons of a faction that player controls, leaders included. */
  countFaction(player: PlayerIdx, faction: Faction): number;
  /** Every summon in play on a side, leader included when asked. */
  summonsOf(player: PlayerIdx, includeLeader?: boolean): TargetRef[];
  /** Put a card straight into a hand, from anywhere or from nowhere. */
  toHand(player: PlayerIdx, cardId: string): void;
  /** Discard from hand at random-free choice: the caller picks the index. */
  discard(player: PlayerIdx, index: number): string | null;
}

export interface FlipCtx {
  readonly state: import('./state').GameState;
  /** Owner of the summon the card was protecting. */
  readonly me: PlayerIdx;
  readonly opp: PlayerIdx;
  readonly holder: import('./state').SummonInstance;
  readonly card: CardDef;
  log(message: string): void;
  damage(target: TargetRef, amount: number): void;
  wound(target: TargetRef, amount: number): void;
  draw(player: PlayerIdx, count: number): void;
  mill(player: PlayerIdx, count: number): void;
  reinforce(target: TargetRef, count: number): void;
  /** Effect Damage added to this body for as long as it stays in play. */
  grantEffectDamage(target: TargetRef, amount: number): void;
  shield(target: TargetRef, count: number): void;
  catch(target: TargetRef, count: number): number;
  curse(player: PlayerIdx, cardId: string, count: number): number;
  lockReplace(player: PlayerIdx, turns?: number): void;
  /** Solar's ramp: the top card of the deck becomes a supporter, sapped. */
  /** Sends the summon this card was protecting to the debt zone. */
  destroyHolder(): void;
  /** This flipped card leaves the body it was protecting for the discard pile. */
  discardThis(): boolean;
  /** Candy: this flipped card leaves the HP stack for its owner's hand. */
  returnThis(): boolean;
  /** Candy: add Love tokens to a player's count. */
  gainLove(player: PlayerIdx, amount: number): void;
  supporterFromDeck(player: PlayerIdx, sapped?: boolean): string | null;
  buffStrength(target: TargetRef, amount: number, duration: 'turn' | 'permanent'): void;
  reviveFromDebt(player: PlayerIdx, match: (c: CardDef) => boolean): CardDef | null;
  unflip(target: TargetRef, count: number): number;
  addDebt(player: PlayerIdx, amount: number, reason?: string): void;
  clearDebt(player: PlayerIdx, amount: number): void;
  summonsOf(player: PlayerIdx, includeLeader?: boolean): TargetRef[];
  toHand(player: PlayerIdx, cardId: string): void;
  /** Defer a board pick to the flip's owner, resolved by a registered key. */
  choose(
    effect: string,
    refs: TargetRef[],
    prompt: string,
    opts?: { optional?: boolean; at?: TargetRef; player?: PlayerIdx },
  ): void;
  /** Refs for every summon sitting in a player's debt zone. */
  debtSummons(player: PlayerIdx): TargetRef[];
  /** Refs for every supporter in a player's row, sapped or not. */
  supportersOf(player: PlayerIdx): TargetRef[];
  /** Empties a player's floating mana pool. Returns how many pips were lost. */
  clearMana(player: PlayerIdx): number;
  /** Refs for every spell sitting in a player's discard pile. */
  discardSpells(player: PlayerIdx): TargetRef[];
  /** Shuffle a player's discard pile and reveal its top cards as a scry. */
  scryDiscard(player: PlayerIdx, count: number, match: (c: CardDef) => boolean): void;
  /** Shuffle `count` random discard cards back into the deck. */
  recycleDiscard(player: PlayerIdx, count: number): void;
  summonAt(target: TargetRef): import('./state').SummonInstance | null;
}

/**
 * What a costed flip is shown when it is asked whether paying would change
 * anything. Deliberately read-only and much smaller than FlipCtx: the answer is
 * wanted while a prompt is being drawn, outside any action, so nothing here may
 * touch the position.
 */
/** What a trap is allowed to look at when asked whether it could answer. */
export interface TrapCheckCtx {
  readonly state: import('./state').GameState;
  /** The player holding the trap. */
  readonly me: PlayerIdx;
  readonly opp: PlayerIdx;
  summonAt(target: TargetRef): import('./state').SummonInstance | null;
}

export interface FlipCheckCtx {
  readonly state: import('./state').GameState;
  /** Owner of the summon the card is protecting. */
  readonly me: PlayerIdx;
  readonly opp: PlayerIdx;
  readonly holder: import('./state').SummonInstance;
  /** Refs for every summon sitting in a player's debt zone. */
  debtSummons(player: PlayerIdx): TargetRef[];
  /** Every summon in play on a side, leader included when asked. */
  summonsOf(player: PlayerIdx, includeLeader?: boolean): TargetRef[];
  summonAt(target: TargetRef): import('./state').SummonInstance | null;
  /** Cards left in a player's deck. */
  deckLeft(player: PlayerIdx): number;
  /** Cards in a player's discard pile. */
  discardLeft(player: PlayerIdx): number;
}

export function costToString(cost: Cost | undefined): string {
  if (!cost) return '';
  let out = '';
  // Colours in order, then the colourless pips, matching the C# Cost.ToString.
  for (const c of COLORS) out += c.repeat(cost[c] ?? 0);
  out += 'C'.repeat(cost.C ?? 0);
  return out;
}

/** Coloured pips only. Colourless is deliberately not a colour. */
export function costColored(cost: Cost | undefined): number {
  if (!cost) return 0;
  return COLORS.reduce((n, c) => n + (cost[c] ?? 0), 0);
}

export function costTotal(cost: Cost | undefined): number {
  if (!cost) return 0;
  return COST_KINDS.reduce((n, c) => n + (cost[c] ?? 0), 0);
}

export function parseCost(s: string): Cost {
  const out: Cost = {};
  for (const ch of s.toUpperCase()) {
    if ((COLORS as string[]).includes(ch)) {
      const c = ch as Color;
      out[c] = (out[c] ?? 0) + 1;
    }
  }
  return out;
}

export function hasFaction(def: CardDef, faction: Faction): boolean {
  return !!def.factions && def.factions.includes(faction);
}

/**
 * Everything a player has to read to play the card: its passive line, the text
 * of each Power, and its flip line, joined by single spaces. Name, factions,
 * cost and the stat line are not rules text.
 */
export function rulesTextLength(
  def: Pick<CardDef, 'text' | 'powers' | 'flipText'>,
): number {
  const parts: string[] = [];
  if (def.text) parts.push(def.text);
  for (const p of def.powers ?? []) parts.push(p.text);
  if (def.flipText) parts.push(def.flipText);
  return parts.join(' ').length;
}

/**
 * Prices a card that has no tier yet. Rules text is the baseline, on the theory
 * that how much a card commits you to tracks how long it takes to print, and the
 * adjustments below move it off that. The answer is written into RARITY_FIXED
 * once and read from there afterwards, so editing a card's text never reprints
 * it at a new tier. Mirrored by Rarities.ForCard in the C# engine.
 */
export function rarityForCard(def: CardDef): Rarity {
  const fixed = RARITY_FIXED[def.id];
  if (fixed) return fixed;
  if (def.starter) return 'L';
  const printed = rulesTextLength(def);
  let n = printed;
  if (def.type === 'summon') n += RARITY_LEVEL_ADJUST[def.level ?? 1] ?? 0;
  // A dual card asks a deck for two colours, so nothing about it is common and
  // nothing may push it below what its own text already earned.
  if (def.color2) n = Math.max(n, printed, RARITY_CUTS.R);
  // A triple card can only be run by a leader that brings all three colours, so
  // a deck is built around it rather than including it. At level 3 that is the
  // largest commitment the set can ask for, and it prints Legendary whatever
  // its text: the four terse ones are the four that do the most.
  if (def.color3) return def.level === 3 ? 'L' : 'E';
  if (n >= RARITY_CUTS.L) return printed >= RARITY_CUTS.L ? 'L' : 'E';
  if (n >= RARITY_CUTS.E) return 'E';
  if (n >= RARITY_CUTS.R) return 'R';
  return 'C';
}
