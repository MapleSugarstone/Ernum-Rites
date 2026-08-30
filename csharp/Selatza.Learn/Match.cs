using Selatza.Ai;
using Selatza.Learn.Nn;

namespace Selatza.Learn;

public readonly record struct MatchResult(int Winner, string? Reason, int Turns, int Actions,
    int Decisions = 0, int Recorded = 0, bool FatigueKill = false, bool SawFatigue = false)
{
    public bool Unresolved => Winner < 0;
}

/// <summary>
/// Plays one game between two agents and hands each side's positions to its
/// brain. The intel trackers are fed every applied action, which is where the
/// scouting rolls happen.
/// </summary>
public static class Match
{
    public const int ActionCap = 8000;
    public const int TurnCap = 400;

    public static MatchResult Play(Agent a, Agent b, int seed, int startingPlayer, int slot,
        SampleStore? storeA = null, SampleStore? storeB = null)
    {
        var agents = new[] { a, b };
        var stores = new[] { storeA, storeB };
        var state = Engine.CreateGame(a.ToDeckList($"{a.Name} (P1)"), b.ToDeckList($"{b.Name} (P2)"),
            seed, startingPlayer);

        var intel = new Intel[2];
        var players = new NeuralPlayer?[2];
        for (int i = 0; i < 2; i++)
        {
            intel[i] = new Intel(i, agents[i].Intel, unchecked(seed * 31 + i * 977 + 12345));
            if (agents[i].ReferenceBot || agents[i].Brain is null)
            {
                intel[i].Begin(state);
                continue;
            }
            var net = agents[i].Brain!.Replica(slot);
            players[i] = new NeuralPlayer(net, agents[i].Config);
            players[i]!.StartGame(state, i, intel[i], new Gauss(unchecked(seed * 7 + i * 131 + 5)), stores[i]);
        }

        var played = new List<(int Card, int Turn)>[2] { new(), new() };
        int actions = 0;

        var log = GameLog.ShouldRecord() ? (LogBuf ??= new GameLog.Buf()) : null;
        int logged = 0;
        int snappedTurn = -1;
        if (log is not null)
        {
            GameLog.BeginGame(log, a.Name, b.Name, CardIndex.Of(a.LeaderId), CardIndex.Of(b.LeaderId),
                startingPlayer, seed);
        }

        while (!state.IsOver && actions < ActionCap && state.Turn < TurnCap)
        {
            int actor = state.CurrentActor;
            var action = players[actor] is { } np
                ? np.Choose(state)
                : Bot.ChooseAction(state, actor);

            if (IsPlay(action.Type) && action.HandIndex >= 0
                && action.HandIndex < state.Players[actor].Hand.Count)
            {
                // The turn a card left the hand, kept so its lift can be split
                // into opening, middle and late-game plays.
                played[actor].Add((CardIndex.Of(state.Players[actor].Hand[action.HandIndex]),
                    state.Players[actor].TurnsTaken));
            }

            if (log is not null)
            {
                if (state.Turn != snappedTurn)
                {
                    snappedTurn = state.Turn;
                    GameLog.Snapshot(log, state);
                }
                GameLog.Event(log, state, actor, action);
                logged++;
            }

            var res = Engine.Apply(state, actor, action);
            if (!res.Ok)
            {
                throw new InvalidOperationException(
                    $"illegal action {action.Type} from {agents[actor].Name} on turn {state.Turn}: {res.Error}");
            }
            var next = res.State!;
            intel[0].Observe(state, actor, action, next);
            intel[1].Observe(state, actor, action, next);
            state = next;
            actions++;
        }

        for (int i = 0; i < 2; i++)
        {
            bool won = state.Winner == i;
            float outcome = state.Winner < 0 ? 0f : won ? 1f : -1f;
            players[i]?.EndGame(outcome);

            // Lift is the result minus what the ratings said the game was worth
            // before it started, so a card in a strong deck against a weak one
            // gets no credit for a win everybody saw coming.
            double actual = state.Winner < 0 ? 0.5 : won ? 1 : 0;
            double expected = Elo.Expected(agents[i].Elo, agents[1 - i].Elo);
            double lift = actual - expected;

            var stats = agents[i].Stats;
            foreach (var id in agents[i].Deck) stats.Appeared(CardIndex.Of(id));
            foreach (var (card, turn) in played[i]) stats.Played(card, lift, state.Turn, turn);
            foreach (var id in state.Players[i].Hand) stats.StuckInHand(CardIndex.Of(id));
        }

        int decisions = 0, recorded = 0;
        for (int i = 0; i < 2; i++)
        {
            decisions += players[i]?.DecisionsWithChoice ?? 0;
            recorded += players[i]?.RecordedRows ?? 0;
        }
        if (log is not null)
        {
            GameLog.EndGame(log, state.Winner, state.WinReason, state.Turn, logged);
            GameLog.Commit(log);
        }

        var (fatigueKill, sawFatigue) = ReadFatigue(state);
        return new MatchResult(state.Winner, state.WinReason, state.Turn, actions, decisions, recorded,
            fatigueKill, sawFatigue);
    }

    /// <summary>
    /// Whether an empty-deck draw ended the game, and whether one was charged at
    /// all. The engine files fatigue as ordinary debt, so the log line that
    /// charged it is the only record of which clock actually ran out.
    /// </summary>
    [ThreadStatic] private static GameLog.Buf? LogBuf;

    private static (bool Kill, bool Seen) ReadFatigue(GameState state)
    {
        bool onDebt = state.WinReason?.Contains("debt", StringComparison.Ordinal) == true;
        int loser = state.Winner < 0 ? -1 : GameState.Other(state.Winner);
        bool seen = false, kill = false, found = false;
        for (int i = state.Log.Count - 1; i >= 0; i--)
        {
            var e = state.Log[i];
            bool fatigue = e.Text.Contains("runs out of cards", StringComparison.Ordinal);
            if (fatigue) seen = true;
            // The last debt charged to the loser is the one that reached the
            // limit, because AddDebt stops once the game is over.
            if (onDebt && !found && e.Player == loser
                && e.Text.Contains("Debt is now", StringComparison.Ordinal))
            {
                found = true;
                kill = fatigue;
            }
        }
        return (kill, seen);
    }

    private static bool IsPlay(ActionType t) => t switch
    {
        ActionType.PlaySupporter => true,
        ActionType.PlaySummon => true,
        ActionType.ReplaceSummon => true,
        ActionType.CastSpell => true,
        ActionType.PlayStage => true,
        ActionType.CastTrap => true,
        _ => false,
    };
}
