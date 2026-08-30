using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Selatza;

public sealed class ReplayDeck
{
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("leaderId")] public string LeaderId { get; set; } = "";
    [JsonPropertyName("cards")] public List<string> Cards { get; set; } = new();
}

public sealed class ReplayStep
{
    [JsonPropertyName("actor")] public int Actor { get; set; }
    [JsonPropertyName("action")] public JsonElement Action { get; set; }
    /// <summary>Digest of the state after this action, for pinpointing divergence.</summary>
    [JsonPropertyName("digest")] public string Digest { get; set; } = "";
}

public sealed class Replay
{
    [JsonPropertyName("format")] public int Format { get; set; } = 1;
    [JsonPropertyName("label")] public string Label { get; set; } = "";
    [JsonPropertyName("seed")] public int Seed { get; set; }
    [JsonPropertyName("startingPlayer")] public int StartingPlayer { get; set; }
    [JsonPropertyName("decks")] public List<ReplayDeck> Decks { get; set; } = new();
    [JsonPropertyName("setupDigest")] public string SetupDigest { get; set; } = "";
    [JsonPropertyName("steps")] public List<ReplayStep> Steps { get; set; } = new();
    [JsonPropertyName("finalDigest")] public string FinalDigest { get; set; } = "";
    [JsonPropertyName("winner")] public int Winner { get; set; } = -1;
    [JsonPropertyName("winReason")] public string? WinReason { get; set; }

    public static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented = false,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    public static Replay Load(string path) =>
        JsonSerializer.Deserialize<Replay>(File.ReadAllText(path), JsonOpts)
        ?? throw new InvalidDataException($"could not parse replay {path}");

    public void Save(string path) =>
        File.WriteAllText(path, JsonSerializer.Serialize(this, JsonOpts));
}

public readonly record struct ReplayResult(bool Ok, int StepIndex, string? Detail)
{
    public static ReplayResult Good => new(true, -1, null);
}

/// <summary>
/// Replays are the contract between the two engines and between versions of one
/// engine. A replay stores only a seed, the deck lists and the actions taken, so
/// re-running it rebuilds the whole game; the stored digests say where any
/// divergence started rather than just that one happened.
/// </summary>
public static class Replays
{
    public static GameAction ParseAction(JsonElement e)
    {
        var type = e.GetProperty("type").GetString() ?? "";
        var kind = ParseType(type);
        bool hasHand = e.TryGetProperty("handIndex", out _);
        var a = new GameAction { Type = kind };
        return a with
        {
            HandIndex = kind == ActionType.PayFlip && !hasHand ? -1 : GetInt(e, "handIndex"),
            Index = GetInt(e, "index"),
            Slot = GetInt(e, "slot"),
            PowerIndex = GetInt(e, "powerIndex"),
            Source = GetRef(e, "source") ?? default,
            Target = GetRef(e, "target") ?? default,
            Targets = GetRefs(e, "targets"),
            Pick = kind == ActionType.ResolveChoice ? GetRef(e, "target") : null,
            ChoiceIndex = kind == ActionType.ResolveChoice && e.TryGetProperty("index", out var ciEl)
                && ciEl.ValueKind == System.Text.Json.JsonValueKind.Number
                ? ciEl.GetInt32()
                : null,
        };
    }

    public static string ActionToJson(GameAction a)
    {
        var sb = new StringBuilder();
        sb.Append("{\"type\":\"").Append(TypeName(a.Type)).Append('"');
        switch (a.Type)
        {
            case ActionType.PlaySupporter:
                sb.Append(",\"handIndex\":").Append(a.HandIndex);
                break;
            case ActionType.ReplaceSummon:
                sb.Append(",\"handIndex\":").Append(a.HandIndex)
                  .Append(",\"targets\":").Append(RefsToJson(a.Targets));
                break;
            case ActionType.SapSupporter:
                sb.Append(",\"index\":").Append(a.Index);
                break;
            case ActionType.PlaySummon:
                sb.Append(",\"handIndex\":").Append(a.HandIndex).Append(",\"slot\":").Append(a.Slot)
                  .Append(",\"targets\":").Append(RefsToJson(a.Targets));
                break;
            case ActionType.PlayStage:
                sb.Append(",\"handIndex\":").Append(a.HandIndex);
                break;
            case ActionType.PayFlip:
                if (a.HandIndex >= 0) sb.Append(",\"handIndex\":").Append(a.HandIndex);
                break;
            case ActionType.CastSpell:
            case ActionType.CastTrap:
                sb.Append(",\"handIndex\":").Append(a.HandIndex)
                  .Append(",\"targets\":").Append(RefsToJson(a.Targets));
                break;
            case ActionType.ActivatePower:
                sb.Append(",\"source\":").Append(RefToJson(a.Source))
                  .Append(",\"powerIndex\":").Append(a.PowerIndex)
                  .Append(",\"targets\":").Append(RefsToJson(a.Targets));
                break;
            case ActionType.DeclareAttack:
                sb.Append(",\"source\":").Append(RefToJson(a.Source))
                  .Append(",\"target\":").Append(RefToJson(a.Target));
                break;
            case ActionType.ResolveChoice:
                if (a.Pick is { } pick) sb.Append(",\"target\":").Append(RefToJson(pick));
                if (a.ChoiceIndex is { } ci) sb.Append(",\"index\":").Append(ci);
                break;
        }
        sb.Append('}');
        return sb.ToString();
    }

    public static string RefToJson(TargetRef r) =>
        $"{{\"kind\":\"{KindName(r.Kind)}\",\"player\":{r.Player},\"index\":{r.Index}}}";

    public static string RefsToJson(TargetRef[] refs) =>
        "[" + string.Join(",", refs.Select(RefToJson)) + "]";

    /// <summary>Re-runs a replay and reports the first step that does not match.</summary>
    public static ReplayResult Verify(Replay replay)
    {
        var decks = replay.Decks;
        if (decks.Count != 2) return new ReplayResult(false, -1, "replay needs exactly two decks");
        var state = Engine.CreateGame(
            new DeckList { Name = decks[0].Name, LeaderId = decks[0].LeaderId, Cards = decks[0].Cards },
            new DeckList { Name = decks[1].Name, LeaderId = decks[1].LeaderId, Cards = decks[1].Cards },
            replay.Seed,
            replay.StartingPlayer);

        if (replay.SetupDigest.Length > 0)
        {
            var got = Digest.Short(state);
            if (got != replay.SetupDigest)
            {
                return new ReplayResult(false, -1, $"setup digest {got} != {replay.SetupDigest}");
            }
        }

        for (int i = 0; i < replay.Steps.Count; i++)
        {
            var step = replay.Steps[i];
            var action = ParseAction(step.Action);
            var res = Engine.Apply(state, step.Actor, action);
            if (!res.Ok) return new ReplayResult(false, i, $"{action.Type} rejected: {res.Error}");
            state = res.State!;
            if (step.Digest.Length > 0)
            {
                var got = Digest.Short(state);
                if (got != step.Digest)
                {
                    return new ReplayResult(false, i,
                        $"after {action.Type}: digest {got} != {step.Digest}");
                }
            }
        }

        if (replay.FinalDigest.Length > 0)
        {
            var got = Digest.Short(state);
            if (got != replay.FinalDigest)
            {
                return new ReplayResult(false, replay.Steps.Count,
                    $"final digest {got} != {replay.FinalDigest}");
            }
        }
        if (replay.Winner != state.Winner)
        {
            return new ReplayResult(false, replay.Steps.Count,
                $"winner {state.Winner} != {replay.Winner}");
        }
        return ReplayResult.Good;
    }

    private static int GetInt(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt32() : 0;

    private static TargetRef? GetRef(JsonElement e, string name)
    {
        if (!e.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.Object) return null;
        return ParseRef(v);
    }

    private static TargetRef[] GetRefs(JsonElement e, string name)
    {
        if (!e.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<TargetRef>();
        }
        var list = new List<TargetRef>();
        foreach (var item in v.EnumerateArray()) list.Add(ParseRef(item));
        return list.ToArray();
    }

    private static TargetRef ParseRef(JsonElement v)
    {
        var kind = v.GetProperty("kind").GetString() ?? "summon";
        int player = v.TryGetProperty("player", out var p) ? p.GetInt32() : 0;
        int index = v.TryGetProperty("index", out var i) ? i.GetInt32() :
            v.TryGetProperty("slot", out var s) ? s.GetInt32() : 0;
        return new TargetRef(ParseKind(kind), player, index);
    }

    public static TargetKind ParseKind(string k) => k switch
    {
        "summon" => TargetKind.Summon,
        "leader" => TargetKind.Leader,
        "hand" => TargetKind.Hand,
        "supporter" => TargetKind.Supporter,
        "debt" => TargetKind.Debt,
        "discard" => TargetKind.Discard,
        _ => TargetKind.ColorPick,
    };

    public static string KindName(TargetKind k) => k switch
    {
        TargetKind.Summon => "summon",
        TargetKind.Leader => "leader",
        TargetKind.Hand => "hand",
        TargetKind.Supporter => "supporter",
        TargetKind.Debt => "debt",
        TargetKind.Discard => "discard",
        _ => "color",
    };

    public static ActionType ParseType(string t) => t switch
    {
        "PLAY_SUPPORTER" => ActionType.PlaySupporter,
        "SAP_SUPPORTER" => ActionType.SapSupporter,
        "PLAY_SUMMON" => ActionType.PlaySummon,
        "CAST_SPELL" => ActionType.CastSpell,
        "PLAY_STAGE" => ActionType.PlayStage,
        "ACTIVATE_POWER" => ActionType.ActivatePower,
        "DECLARE_ATTACK" => ActionType.DeclareAttack,
        "CAST_TRAP" => ActionType.CastTrap,
        "PASS_RESPONSE" => ActionType.PassResponse,
        "RESOLVE_CHOICE" => ActionType.ResolveChoice,
        "REPLACE_SUMMON" => ActionType.ReplaceSummon,
        "DECLINE_REPLACE" => ActionType.DeclineReplace,
        "PAY_FLIP" => ActionType.PayFlip,
        "DECLINE_FLIP" => ActionType.DeclineFlip,
        "END_TURN" => ActionType.EndTurn,
        "CONCEDE" => ActionType.Concede,
        _ => throw new InvalidDataException($"unknown action type {t}"),
    };

    public static string TypeName(ActionType t) => t switch
    {
        ActionType.PlaySupporter => "PLAY_SUPPORTER",
        ActionType.SapSupporter => "SAP_SUPPORTER",
        ActionType.PlaySummon => "PLAY_SUMMON",
        ActionType.CastSpell => "CAST_SPELL",
        ActionType.PlayStage => "PLAY_STAGE",
        ActionType.ActivatePower => "ACTIVATE_POWER",
        ActionType.DeclareAttack => "DECLARE_ATTACK",
        ActionType.CastTrap => "CAST_TRAP",
        ActionType.PassResponse => "PASS_RESPONSE",
        ActionType.ResolveChoice => "RESOLVE_CHOICE",
        ActionType.ReplaceSummon => "REPLACE_SUMMON",
        ActionType.DeclineReplace => "DECLINE_REPLACE",
        ActionType.PayFlip => "PAY_FLIP",
        ActionType.DeclineFlip => "DECLINE_FLIP",
        ActionType.EndTurn => "END_TURN",
        _ => "CONCEDE",
    };
}
