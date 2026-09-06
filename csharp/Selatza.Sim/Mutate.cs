using System.Reflection;
using System.Text;
using Selatza;
using Selatza.Learn;
using Selatza.Learn.Nn;

namespace Selatza.Sim;

/// <summary>
/// A fake version of the game: the printed set with random changes, so a bot
/// can be measured on cards nobody tuned it for. Stats move, bodies take
/// another card's Powers or triggers, and new cards are minted from a printed
/// body and a donor's text. Applied before the card index builds, so random
/// decks draw from the changed set, and both bots in a head-to-head read it.
/// </summary>
public static class Mutate
{
    public static string Apply(int seed, int stats, int effects, int fresh)
    {
        var rng = new Gauss(seed);
        var pool = Registry.Printed
            .Where(d => !d.Uncollectible && d.Art is not null)
            .OrderBy(d => d.Id, StringComparer.Ordinal)
            .ToList();
        var summons = pool.Where(d => d.Type == CardType.Summon).ToList();
        var donors = pool.Where(d => (d.Powers?.Length ?? 0) > 0 || d.Triggers is not null).ToList();
        var log = new StringBuilder();
        log.AppendLine($"mutated set, seed {seed}: {stats} stat changes, {effects} effect changes, {fresh} new cards");

        for (int i = 0; i < stats; i++)
        {
            var d = Registry.Card(summons[rng.NextInt(summons.Count)].Id);
            var m = d.Copy();
            Set(m, nameof(CardDef.Strength), Math.Max(0, d.Strength + rng.NextInt(5) - 2));
            Set(m, nameof(CardDef.Hp), Math.Max(1, d.Hp + rng.NextInt(5) - 2));
            Registry.Replace(m);
            log.AppendLine($"  {d.Id}: {d.Strength}/{d.Hp} -> {m.Strength}/{m.Hp}");
        }

        for (int i = 0; i < effects; i++)
        {
            var d = Registry.Card(summons[rng.NextInt(summons.Count)].Id);
            var src = donors[rng.NextInt(donors.Count)];
            if (src.Id == d.Id) continue;
            var m = d.Copy();
            bool powers = (src.Powers?.Length ?? 0) > 0 && (src.Triggers is null || rng.NextInt(2) == 0);
            if (powers) Set(m, nameof(CardDef.Powers), src.Powers);
            else Set(m, nameof(CardDef.Triggers), src.Triggers);
            Set(m, nameof(CardDef.Text), src.Text);
            Registry.Replace(m);
            log.AppendLine($"  {d.Id}: takes {src.Id}'s {(powers ? "Powers" : "triggers")}");
        }

        var minted = new List<CardDef>();
        for (int i = 0; i < fresh; i++)
        {
            var baseCard = summons[rng.NextInt(summons.Count)];
            var src = donors[rng.NextInt(donors.Count)];
            var m = baseCard.Copy();
            Set(m, nameof(CardDef.Id), $"mut-{seed}-{i}");
            Set(m, nameof(CardDef.Name), $"Mutant {i}");
            Set(m, nameof(CardDef.Num), "MUT");
            Set(m, nameof(CardDef.Starter), false);
            Set(m, nameof(CardDef.Powers), src.Powers);
            Set(m, nameof(CardDef.Triggers), src.Triggers);
            Set(m, nameof(CardDef.Text), src.Text);
            Set(m, nameof(CardDef.Strength), Math.Max(0, baseCard.Strength + rng.NextInt(3) - 1));
            Set(m, nameof(CardDef.Hp), Math.Max(1, baseCard.Hp + rng.NextInt(3) - 1));
            minted.Add(m);
            log.AppendLine($"  {m.Id}: {baseCard.Id}'s frame and cost, {m.Strength}/{m.Hp}, {src.Id}'s text");
        }
        Registry.Register(minted);
        return log.ToString();
    }

    // Init-only at compile time, which is what keeps printed cards printed; a
    // fake game sets them once, before anything reads them.
    private static void Set(CardDef target, string property, object? value)
    {
        var prop = typeof(CardDef).GetProperty(property, BindingFlags.Public | BindingFlags.Instance)
            ?? throw new ArgumentException($"no card field named {property}");
        prop.SetValue(target, value);
    }
}
