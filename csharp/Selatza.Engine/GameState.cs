namespace Selatza;

public sealed class HpCard
{
    public required string CardId { get; set; }
    public bool Flipped { get; set; }
    public HpCard Clone() => new() { CardId = CardId, Flipped = Flipped };
}

public enum ModDuration { Turn, Permanent }

public readonly record struct StrengthMod(int Amount, ModDuration Duration);

public sealed class SummonOverride
{
    public int Strength { get; set; }
    public Color Color { get; set; }
    public int Level { get; set; }
    public SummonOverride Clone() => new()
    { Strength = Strength, Color = Color, Level = Level };
}

public sealed class SummonInstance
{
    public required string Uid { get; set; }
    public required string CardId { get; set; }
    public int Owner { get; set; }
    public bool IsLeader { get; set; }
    public List<HpCard> Hp { get; set; } = new();
    public bool Sapped { get; set; }
    /// <summary>Reborn and Frenzy each fire once for a given body.</summary>
    public bool RebornUsed { get; set; }
    public bool FrenzyUsed { get; set; }
    public int Wounds { get; set; }
    public List<StrengthMod> StrengthMods { get; set; } = new();
    /// <summary>
    /// Power Shields. Each one stops one instance of damage outright, however
    /// large, and is spent doing it. Robot's keyword.
    /// </summary>
    public int Shields { get; set; }
    public Dictionary<string, int> PowerUses { get; set; } = new(StringComparer.Ordinal);
    public SummonOverride? Override { get; set; }

    /// <summary>
    /// Card id whose Powers this body has borrowed: a summon lends its printed
    /// powers, a spell lends a sap-cost cast of itself at its printed cost.
    /// </summary>

    /// <summary>Made Stationary by an effect: it never declares an attack again.</summary>
    public bool Rooted { get; set; }

    /// <summary>The next time this body would unsap, it stays sapped instead (Pointer).</summary>
    public bool SapLock { get; set; }

    /// <summary>Card id whose Deathrattle this body fires in addition to its own.</summary>
    public string? Bestowed { get; set; }

    public int EnteredTurn { get; set; }

    public int RemainingHp
    {
        get
        {
            int n = 0;
            foreach (var h in Hp) if (!h.Flipped) n++;
            return n;
        }
    }

    public SummonInstance Clone()
    {
        var s = new SummonInstance
        {
            Uid = Uid,
            CardId = CardId,
            Owner = Owner,
            IsLeader = IsLeader,
            Sapped = Sapped,
            RebornUsed = RebornUsed,
            FrenzyUsed = FrenzyUsed,
            Wounds = Wounds,
            Shields = Shields,
            Rooted = Rooted,
            SapLock = SapLock,
            Bestowed = Bestowed,
            EnteredTurn = EnteredTurn,
            Override = Override?.Clone(),
            StrengthMods = new List<StrengthMod>(StrengthMods),
            PowerUses = new Dictionary<string, int>(PowerUses, StringComparer.Ordinal),
            Hp = new List<HpCard>(Hp.Count),
        };
        foreach (var h in Hp) s.Hp.Add(h.Clone());
        return s;
    }
}

public sealed class Supporter
{
    public required string CardId { get; set; }
    public bool Sapped { get; set; }
    public Supporter Clone() => new() { CardId = CardId, Sapped = Sapped };
}

public sealed class PlayerState
{
    public required string Name { get; set; }
    public List<string> Deck { get; set; } = new();
    public List<string> Hand { get; set; } = new();
    /// <summary>Bodies this player owes for. Only these feed the debt counter.</summary>
    public List<string> DebtZone { get; set; } = new();

    /// <summary>
    /// Everything else that has been spent: HP cards a summon was wearing, cast
    /// spells, sprung traps, replaced stages, mills and discards. Public, and
    /// costs nothing by itself.
    /// </summary>
    public List<string> Discard { get; set; } = new();
    public int DebtCount { get; set; }
    public List<Supporter> Supporters { get; set; } = new();
    public SummonInstance?[] Slots { get; set; } = new SummonInstance?[Rules.SummonSlots];
    public SummonInstance? Leader { get; set; }
    public required string LeaderCardId { get; set; }
    public string? Stage { get; set; }
    /// <summary>Five colours then colourless, which is why this is six wide.</summary>
    public int[] Mana { get; set; } = new int[Rules.ManaKinds];
    /// <summary>Supporters this player may still face this turn.</summary>
    public int SupportersLeft { get; set; } = 1;
    /// <summary>Effect Damage waiting on this player's next spell this turn.</summary>
    public int SpellBonus { get; set; }
    public bool LeaderPlayed { get; set; }
    public int TurnsTaken { get; set; }
    /// <summary>Times this deck has run dry. Each one costs more than the last.</summary>
    public int DeckOuts { get; set; }
    /// <summary>
    /// A slot this player may not fill until they pay. Oil's curse: the hole a
    /// dead summon leaves stays open, and the leader behind it stays exposed,
    /// until the price is met. Counts down one at the start of their turn.
    /// </summary>
    public int ReplaceLocked { get; set; }

    /// <summary>
    /// Cards this player has hacked. While they hold one, it costs its total in
    /// Robot and pays in Robot as a supporter, whatever colour it was printed.
    /// </summary>

    /// <summary>
    /// Extra colourless this player pays on every spell and trap they cast.
    /// Oil and Robot put it there and it stays until something takes it off.
    /// </summary>
    public int SpellTax { get; set; }

    public PlayerState Clone()
    {
        var p = new PlayerState
        {
            Name = Name,
            LeaderCardId = LeaderCardId,
            DebtCount = DebtCount,
            Stage = Stage,
            SupportersLeft = SupportersLeft,
            SpellBonus = SpellBonus,
            LeaderPlayed = LeaderPlayed,
            TurnsTaken = TurnsTaken,
            DeckOuts = DeckOuts,
            ReplaceLocked = ReplaceLocked,
            SpellTax = SpellTax,
            Deck = new List<string>(Deck),
            Hand = new List<string>(Hand),
            DebtZone = new List<string>(DebtZone),
            Discard = new List<string>(Discard),
            Mana = (int[])Mana.Clone(),
            Leader = Leader?.Clone(),
            Slots = new SummonInstance?[Slots.Length],
            Supporters = new List<Supporter>(Supporters.Count),
        };
        for (int i = 0; i < Slots.Length; i++) p.Slots[i] = Slots[i]?.Clone();
        foreach (var s in Supporters) p.Supporters.Add(s.Clone());
        return p;
    }

    public bool HasFieldSummon
    {
        get
        {
            foreach (var s in Slots) if (s is not null) return true;
            return false;
        }
    }
}

/// <summary>One card's own text doing something, for a client to announce.</summary>
public sealed class EffectFx
{
    public required string CardId { get; init; }
    public required int Player { get; init; }
    public required TargetRef At { get; init; }
}

public sealed class PendingBattle
{
    public TargetRef Attacker { get; set; }
    public TargetRef Defender { get; set; }
    public bool TrapUsed { get; set; }
    public PendingBattle Clone() => new()
    { Attacker = Attacker, Defender = Defender, TrapUsed = TrapUsed };
}

/// <summary>A spell waiting on the other side's response window before it resolves.</summary>
public sealed class PendingSpell
{
    public int Caster { get; set; }
    public required string CardId { get; set; }
    public TargetRef[] Targets { get; set; } = Array.Empty<TargetRef>();
    public PendingSpell Clone() => new()
    { Caster = Caster, CardId = CardId, Targets = (TargetRef[])Targets.Clone() };
}

/// <summary>
/// One response window at a time: an attack waiting on a trap, or an enemy
/// spell waiting on a Spell Trap. Exactly one of Battle and Spell is set.
/// </summary>
public sealed class Pending
{
    public int Player { get; set; }
    public PendingBattle? Battle { get; set; }
    public PendingSpell? Spell { get; set; }
    public Pending Clone() => new()
    { Player = Player, Battle = Battle?.Clone(), Spell = Spell?.Clone() };
}

public readonly record struct ReplaceSlot(int Player, int Slot);

/// <summary>A costed flip waiting on its owner to pay for it or wave it away.</summary>
public readonly record struct FlipOffer(int Player, TargetRef Holder, string CardId);

public readonly record struct LogEntry(int Turn, int Player, string Text);

public static class Rules
{
    public const int SummonSlots = 3;

    /// <summary>Five colours plus colourless. Colourless lives at the last index.</summary>
    public const int ManaKinds = 6;

    /// <summary>Index of the colourless bucket in a mana row.</summary>
    public const int Colorless = 5;
    public const int DebtLimit = 25;

    /// <summary>
    /// Hard stops so a match cannot run forever. Real games end in under thirty
    /// turns and a couple of hundred actions, so these only catch a lock.
    /// </summary>
    public const int MaxTurns = 500;
    public const int MaxActions = 1000;
    public const int DrawPerTurn = 2;
    public const int OpeningHand = 5;
    /// <summary>The player going second draws this many extra cards to open.</summary>
    public const int OpeningHandBonus = 0;

    /// <summary>A hand holds no more than this. Cards past it go to the discard pile.</summary>
    public const int HandLimit = 12;
}

public sealed class GameState
{
    /// <summary>Set from attack declaration until the clash finishes.</summary>
    public PendingBattle? Battle { get; set; }
    public int Seed { get; set; }
    public int RngState { get; set; }
    public int NextUid { get; set; } = 1;
    public int Turn { get; set; }
    public int Active { get; set; }
    public int StartingPlayer { get; set; }
    public Phase Phase { get; set; } = Phase.Awake;
    public PlayerState[] Players { get; set; } = Array.Empty<PlayerState>();
    public Pending? Pending { get; set; }

    /// <summary>
    /// Owner of the summon currently dying, set only while OnOtherDeath
    /// triggers run so a watcher can ask whose body fell. Null between actions.
    /// </summary>
    public int? DyingOwner { get; set; }

    /// <summary>Card id of the summon currently dying, for OnOtherDeath to read.</summary>
    public string? DyingCardId { get; set; }

    public List<ReplaceSlot> ReplaceQueue { get; set; } = new();
    /// <summary>Costed flips turned over this battle, waiting on a decision.</summary>
    public List<FlipOffer> FlipQueue { get; set; } = new();

    /// <summary>Decisions effects deferred to a player, settled before anything else moves.</summary>
    public List<PendingChoice> ChoiceQueue { get; set; } = new();
    public int Winner { get; set; } = -1;
    public string? WinReason { get; set; }
    /// <summary>Whether the match has finished, by a win or by a hard stop.</summary>
    public bool IsOver => Winner >= 0 || Drawn;

    /// <summary>True when the match hit a hard stop with nobody having won.</summary>
    public bool Drawn { get; set; }
    /// <summary>Actions applied so far, against <see cref="Rules.MaxActions"/>.</summary>
    public int Actions { get; set; }
    public List<LogEntry> Log { get; set; } = new();
    /// <summary>
    /// Cards whose own text did something during the last action, in the order it
    /// happened, so a client can say so. Not part of the game: cleared at the top
    /// of every action and left out of the digest.
    /// </summary>
    public List<EffectFx> Fx { get; set; } = new();
    public int Version { get; set; }

    public GameState Clone()
    {
        var g = new GameState
        {
            Battle = Battle?.Clone(),
            Seed = Seed,
            RngState = RngState,
            NextUid = NextUid,
            Turn = Turn,
            Active = Active,
            StartingPlayer = StartingPlayer,
            Phase = Phase,
            Pending = Pending?.Clone(),
            DyingOwner = DyingOwner,
            DyingCardId = DyingCardId,
            ReplaceQueue = new List<ReplaceSlot>(ReplaceQueue),
            FlipQueue = new List<FlipOffer>(FlipQueue),
            ChoiceQueue = ChoiceQueue.ConvertAll(c => c.Clone()),
            Winner = Winner,
            WinReason = WinReason,
            Drawn = Drawn,
            Actions = Actions,
            Version = Version,
            Log = new List<LogEntry>(Log),
            Fx = new List<EffectFx>(Fx),
            Players = new PlayerState[Players.Length],
        };
        for (int i = 0; i < Players.Length; i++) g.Players[i] = Players[i].Clone();
        return g;
    }

    public static int Other(int p) => p == 0 ? 1 : 0;

    public SummonInstance? Find(TargetRef r) => r.Kind switch
    {
        TargetKind.Summon => r.Index >= 0 && r.Index < Players[r.Player].Slots.Length
            ? Players[r.Player].Slots[r.Index]
            : null,
        TargetKind.Leader => Players[r.Player].Leader,
        _ => null,
    };

    /// <summary>Whoever the game is waiting on, which is not always the active player.</summary>
    public int CurrentActor
    {
        get
        {
            if (Pending is not null) return Pending.Player;
            // Deferred decisions settle before flips, flips before refilling the hole.
            if (ChoiceQueue.Count > 0) return ChoiceQueue[0].Player;
            if (FlipQueue.Count > 0) return FlipQueue[0].Player;
            if (ReplaceQueue.Count > 0) return ReplaceQueue[0].Player;
            return Active;
        }
    }

    public TargetRef? BattleAttacker => Battle?.Attacker;
    public TargetRef? BattleDefender => Battle?.Defender;

    public static int StrengthOf(SummonInstance s, CardDef def)
    {
        int b = s.Override?.Strength ?? def.Strength;
        foreach (var m in s.StrengthMods) b += m.Amount;
        return Math.Max(0, b);
    }

    public static Color ColorOf(SummonInstance s, CardDef def) => s.Override?.Color ?? def.Color;

    /// <summary>Level 1-3, the debt a summon is worth when it dies.</summary>
    public static int LevelOf(SummonInstance s, CardDef def) => s.Override?.Level ?? def.Level;

    /// <summary>
    /// A card played as something else keeps no printed powers. Borrowed Powers do
    /// not appear here: Graft and Living Curse mint a card carrying them, so the
    /// body's own printed list is always the whole truth.
    /// </summary>
    public static Power[] PowersOf(SummonInstance s, CardDef def) =>
        s.Override is null ? def.Powers ?? Array.Empty<Power>() : Array.Empty<Power>();
}
