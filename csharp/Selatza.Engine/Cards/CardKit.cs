namespace Selatza.Cards;

/// <summary>
/// Mirrors src/cards/build.ts. Card ids, art paths and level baselines are
/// generated the same way on both sides so a card ported across keeps its id,
/// which is what lets a replay recorded in one engine run in the other.
/// </summary>
public static class Kit
{
    public static readonly (int Strength, int Hp)[] LevelBase =
    {
        default,
        (1, 1),
        (2, 3),
        (3, 5),
    };

    private static int _counter;

    public static void ResetNumbering() => _counter = 0;

    private static string NextNum() => (++_counter).ToString("D3");

    public static string ArtPath(string rel) => $"Cardgame/{rel}.png";

    public static Faction[] F(params Faction[] f) => f;

    /// <summary>
    /// Leader. Wraps an effect so it runs only while the card holding it is its
    /// owner's leader; in any other seat the effect is simply absent.
    /// </summary>
    public static Action<EffectCtx> LeaderOnly(Action<EffectCtx> effect) => c =>
    {
        if (c.Self is { Kind: TargetKind.Leader }) effect(c);
    };

    public static TargetSpec[] Specs(params TargetSpec[] s) => s;

    public static Power[] Powers(params Power[] p) => p;

    // --- targeting shorthands ------------------------------------------------

    public static TargetSpec Enemy(string label = "an enemy summon") =>
        new() { Kind = TargetKind.Summon, Side = Side.Enemy, Label = label };

    public static TargetSpec EnemyOrLeader(string label = "an enemy summon or leader") =>
        new() { Kind = TargetKind.Summon, Side = Side.Enemy, IncludeLeader = true, Label = label };

    public static TargetSpec Ally(string label = "an ally summon") =>
        new() { Kind = TargetKind.Summon, Side = Side.Ally, Label = label };

    public static TargetSpec AllyOrLeader(string label = "an ally summon or your leader") =>
        new() { Kind = TargetKind.Summon, Side = Side.Ally, IncludeLeader = true, Label = label };

    public static TargetSpec Any(string label = "any summon") =>
        new() { Kind = TargetKind.Summon, Side = Side.Any, Label = label };

    public static TargetSpec AnyOrLeader(string label = "any summon or leader") =>
        new() { Kind = TargetKind.Summon, Side = Side.Any, IncludeLeader = true, Label = label };

    public static TargetSpec HandCard(string label, CardType? ofType = null) => new()
    {
        Kind = TargetKind.Hand,
        Side = Side.Ally,
        Label = label,
        Filter = ofType is null ? null : a => a.Card is not null && a.Card.Type == ofType.Value,
    };

    // A discard flip cost sends the card to the debt zone, so a spell or a trap
    // can be sitting in there. Both of these read "a summon" and have to mean it.
    public static TargetSpec MyDebt(string label = "a summon in your debt") =>
        new()
        {
            Kind = TargetKind.Debt, Side = Side.Ally, Label = label,
            Filter = a => a.Card?.Type == CardType.Summon,
        };

    public static TargetSpec EnemyDebt(string label = "a summon in the enemy's debt") =>
        new()
        {
            Kind = TargetKind.Debt, Side = Side.Enemy, Label = label,
            Filter = a => a.Card?.Type == CardType.Summon,
        };

    public static TargetSpec MySupporter(string label = "one of your supporters") =>
        new() { Kind = TargetKind.Supporter, Side = Side.Ally, Label = label };

    // --- builders ------------------------------------------------------------

    /// <summary>
    /// Neutral cards belong to no colour, so every leader's identity contains them.
    /// They carry a colour only so the frame has something to draw with.
    /// </summary>
    public sealed class NeutralKit
    {
        public CardDef Summon(int level, string file, string name, Faction[]? factions = null,
            int str = 2, int hp = 1, string? text = null,
            Power[]? powers = null, Triggers? triggers = null, TargetSpec[]? targets = null,
            Action<FlipCtx>? flip = null, string? flipText = null, FlipCost? flipCost = null,
            bool stationary = false, bool redirect = false, bool spellImmune = false,
            bool reborn = false, bool frenzy = false)
            => new()
            {
                Id = $"n{level}-{file}",
                Name = name,
                Color = Color.N,
                Neutral = true,
                Type = CardType.Summon,
                Level = level,
                Strength = str,
                Hp = hp,
                Stationary = stationary,
                Reborn = reborn,
                Frenzy = frenzy,
                Redirect = redirect,
                SpellImmune = spellImmune,
                Factions = factions ?? Array.Empty<Faction>(),
                Text = text,
                Powers = powers,
                Triggers = triggers,
                Targets = targets,
                Art = $"Cardgame/Neutral/{level}/{file}.png",
                Num = NextNum(),
                Flip = flip,
                FlipText = flipText,
                FlipCost = flipCost,
            };

        private CardDef NonSummon(CardType type, string file, string name, Cost cost, string text,
            TargetSpec[]? targets, Action<EffectCtx>? effect, StageHooks? hooks = null)
            => new()
            {
                Id = $"nx-{file}",
                Name = name,
                Color = Color.N,
                Neutral = true,
                Type = type,
                Cost = cost,
                Text = text,
                Targets = targets,
                Effect = effect,
                StageHooks = hooks,
                Art = $"Cardgame/Neutral/Spell/{file}.png",
                Num = NextNum(),
            };

        public CardDef Spell(string file, string name, Cost cost, string text,
            TargetSpec[]? targets = null, Action<EffectCtx>? effect = null)
            => NonSummon(CardType.Spell, file, name, cost, text, targets, effect);

        public CardDef Trap(string file, string name, Cost cost, string text,
            TargetSpec[]? targets = null, Action<EffectCtx>? effect = null)
            => NonSummon(CardType.Trap, file, name, cost, text, targets, effect);

        public CardDef Stage(string file, string name, Cost cost, string text,
            StageHooks? hooks = null)
            => NonSummon(CardType.Stage, file, name, cost, text, null, null, hooks);
    }

    public sealed class ColorKit
    {
        private readonly Color _color;
        private readonly string _prefix;
        private readonly string _folder;
        private readonly string _spellFolder;

        public ColorKit(Color color, string prefix, string folder, string spellFolder)
        {
            _color = color;
            _prefix = prefix;
            _folder = folder;
            _spellFolder = spellFolder;
        }

        public CardDef Summon(int level, string file, string name, Faction[]? factions = null,
            int? str = null, int? hp = null, string? text = null,
            Power[]? powers = null, Triggers? triggers = null, TargetSpec[]? targets = null,
            Action<FlipCtx>? flip = null, string? flipText = null, FlipCost? flipCost = null,
            int effectDamage = 0, bool woundAmplify = false, bool spellEcho = false,
            bool cursePotency = false, bool muffleFlips = false,
            bool stationary = false, bool redirect = false, bool spellImmune = false,
            bool reborn = false, bool frenzy = false, bool voidsDiscard = false,
            bool neutral = false)
        {
            var b = LevelBase[level];
            return new CardDef
            {
                Id = $"{_prefix}{level}-{file}",
                Name = name,
                Color = _color,
                Type = CardType.Summon,
                Level = level,
                Strength = str ?? b.Strength,
                Hp = hp ?? b.Hp,
                EffectDamage = effectDamage,
                WoundAmplify = woundAmplify,
                SpellEcho = spellEcho,
                CursePotency = cursePotency,
                MuffleFlips = muffleFlips,
                VoidsDiscard = voidsDiscard,
                Stationary = stationary,
                Reborn = reborn,
                Frenzy = frenzy,
                Redirect = redirect,
                SpellImmune = spellImmune,
                Neutral = neutral,
                Factions = factions ?? Array.Empty<Faction>(),
                Text = text,
                Powers = powers,
                Triggers = triggers,
                Targets = targets,
                Flip = flip,
                FlipText = flipText,
                FlipCost = flipCost,
                Art = ArtPath($"{_folder}/{level}/{file}"),
                Num = NextNum(),
            };
        }

        // The `h-` in the id is historical and stays: changing it would orphan
        // every saved deck and every recorded replay that names one of these.
        public CardDef Starter(string file, string name, Faction[]? factions = null,
            int str = 2, int hp = 4, string? text = null, Power[]? powers = null,
            Triggers? triggers = null, int effectDamage = 0,
            bool redirect = false, bool spellImmune = false)
            => new()
            {
                Id = $"{_prefix}h-{file}",
                Name = name,
                Color = _color,
                Starter = true,
                Level = 3,
                Strength = str,
                Hp = hp,
                EffectDamage = effectDamage,
                Redirect = redirect,
                SpellImmune = spellImmune,
                Factions = factions ?? Array.Empty<Faction>(),
                Text = text,
                Powers = powers,
                Triggers = triggers,
                Art = ArtPath($"{_folder}/3/{file}"),
                Num = NextNum(),
            };

        private CardDef NonSummon(CardType type, string file, string name, Cost cost,
            string? text, TargetSpec[]? targets, Action<EffectCtx>? effect,
            StageHooks? hooks, string? flipText, FlipCost? flipCost, Action<FlipCtx>? flip)
            => new()
            {
                Id = $"{_prefix}x-{file}",
                Name = name,
                Color = _color,
                Type = type,
                Cost = cost,
                Text = text,
                Targets = targets,
                Effect = effect,
                StageHooks = hooks,
                FlipText = flipText,
                FlipCost = flipCost,
                Flip = flip,
                Art = ArtPath($"{_spellFolder}/{file}"),
                Num = NextNum(),
            };

        public CardDef Spell(string file, string name, Cost cost, string text,
            TargetSpec[]? targets = null, Action<EffectCtx>? effect = null,
            string? flipText = null, FlipCost? flipCost = null,
            Action<FlipCtx>? flip = null)
            => NonSummon(CardType.Spell, file, name, cost, text, targets, effect, null, flipText, flipCost, flip);

        public CardDef Trap(string file, string name, Cost cost, string text,
            TargetSpec[]? targets = null, Action<EffectCtx>? effect = null,
            string? flipText = null, FlipCost? flipCost = null,
            Action<FlipCtx>? flip = null, bool spellTrap = false, bool letSpellResolve = false)
            => new()
            {
                Id = $"{_prefix}x-{file}",
                Name = name,
                Color = _color,
                Type = CardType.Trap,
                Cost = cost,
                Text = text,
                Targets = targets,
                Effect = effect,
                SpellTrap = spellTrap,
                LetSpellResolve = letSpellResolve,
                FlipText = flipText,
                FlipCost = flipCost,
                Flip = flip,
                Art = ArtPath($"{_spellFolder}/{file}"),
                Num = NextNum(),
            };

        public CardDef Stage(string file, string name, Cost cost, string text,
            StageHooks? hooks = null,
            string? flipText = null, FlipCost? flipCost = null,
            Action<FlipCtx>? flip = null, Action<EffectCtx>? effect = null)
            => NonSummon(CardType.Stage, file, name, cost, text, null, effect, hooks,
                flipText, flipCost, flip);
    }

    /// <summary>Dual-colour cards live in their own folders and carry two colours.</summary>
    public sealed class DualKit
    {
        private readonly string _pair;
        private readonly Color _a;
        private readonly Color _b;

        public DualKit(string pair, Color a, Color b)
        {
            _pair = pair;
            _a = a;
            _b = b;
        }

        private string Id(string file) => $"m-{_pair.ToLowerInvariant()}-{file}";

        public CardDef Summon(int level, string file, string name, Faction[]? factions = null,
            int? str = null, int? hp = null, string? text = null,
            Power[]? powers = null, Triggers? triggers = null, TargetSpec[]? targets = null,
            Action<FlipCtx>? flip = null, string? flipText = null, int effectDamage = 0,
            bool cursePotency = false, bool stationary = false, bool redirect = false,
            bool spellImmune = false, bool reborn = false, bool frenzy = false,
            bool neutral = false)
        {
            var b = LevelBase[level];
            return new CardDef
            {
                Id = Id(file),
                Name = name,
                Color = _a,
                Color2 = _b,
                Type = CardType.Summon,
                Level = level,
                Strength = str ?? b.Strength,
                Hp = hp ?? b.Hp,
                EffectDamage = effectDamage,
                CursePotency = cursePotency,
                Stationary = stationary,
                Reborn = reborn,
                Frenzy = frenzy,
                Redirect = redirect,
                SpellImmune = spellImmune,
                Factions = factions ?? Array.Empty<Faction>(),
                Text = text,
                Powers = powers,
                Triggers = triggers,
                Targets = targets,
                Flip = flip,
                FlipText = flipText,
                Art = ArtPath($"Mixed/{_pair}/{file}"),
                Num = NextNum(),
            };
        }

        private CardDef Other(CardType type, string file, string name, Cost cost, string? text,
            TargetSpec[]? targets, Action<EffectCtx>? effect, StageHooks? hooks,
            string? flipText, FlipCost? flipCost, Action<FlipCtx>? flip)
            => new()
            {
                Id = Id(file),
                Name = name,
                Color = _a,
                Color2 = _b,
                Type = type,
                Cost = cost,
                Text = text,
                Targets = targets,
                Effect = effect,
                StageHooks = hooks,
                FlipText = flipText,
                FlipCost = flipCost,
                Flip = flip,
                Art = ArtPath($"Mixed/{_pair}/{file}"),
                Num = NextNum(),
            };

        public CardDef Spell(string file, string name, Cost cost, string text,
            TargetSpec[]? targets = null, Action<EffectCtx>? effect = null,
            string? flipText = null, FlipCost? flipCost = null,
            Action<FlipCtx>? flip = null)
            => Other(CardType.Spell, file, name, cost, text, targets, effect, null, flipText, flipCost, flip);

        public CardDef Trap(string file, string name, Cost cost, string text,
            TargetSpec[]? targets = null, Action<EffectCtx>? effect = null,
            string? flipText = null, FlipCost? flipCost = null,
            Action<FlipCtx>? flip = null)
            => Other(CardType.Trap, file, name, cost, text, targets, effect, null, flipText, flipCost, flip);

        public CardDef Stage(string file, string name, Cost cost, string text,
            StageHooks? hooks = null,
            string? flipText = null, FlipCost? flipCost = null,
            Action<FlipCtx>? flip = null, Action<EffectCtx>? effect = null)
            => Other(CardType.Stage, file, name, cost, text, null, effect, hooks,
                flipText, flipCost, flip);
    }

    /// <summary>
    /// Triple-colour cards. Only a leader carrying all three colours can run
    /// one, so a deck is built around it rather than including it; every one of
    /// them is a level 3 legend and there is exactly one per combination.
    /// </summary>
    public sealed class TripleKit
    {
        private readonly string _trio;
        private readonly Color _a;
        private readonly Color _b;
        private readonly Color _c;

        public TripleKit(string trio, Color a, Color b, Color c)
        {
            _trio = trio;
            _a = a;
            _b = b;
            _c = c;
        }

        /// <summary>
        /// `file` is the art basename as the pack spells it, which is the one
        /// place in the set a filename carries a space; the id slug strips it.
        /// </summary>
        public CardDef Summon(string file, string name, Faction[]? factions = null,
            int? str = null, int? hp = null, string? text = null,
            Power[]? powers = null, Triggers? triggers = null, bool freeSpells = false,
            bool spellImmune = false)
            => Summon(3, file, name, factions, str, hp, text, powers, triggers,
                freeSpells, spellImmune);

        /// <summary>
        /// The ten legends are level 3; a three-colour card printed at any other
        /// level is an ordinary card that happens to need all three colours.
        /// </summary>
        public CardDef Summon(int level, string file, string name, Faction[]? factions = null,
            int? str = null, int? hp = null, string? text = null,
            Power[]? powers = null, Triggers? triggers = null, bool freeSpells = false,
            bool spellImmune = false)
        {
            var b = LevelBase[level];
            var slug = new string(file.ToLowerInvariant()
                .Where(ch => (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')).ToArray());
            return new CardDef
            {
                Id = $"m-{_trio.ToLowerInvariant()}-{slug}",
                Name = name,
                Color = _a,
                Color2 = _b,
                Color3 = _c,
                Type = CardType.Summon,
                Level = level,
                Strength = str ?? b.Strength,
                Hp = hp ?? b.Hp,
                FreeSpells = freeSpells,
                SpellImmune = spellImmune,
                Factions = factions ?? Array.Empty<Faction>(),
                Text = text,
                Powers = powers,
                Triggers = triggers,
                Art = ArtPath($"Mixed/{_trio}/{file}"),
                Num = NextNum(),
            };
        }
    }
}
