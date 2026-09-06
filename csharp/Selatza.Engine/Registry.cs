using System.Collections.Concurrent;

namespace Selatza;

/// <summary>The one place a card id turns into a definition.</summary>
public static class Registry
{
    // Concurrent because generated cards register mid-game and the trainer
    // plays many games in parallel over this one map.
    private static readonly ConcurrentDictionary<string, CardDef> Map = new(StringComparer.Ordinal);
    private static readonly ConcurrentDictionary<string, byte> Minted = new(StringComparer.Ordinal);

    public static void Register(IEnumerable<CardDef> cards)
    {
        foreach (var c in cards)
        {
            if (!Map.TryAdd(c.Id, c)) throw new InvalidOperationException($"duplicate card id: {c.Id}");
        }
    }

    /// <summary>
    /// Cards the game builds mid-match: fusions, hacked copies, spells given
    /// legs. Ids are deterministic functions of their inputs, so every replay
    /// mints the same card and re-registering an id is a no-op.
    /// </summary>
    public static string RegisterGenerated(CardDef def)
    {
        if (Map.TryAdd(def.Id, def)) Minted[def.Id] = 0;
        return def.Id;
    }

    /// <summary>Swaps a registered card for a changed one. Tooling only: a fake version of the game for measuring a bot.</summary>
    public static void Replace(CardDef def)
    {
        if (!Map.ContainsKey(def.Id)) throw new KeyNotFoundException($"unknown card id: {def.Id}");
        Map[def.Id] = def;
    }

    public static CardDef Card(string id) =>
        Map.TryGetValue(id, out var c) ? c : throw new KeyNotFoundException($"unknown card id: {id}");

    public static CardDef? TryCard(string id) => Map.TryGetValue(id, out var c) ? c : null;

    public static IReadOnlyCollection<CardDef> All => (IReadOnlyCollection<CardDef>)Map.Values;

    /// <summary>The sets as registered at load. A card minted during play is not in it.</summary>
    public static IEnumerable<CardDef> Printed => Map.Values.Where(c => !Minted.ContainsKey(c.Id));

    public static void Reset()
    {
        Map.Clear();
        Minted.Clear();
    }
}
