using System.Text;
using System.Text.Json;
using Selatza.Ai;
using Selatza.Cards;

namespace Selatza;

/// <summary>
/// Finds the shared replay corpus. It lives at the repository root rather than
/// inside either language's tree, because both engines read and write it.
/// </summary>
public static class Corpus
{
    public const string FolderName = "replays";

    public const string ConformanceFolder = "conformance";

    /// <summary>Where the card manifest both engines compare against lives.</summary>
    public static string? ConformanceDirectory(bool create = false)
    {
        var root = RepoRoot();
        if (root is null) return null;
        var dir = Path.Combine(root, ConformanceFolder);
        if (!System.IO.Directory.Exists(dir))
        {
            if (!create) return null;
            System.IO.Directory.CreateDirectory(dir);
        }
        return dir;
    }

    private static string? RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "package.json"))) return dir.FullName;
            dir = dir.Parent;
        }
        return null;
    }

    public static string? Directory(bool create = false)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(dir.FullName, FolderName);
            if (System.IO.Directory.Exists(candidate)) return candidate;
            // The repo root is the folder holding both the C# tree and package.json.
            if (File.Exists(Path.Combine(dir.FullName, "package.json")))
            {
                if (!create) return null;
                System.IO.Directory.CreateDirectory(candidate);
                return candidate;
            }
            dir = dir.Parent;
        }
        return null;
    }
}

/// <summary>
/// Turns a played game into a replay. Every step carries the digest of the state
/// it produced, so a mismatch names the action that diverged instead of only
/// saying the final position differs.
/// </summary>
public static class Recorder
{
    public static Replay RecordBotGame(StarterDeck a, StarterDeck b, int seed, string label,
        int startingPlayer = 0, int maxActions = 6000, int maxTurns = 300)
    {
        var da = a.ToDeckList($"{a.Name} (P1)");
        var db = b.ToDeckList($"{b.Name} (P2)");
        return RecordBotGame(da, db, seed, label, startingPlayer, maxActions, maxTurns);
    }

    public static Replay RecordBotGame(DeckList a, DeckList b, int seed, string label,
        int startingPlayer = 0, int maxActions = 6000, int maxTurns = 300)
    {
        var state = Engine.CreateGame(a, b, seed, startingPlayer);
        var replay = new Replay
        {
            Label = label,
            Seed = seed,
            StartingPlayer = startingPlayer,
            SetupDigest = Digest.Short(state),
            Decks =
            {
                new ReplayDeck { Name = a.Name, LeaderId = a.LeaderId, Cards = a.Cards.ToList() },
                new ReplayDeck { Name = b.Name, LeaderId = b.LeaderId, Cards = b.Cards.ToList() },
            },
        };

        int actions = 0;
        // IsOver, not Winner: a drawn game leaves Winner at -1, and recording
        // past the draw would ask the engine for a move it refuses to apply.
        while (!state.IsOver && actions < maxActions && state.Turn < maxTurns)
        {
            int actor = state.CurrentActor;
            var action = Bot.ChooseAction(state, actor);
            var res = Engine.Apply(state, actor, action);
            if (!res.Ok) throw new InvalidOperationException($"bot produced an illegal action: {res.Error}");
            state = res.State!;
            actions++;
            replay.Steps.Add(new ReplayStep
            {
                Actor = actor,
                Action = JsonDocument.Parse(Replays.ActionToJson(action)).RootElement.Clone(),
                Digest = Digest.Short(state),
            });
        }

        replay.FinalDigest = Digest.Short(state);
        replay.Winner = state.Winner;
        replay.WinReason = state.WinReason;
        return replay;
    }

    /// <summary>Writes the replay as JSON with the field order both engines expect.</summary>
    public static string ToJson(Replay r)
    {
        var sb = new StringBuilder();
        sb.Append("{\n");
        sb.Append("  \"format\": ").Append(r.Format).Append(",\n");
        sb.Append("  \"label\": ").Append(JsonSerializer.Serialize(r.Label)).Append(",\n");
        sb.Append("  \"seed\": ").Append(r.Seed).Append(",\n");
        sb.Append("  \"startingPlayer\": ").Append(r.StartingPlayer).Append(",\n");
        sb.Append("  \"decks\": [\n");
        for (int i = 0; i < r.Decks.Count; i++)
        {
            var d = r.Decks[i];
            sb.Append("    {\"name\": ").Append(JsonSerializer.Serialize(d.Name))
              .Append(", \"leaderId\": ").Append(JsonSerializer.Serialize(d.LeaderId))
              .Append(", \"cards\": ").Append(JsonSerializer.Serialize(d.Cards))
              .Append('}');
            sb.Append(i == r.Decks.Count - 1 ? "\n" : ",\n");
        }
        sb.Append("  ],\n");
        sb.Append("  \"setupDigest\": ").Append(JsonSerializer.Serialize(r.SetupDigest)).Append(",\n");
        sb.Append("  \"steps\": [\n");
        for (int i = 0; i < r.Steps.Count; i++)
        {
            var s = r.Steps[i];
            sb.Append("    {\"actor\": ").Append(s.Actor)
              .Append(", \"action\": ").Append(s.Action.GetRawText())
              .Append(", \"digest\": ").Append(JsonSerializer.Serialize(s.Digest))
              .Append('}');
            sb.Append(i == r.Steps.Count - 1 ? "\n" : ",\n");
        }
        sb.Append("  ],\n");
        sb.Append("  \"finalDigest\": ").Append(JsonSerializer.Serialize(r.FinalDigest)).Append(",\n");
        sb.Append("  \"winner\": ").Append(r.Winner).Append(",\n");
        sb.Append("  \"winReason\": ").Append(JsonSerializer.Serialize(r.WinReason)).Append('\n');
        sb.Append("}\n");
        return sb.ToString();
    }
}
