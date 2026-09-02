using System.Text;

namespace Selatza;

/// <summary>
/// A canonical, language-independent fingerprint of a game position.
///
/// The exact string format is part of the cross-engine contract: the TypeScript
/// engine builds the identical string in src/engine/digest.ts, so any rules
/// divergence shows up as a mismatched digest on the step where it happened.
/// Log text and uids are excluded deliberately: wording is cosmetic, and uid
/// allocation order is not observable in play.
/// </summary>
public static class Digest
{
    public const string Format = "v3";

    public static string Of(GameState s)
    {
        var sb = new StringBuilder(1024);
        sb.Append(Format);
        sb.Append("|T").Append(s.Turn);
        sb.Append("|A").Append(s.Active);
        sb.Append("|S").Append(s.StartingPlayer);
        sb.Append("|P").Append(PhaseName(s.Phase));
        sb.Append("|W").Append(s.Winner);
        sb.Append("|D").Append(s.Drawn ? 1 : 0);
        sb.Append("|A").Append(s.Actions);
        sb.Append("|R").Append(s.RngState);
        for (int i = 0; i < 2; i++) AppendPlayer(sb, s.Players[i], i);
        sb.Append("|PEND:");
        if (s.Pending is null) sb.Append('-');
        else if (s.Pending.Battle is not null)
        {
            sb.Append(s.Pending.Player).Append(':')
              .Append(Ref(s.Pending.Battle.Attacker)).Append(':')
              .Append(Ref(s.Pending.Battle.Defender)).Append(':')
              .Append(s.Pending.Battle.TrapUsed ? '1' : '0');
        }
        else if (s.Pending.Spell is not null)
        {
            sb.Append(s.Pending.Player).Append(":S:")
              .Append(s.Pending.Spell.Caster).Append(':')
              .Append(s.Pending.Spell.CardId).Append(':');
            for (int i = 0; i < s.Pending.Spell.Targets.Length; i++)
            {
                if (i > 0) sb.Append(';');
                sb.Append(Ref(s.Pending.Spell.Targets[i]));
            }
        }
        sb.Append("|RQ:");
        if (s.ReplaceQueue.Count == 0) sb.Append('-');
        else
        {
            for (int i = 0; i < s.ReplaceQueue.Count; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append(s.ReplaceQueue[i].Player).Append('/').Append(s.ReplaceQueue[i].Slot);
            }
        }
        sb.Append("|FQ:");
        if (s.FlipQueue.Count == 0) sb.Append('-');
        else
        {
            for (int i = 0; i < s.FlipQueue.Count; i++)
            {
                if (i > 0) sb.Append(',');
                // The damage the offer is holding up is part of the position:
                // two otherwise identical boards owing different remainders play
                // out differently. The nesting depth beside it is not, the same
                // way an instance uid is not.
                sb.Append(s.FlipQueue[i].Player).Append('/')
                  .Append(Ref(s.FlipQueue[i].Holder)).Append('/')
                  .Append(s.FlipQueue[i].CardId).Append('/')
                  .Append(s.FlipQueue[i].Pending);
            }
        }
        sb.Append("|CQ:");
        if (s.ChoiceQueue.Count == 0) sb.Append('-');
        else
        {
            for (int i = 0; i < s.ChoiceQueue.Count; i++)
            {
                if (i > 0) sb.Append(',');
                var c = s.ChoiceQueue[i];
                sb.Append(c.Player).Append('/').Append(c.Source).Append('/').Append(c.Effect).Append('/');
                if (c.Refs is not null)
                {
                    for (int j = 0; j < c.Refs.Length; j++)
                    {
                        if (j > 0) sb.Append(';');
                        sb.Append(Ref(c.Refs[j]));
                    }
                }
                sb.Append('/');
                if (c.Cards is not null) sb.Append(string.Join(';', c.Cards));
                sb.Append('/');
                if (c.Legal is not null) sb.Append(string.Join(";", c.Legal));
                sb.Append('/').Append(c.Optional ? 1 : 0).Append('/');
                if (c.At is { } at) sb.Append(Ref(at));
                else sb.Append('-');
            }
        }

        sb.Append("|BT:");
        if (s.Battle is null) sb.Append('-');
        else
        {
            sb.Append(Ref(s.Battle.Attacker)).Append(':')
              .Append(Ref(s.Battle.Defender)).Append(':')
              .Append(s.Battle.TrapUsed ? '1' : '0');
        }
        return sb.ToString();
    }

    /// <summary>Short hex fingerprint, for compact replay files.</summary>
    public static string Short(GameState s) => Hash(Of(s));

    public static string Hash(string text)
    {
        // FNV-1a 64, chosen because it is trivial to reimplement identically in JS.
        ulong h = 14695981039346656037UL;
        foreach (char ch in text)
        {
            h ^= ch;
            h *= 1099511628211UL;
        }
        return h.ToString("x16");
    }

    private static void AppendPlayer(StringBuilder sb, PlayerState p, int idx)
    {
        sb.Append("|p").Append(idx);
        sb.Append(":D").Append(Join(p.Deck));
        sb.Append(":H").Append(Join(p.Hand));
        sb.Append(":Z").Append(Join(p.DebtZone));
        sb.Append(":X").Append(Join(p.Discard));
        sb.Append(":C").Append(p.DebtCount);
        sb.Append(":U");
        if (p.Supporters.Count == 0) sb.Append('-');
        else
        {
            for (int i = 0; i < p.Supporters.Count; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append(p.Supporters[i].CardId).Append('/').Append(p.Supporters[i].Sapped ? '1' : '0');
            }
        }
        sb.Append(":M");
        for (int i = 0; i < Rules.ManaKinds; i++)
        {
            if (i > 0) sb.Append(',');
            sb.Append(p.Mana[i]);
        }
        sb.Append(":F").Append(p.SupportersLeft).Append('.')
          .Append(p.LeaderPlayed ? '1' : '0');
        sb.Append(":N").Append(p.TurnsTaken);
        sb.Append(":O").Append(p.DeckOuts);
        sb.Append(":L").Append(p.ReplaceLocked);
        sb.Append(":T").Append(p.SpellTax);
        sb.Append(":G").Append(p.Stage ?? "-");
        for (int i = 0; i < p.Slots.Length; i++)
        {
            sb.Append(":s").Append(i).Append('=').Append(Summon(p.Slots[i]));
        }
        sb.Append(":h=").Append(Summon(p.Leader));
    }

    private static string Join(List<string> ids) => ids.Count == 0 ? "-" : string.Join(",", ids);

    private static string Ref(TargetRef r) =>
        $"{KindName(r.Kind)}/{r.Player}/{r.Index}";

    private static string KindName(TargetKind k) => k switch
    {
        TargetKind.Summon => "summon",
        TargetKind.Leader => "leader",
        TargetKind.Hand => "hand",
        TargetKind.Supporter => "supporter",
        TargetKind.Debt => "debt",
        TargetKind.Discard => "discard",
        _ => "color",
    };

    private static string PhaseName(Phase p) => p switch
    {
        Phase.Awake => "awake",
        Phase.Draw => "draw",
        Phase.Main => "main",
        _ => "end",
    };

    private static string Summon(SummonInstance? s)
    {
        if (s is null) return "-";
        var sb = new StringBuilder();
        sb.Append(s.CardId).Append('~');
        for (int i = 0; i < s.Hp.Count; i++)
        {
            if (i > 0) sb.Append(';');
            sb.Append(s.Hp[i].CardId).Append(s.Hp[i].Flipped ? "!1" : "!0");
        }
        if (s.Hp.Count == 0) sb.Append('-');
        sb.Append('~').Append(s.Sapped ? '1' : '0');
        sb.Append('~').Append(s.Wounds);
        sb.Append('~').Append(s.Shields);
        sb.Append('~');
        if (s.StrengthMods.Count == 0) sb.Append('-');
        else
        {
            for (int i = 0; i < s.StrengthMods.Count; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append(s.StrengthMods[i].Amount).Append('/')
                  .Append(s.StrengthMods[i].Duration == ModDuration.Turn ? "turn" : "perm");
            }
        }
        sb.Append('~');
        if (s.Override is null) sb.Append('-');
        else
        {
            sb.Append(s.Override.Strength).Append('/')
              .Append(Colors.Letter(s.Override.Color)).Append('/')
              .Append(s.Override.Level);
        }
        sb.Append('~').Append(s.Rooted ? '1' : '0');
        sb.Append('~').Append(s.SapLock ? '1' : '0');
        sb.Append('~').Append(s.Bestowed ?? "-");
        sb.Append('~').Append(s.EnteredTurn);
        sb.Append('~').Append(s.IsLeader ? '1' : '0');
        sb.Append('~').Append(s.Owner);
        sb.Append('~').Append(s.EffectDamageMod);
        return sb.ToString();
    }
}
