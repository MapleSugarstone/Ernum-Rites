using System.Text;
using System.Text.Json;

namespace Selatza;

/// <summary>
/// A flat dump of every card definition, written by the C# engine and compared
/// against the TypeScript engine's own dump. Card data is the part of a full
/// port most likely to drift quietly, so it gets checked field by field rather
/// than only through gameplay.
/// </summary>
public static class Manifest
{
    public static string Build()
    {
        var cards = Registry.All
            .Where(c => c.Art is not null)
            .OrderBy(c => c.Id, StringComparer.Ordinal)
            .ToList();

        var sb = new StringBuilder();
        sb.Append("[\n");
        for (int i = 0; i < cards.Count; i++)
        {
            sb.Append("  ").Append(Entry(cards[i]));
            sb.Append(i == cards.Count - 1 ? "\n" : ",\n");
        }
        sb.Append("]\n");
        return sb.ToString();
    }

    private static string Entry(CardDef c)
    {
        var powers = (c.Powers ?? Array.Empty<Power>())
            .Select(p => $"{{\"name\":{J(p.Name)},\"cost\":{J(p.Cost.ToString())},\"once\":{L(p.OncePerTurn)},\"sap\":{L(p.SapSelf)},\"targets\":{(p.Targets?.Length ?? 0)}}}");
        var factions = (c.Factions ?? Array.Empty<Faction>())
            .Select(f => J(f.ToString()));
        var identity = c.Identity is null
            ? "null"
            : "[" + string.Join(",", c.Identity.Select(x => J(Colors.Letter(x)))) + "]";
        return "{"
            + $"\"id\":{J(c.Id)},"
            + $"\"name\":{J(c.Name)},"
            + $"\"type\":{J(c.Type.ToString().ToLowerInvariant())},"
            + $"\"starter\":{(c.Starter ? "true" : "false")},"
            + $"\"color\":{J(Colors.Letter(c.Color))},"
            + $"\"neutral\":{(c.Neutral ? "true" : "false")},"
            + $"\"color2\":{(c.Color2 is null ? "null" : J(Colors.Letter(c.Color2.Value)))},"
            + $"\"color3\":{(c.Color3 is null ? "null" : J(Colors.Letter(c.Color3.Value)))},"
            + $"\"level\":{c.Level},"
            + $"\"strength\":{c.Strength},"
            + $"\"hp\":{c.Hp},"
            + $"\"rarity\":{J(c.Rarity.ToString())},"
            + $"\"cost\":{J(c.Cost.ToString())},"
            + $"\"factions\":[{string.Join(",", factions)}],"
            + $"\"identity\":{identity},"
            + $"\"art\":{J(c.Art ?? "")},"
            + $"\"text\":{J(c.Text ?? "")},"
            + $"\"flipText\":{J(c.FlipText ?? "")},"
            + $"\"targets\":{(c.Targets?.Length ?? 0)},"
            + $"\"powers\":[{string.Join(",", powers)}],"
            + $"\"flip\":{L(c.Flip is not null)},"
            + $"\"flipCost\":{J(CostString(c.FlipCost))},"
            + $"\"triggers\":{J(TriggerList(c))},"
            + $"\"stage\":{J(StageList(c))}"
            + "}";
    }

    private static string TriggerList(CardDef c)
    {
        var t = c.Triggers;
        if (t is null) return "";
        var names = new List<string>();
        if (t.OnEnter is not null) names.Add("enter");
        if (t.OnDeath is not null) names.Add("death");
        if (t.OnAttack is not null) names.Add("attack");
        if (t.OnDefend is not null) names.Add("defend");
        if (t.OnAwake is not null) names.Add("awake");
        if (t.OnOtherDeath is not null) names.Add("otherdeath");
        if (t.OnSpellCast is not null) names.Add("spellcast");
        if (t.OnSummonPlayed is not null) names.Add("played");
        if (t.StrengthBonus is not null) names.Add("strength");
        return string.Join("+", names);
    }

    private static string StageList(CardDef c)
    {
        var h = c.StageHooks;
        if (h is null) return "";
        var names = new List<string>();
        if (h.OnAwake is not null) names.Add("awake");
        if (h.StrengthBonus is not null) names.Add("strength");
        return string.Join("+", names);
    }

    private static string CostString(FlipCost? f) =>
        f is null ? "" : $"{f.Mana}|{f.Mill}|{f.Discard}";

    private static string J(string s) => JsonSerializer.Serialize(s);
    private static string L(bool b) => b ? "true" : "false";
}
