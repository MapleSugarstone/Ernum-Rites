namespace Selatza;

/// <summary>
/// A decision an effect could not make on its own: pick a target on the board,
/// or pick from a row of revealed cards. Plain data so it digests, clones and
/// replays; the effect's remaining work lives in a resolver both engines
/// register under the same key.
/// </summary>
public sealed class PendingChoice
{
    public required int Player { get; init; }
    /// <summary>Card whose effect is waiting, for the prompt.</summary>
    public required string Source { get; init; }
    /// <summary>Resolver key, registered by the card set.</summary>
    public required string Effect { get; init; }
    public required string Prompt { get; init; }
    /// <summary>Board mode: pick one of these.</summary>
    public TargetRef[]? Refs { get; init; }
    /// <summary>Reveal mode: these cards are face up, held out of every zone.</summary>
    public string[]? Cards { get; init; }
    /// <summary>Indices into Cards that may be picked.</summary>
    public int[]? Legal { get; init; }
    /// <summary>May resolve with no pick at all.</summary>
    public bool Optional { get; init; }
    /// <summary>A ref the resolver needs beyond the pick, e.g. the body being changed.</summary>
    public TargetRef? At { get; init; }

    public PendingChoice Clone() => new()
    {
        Player = Player,
        Source = Source,
        Effect = Effect,
        Prompt = Prompt,
        Refs = Refs is null ? null : (TargetRef[])Refs.Clone(),
        Cards = Cards is null ? null : (string[])Cards.Clone(),
        Legal = Legal is null ? null : (int[])Legal.Clone(),
        Optional = Optional,
        At = At,
    };
}

public readonly record struct ChoicePick(TargetRef? Ref = null, int? Index = null);

/// <summary>
/// Resolver registry: what actually happens once the player picks. Cards
/// register these at load time under stable keys, mirrored name for name in
/// the TypeScript engine.
/// </summary>
public static class Choices
{
    private static readonly Dictionary<string, Action<GameState, PendingChoice, ChoicePick>> Resolvers = new();
    private static readonly object Gate = new();

    public static void Register(string key, Action<GameState, PendingChoice, ChoicePick> fn)
    {
        lock (Gate) Resolvers[key] = fn;
    }

    public static void Run(GameState state, PendingChoice choice, ChoicePick pick)
    {
        Action<GameState, PendingChoice, ChoicePick>? fn;
        lock (Gate) Resolvers.TryGetValue(choice.Effect, out fn);
        if (fn is null) throw new InvalidOperationException($"no choice resolver registered for {choice.Effect}");
        fn(state, choice, pick);
    }
}
