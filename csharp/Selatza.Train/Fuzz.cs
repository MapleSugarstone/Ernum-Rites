using Selatza;
using Selatza.Ai;
using Selatza.Cards;

namespace Selatza.Train;

/// <summary>
/// Random games over the whole card pool, checking invariants after every action.
///
/// Decks are built from every collectible card and led by the all-colour test
/// warden, so cards that could never legally meet in a real deck meet here. That
/// is the point: the bugs worth finding are the ones nobody thought to look for.
///
///   npm run fuzz -- --games 400 --seed 1
///   npm run fuzz -- --games 400 --random    pick actions at random, not by bot
/// </summary>
public static class Fuzz
{
    private const int ActionCap = 3000;
    private const int TurnCap = 120;
    private const int QueueCap = 64;
    private const string Warden = "x-hero-dummy-warden";

    private sealed record Fault(int Seed, int Turn, string Kind, string Detail);

    public static int Run(string[] args)
    {
        int games = ArgInt(args, "--games", 400);
        int seed0 = ArgInt(args, "--seed", 1);
        bool random = Array.IndexOf(args, "--random") >= 0;
        string outDir = Arg(args, "--out", Path.Combine("runs", "fuzz"));

        CardSets.RegisterAll();
        var pool = Registry.All
            .Where(c => !c.Uncollectible && !c.Starter
                && !c.Id.StartsWith("x-", StringComparison.Ordinal) && c.Id != "hidden")
            .Select(c => c.Id)
            .OrderBy(id => id, StringComparer.Ordinal)
            .ToArray();
        if (pool.Length == 0)
        {
            Console.Error.WriteLine("no collectible cards found");
            return 1;
        }

        var faults = new List<Fault>();
        var outcomes = new Dictionary<string, int>(StringComparer.Ordinal);
        long played = 0, rejected = 0, totalActions = 0, longest = 0;

        for (int g = 0; g < games; g++)
        {
            int seed = seed0 + g;
            var rng = new Rng(unchecked((int)(seed * 2654435761u)));
            var a = RandomDeck(rng, pool, "A");
            var b = RandomDeck(rng, pool, "B");
            var state = Engine.CreateGame(a, b, seed, seed % 2);
            var actionsTaken = new List<(int Actor, GameAction Action)>();
            int actions = 0;

            try
            {
                Check(state, seed, faults);
                while (!state.IsOver && actions < ActionCap && state.Turn < TurnCap)
                {
                    int actor = state.CurrentActor;
                    var action = Bot.ChooseAction(state, actor);

                    if (random)
                    {
                        // Take the first candidate the engine actually accepts. One
                        // it refuses is worth counting: the generator and the
                        // validator are supposed to agree on what is legal.
                        var legal = Bot.CandidateActions(state, actor);
                        for (int i = legal.Count - 1; i > 0; i--)
                        {
                            int j = rng.NextInt(i + 1);
                            (legal[i], legal[j]) = (legal[j], legal[i]);
                        }
                        foreach (var cand in legal)
                        {
                            var trial = Engine.Apply(state, actor, cand);
                            if (trial.Ok) { action = cand; break; }
                            rejected++;
                            Note(faults, seed, state.Turn, "bot offered an illegal action",
                                $"{cand.Type}: {trial.Error}");
                        }
                    }

                    var res = Engine.Apply(state, actor, action);
                    if (!res.Ok)
                    {
                        Note(faults, seed, state.Turn, "chosen action refused",
                            $"{action.Type}: {res.Error}");
                        break;
                    }
                    actionsTaken.Add((actor, action));
                    state = res.State!;
                    actions++;
                    Check(state, seed, faults);
                }
            }
            catch (Exception ex)
            {
                Note(faults, seed, state.Turn, "threw", ex.Message);
                Dump(outDir, $"crash-{seed}.txt", a, b, seed, actionsTaken, ex.ToString());
                continue;
            }

            if (!state.IsOver)
            {
                string why = state.Turn >= TurnCap
                    ? $"no result in {TurnCap} turns" : $"hit {ActionCap} actions";
                Note(faults, seed, state.Turn, "game never ends", why);
                Dump(outDir, $"stall-{seed}.txt", a, b, seed, actionsTaken, why);
            }
            else
            {
                string why = state.WinReason ?? "?";
                outcomes[why] = outcomes.TryGetValue(why, out var n) ? n + 1 : 1;
            }

            // A game that will not replay from its own actions is a determinism
            // bug in itself, which is worth more than any single invariant.
            var check = Engine.CreateGame(a, b, seed, seed % 2);
            bool diverged = false;
            for (int i = 0; i < actionsTaken.Count && !diverged; i++)
            {
                var (actor, action) = actionsTaken[i];
                if (actor != check.CurrentActor)
                {
                    Note(faults, seed, check.Turn, "replay diverged", $"step {i}: actor");
                    diverged = true;
                    break;
                }
                var res = Engine.Apply(check, actor, action);
                if (!res.Ok)
                {
                    Note(faults, seed, check.Turn, "replay diverged", $"step {i}: {res.Error}");
                    diverged = true;
                    break;
                }
                check = res.State!;
            }
            if (!diverged && check.Winner != state.Winner)
            {
                Note(faults, seed, state.Turn, "replay diverged", "different winner");
            }

            played++;
            totalActions += actions;
            longest = Math.Max(longest, state.Turn);
        }

        Console.WriteLine($"{played:N0} games, {totalActions:N0} actions, "
            + $"{(double)totalActions / Math.Max(1, played):F1} per game, longest {longest} turns");
        if (random) Console.WriteLine($"  {rejected:N0} candidate actions the engine refused");
        Console.WriteLine();
        foreach (var kv in outcomes.OrderByDescending(k => k.Value).Take(8))
        {
            Console.WriteLine($"  {kv.Value,7:N0}  {Trim(kv.Key)}");
        }

        if (faults.Count == 0)
        {
            Console.WriteLine("\nno faults");
            return 0;
        }

        Console.WriteLine($"\n{faults.Count:N0} faults, grouped:");
        foreach (var group in faults.GroupBy(f => f.Kind).OrderByDescending(gr => gr.Count()))
        {
            var first = group.First();
            Console.WriteLine($"  {group.Count(),6:N0}  {group.Key}");
            Console.WriteLine($"          first: seed {first.Seed} turn {first.Turn} — {Trim(first.Detail)}");
        }
        return 1;
    }

    /// <summary>Everything that must hold no matter which cards are in play.</summary>
    private static void Check(GameState s, int seed, List<Fault> faults)
    {
        var uids = new HashSet<string>(StringComparer.Ordinal);
        for (int i = 0; i < 2; i++)
        {
            var p = s.Players[i];
            if (p.DebtCount < 0) Note(faults, seed, s.Turn, "negative debt", p.DebtCount.ToString());
            if (p.DebtCount > Rules.DebtLimit + 40)
                Note(faults, seed, s.Turn, "runaway debt", p.DebtCount.ToString());
            if (p.SupportersLeft < 0)
                Note(faults, seed, s.Turn, "negative supporters", p.SupportersLeft.ToString());
            if (p.SpellTax < 0) Note(faults, seed, s.Turn, "negative spell tax", p.SpellTax.ToString());
            for (int m = 0; m < p.Mana.Length; m++)
            {
                if (p.Mana[m] < 0) Note(faults, seed, s.Turn, "negative mana", $"{m}={p.Mana[m]}");
            }

            foreach (var zone in new[] { p.Deck, p.Hand, p.Discard, p.DebtZone })
            {
                foreach (var id in zone)
                {
                    if (Registry.TryCard(id) is null)
                        Note(faults, seed, s.Turn, "unknown card id", id);
                }
            }

            var bodies = new List<SummonInstance?>(p.Slots) { p.Leader };
            foreach (var body in bodies)
            {
                if (body is null) continue;
                if (!uids.Add(body.Uid))
                    Note(faults, seed, s.Turn, "same body in two places", body.Uid);
                if (Registry.TryCard(body.CardId) is null)
                    Note(faults, seed, s.Turn, "unknown summon id", body.CardId);
                if (body.Wounds < 0) Note(faults, seed, s.Turn, "negative wounds", body.CardId);
                if (body.Shields < 0) Note(faults, seed, s.Turn, "negative shields", body.CardId);
                if (body.RemainingHp < 0) Note(faults, seed, s.Turn, "negative hp", body.CardId);
                if (body.Hp.Count > 0 && body.RemainingHp == 0 && s.Winner < 0)
                    Note(faults, seed, s.Turn, "body alive at 0 HP", body.CardId);
                foreach (var h in body.Hp)
                {
                    if (Registry.TryCard(h.CardId) is null)
                        Note(faults, seed, s.Turn, "unknown hp card", h.CardId);
                }
            }

            if (p.Stage is not null && Registry.TryCard(p.Stage) is null)
                Note(faults, seed, s.Turn, "unknown stage", p.Stage);
            foreach (var sup in p.Supporters)
            {
                if (Registry.TryCard(sup.CardId) is null)
                    Note(faults, seed, s.Turn, "unknown supporter", sup.CardId);
            }
        }

        if (s.ChoiceQueue.Count > QueueCap)
            Note(faults, seed, s.Turn, "choice queue runaway", $"{s.ChoiceQueue.Count} deep");
        if (s.FlipQueue.Count > QueueCap)
            Note(faults, seed, s.Turn, "flip queue runaway", $"{s.FlipQueue.Count} deep");
        if (s.ReplaceQueue.Count > QueueCap)
            Note(faults, seed, s.Turn, "replace queue runaway", $"{s.ReplaceQueue.Count} deep");
    }

    private static void Note(List<Fault> faults, int seed, int turn, string kind, string detail)
    {
        // A single broken game can produce the same fault every action; cap it
        // so the report stays readable.
        if (faults.Count > 20000) return;
        faults.Add(new Fault(seed, turn, kind, detail));
    }

    private static DeckList RandomDeck(Rng rng, string[] pool, string name)
    {
        var cards = new List<string>();
        const int deckSize = 48, copyLimit = 2;
        var used = new Dictionary<string, int>(StringComparer.Ordinal);
        while (cards.Count < deckSize)
        {
            string id = pool[rng.NextInt(pool.Length)];
            used.TryGetValue(id, out int have);
            if (have >= copyLimit) continue;
            used[id] = have + 1;
            cards.Add(id);
        }
        return new DeckList { Name = name, LeaderId = Warden, Cards = cards };
    }

    private static void Dump(string dir, string file, DeckList a, DeckList b, int seed,
        List<(int Actor, GameAction Action)> actions, string why)
    {
        Directory.CreateDirectory(dir);
        using var w = new StreamWriter(Path.Combine(dir, file));
        w.WriteLine($"seed {seed}");
        w.WriteLine($"why  {why}");
        w.WriteLine($"A    {string.Join(" ", a.Cards)}");
        w.WriteLine($"B    {string.Join(" ", b.Cards)}");
        foreach (var (actor, action) in actions) w.WriteLine($"  p{actor} {action.Type}");
    }

    private static string Trim(string s) => s.Length <= 110 ? s : s[..110] + "…";

    private static string Arg(string[] a, string name, string fallback)
    {
        int i = Array.IndexOf(a, name);
        return i >= 0 && i + 1 < a.Length ? a[i + 1] : fallback;
    }

    private static int ArgInt(string[] a, string name, int fallback) =>
        int.TryParse(Arg(a, name, ""), out var v) ? v : fallback;
}
