using Selatza.Ai;
using Selatza.Cards;
using Selatza.Learn;
using Selatza.Learn.Nn;

namespace Selatza.Tests;

/// <summary>
/// The learning side. Two things here are worth more than the rest: that the
/// hand-written backprop agrees with a numeric gradient, and that the encoder
/// cannot see what it is not entitled to.
/// </summary>
public static class Learning
{
    private static readonly string[] SampleLeaders =
    {
        "fh-thefish", "ph-archlife", "rh-player1", "oh-spectralking", "sh-thejudge",
        "m-bg-machineblue", "f1-basicfish", "s3-yellowplanet", "o2-slime", "r3-greenstar",
    };

    public static void Run()
    {
        CardIndex.EnsureBuilt();
        Gradients();
        Cards();
        Decks();
        Scouting();
        Redaction();
        Persistence();
    }

    private static void Gradients()
    {
        foreach (var result in GradCheck.All())
        {
            Harness.Test($"gradients agree for {result.Name}", () =>
                Harness.True(result.Worst < 1e-2, $"{result.Name}: {result.Detail}"));
        }

        Harness.Test("training drives the loss down", () =>
        {
            var brain = new Brain { Name = "t", Net = new SelatzaNet(NetShape.Small, 7) };
            brain.Optimizer.Lr = 3e-3f;
            var rng = new Gauss(3);
            var target = new float[brain.Net.SampleSize];
            for (int i = 0; i < target.Length; i++) target[i] = rng.Next(0.05f);
            var sample = new float[brain.Net.SampleSize];
            var hand = new float[SelatzaNet.HandBuckets];

            for (int s = 0; s < 400; s++)
            {
                Array.Clear(sample);
                double sum = 0;
                for (int k = 0; k < 30; k++)
                {
                    int i = rng.NextInt(sample.Length);
                    sample[i] = 0.5f;
                    sum += sample[i] * target[i];
                }
                brain.Store.Add(sample, (float)Math.Tanh(sum * 6), 0f, hand, s % 2);
            }

            var cfg = new TrainConfig { BatchSize = 64, StepsPerRound = 30, SampleReuse = 0, Lr = 3e-3f };
            int threads = Math.Max(1, Math.Min(4, Environment.ProcessorCount));
            var first = Trainer.Train(brain, cfg, rng, threads);
            TrainReport last = first;
            for (int i = 0; i < 8; i++) last = Trainer.Train(brain, cfg, rng, threads);
            Harness.True(last.Value < first.Value * 0.6,
                $"value loss {first.Value:0.0000} -> {last.Value:0.0000}");
        });
    }

    private static void Cards()
    {
        Harness.Test("every registered card has a column and a static profile", () =>
        {
            Harness.Eq(Registry.All.Count, CardIndex.Count, "columns");
            Harness.Eq(CardIndex.StaticChannels * CardIndex.Count, CardIndex.StaticPlane.Length, "plane");
            foreach (var d in Registry.All) Harness.True(CardIndex.Of(d.Id) >= 0, d.Id);
        });

        Harness.Test("the card axis groups by colour so a kernel spans related cards", () =>
        {
            int changes = 0;
            for (int c = 1; c < CardIndex.Count; c++)
            {
                if (CardIndex.Def(c).Color != CardIndex.Def(c - 1).Color) changes++;
            }
            // Six colours, neutral among them, means five boundaries if the
            // ordering is doing its job.
            Harness.Eq(5, changes, "colour boundaries along the axis");
        });

        Harness.Test("colour identity is read off the leader", () =>
        {
            byte mono = CardIndex.IdentityOf("fh-thefish");
            byte dual = CardIndex.IdentityOf("m-bg-machineblue");
            int fish = CardIndex.Of("f1-basicfish");
            int robotFish = CardIndex.Of("m-bg-robotfish");
            Harness.True(CardIndex.LegalUnder(fish, mono), "fish under a fish leader");
            Harness.False(CardIndex.LegalUnder(robotFish, mono), "dual card under a mono leader");
            Harness.True(CardIndex.LegalUnder(robotFish, dual), "dual card under a dual leader");
        });
    }

    private static void Decks()
    {
        Harness.Test("generated decks are legal under their leader", () =>
        {
            var rng = new Gauss(11);
            var shape = DeckShape.Default;
            foreach (var leader in SampleLeaders)
            {
                var deck = DeckGen.Random(leader, shape, rng);
                var bad = DeckGen.Validate(leader, deck, shape.Size);
                Harness.True(bad is null, $"{leader}: {bad}");
            }
        });

        Harness.Test("a random leader from any level always has a legal pool", () =>
        {
            var rng = new Gauss(5);
            for (int i = 0; i < 40; i++)
            {
                string leader = DeckGen.RandomLeader(LeaderPool.All, rng);
                var deck = DeckGen.Random(leader, DeckShape.Default, rng);
                var bad = DeckGen.Validate(leader, deck, DeckShape.Default.Size);
                Harness.True(bad is null, $"{leader}: {bad}");
            }
        });

        Harness.Test("spreading leaders covers every colour pair before repeating one", () =>
        {
            var rng = new Gauss(7);
            // Pepper and Fish has the fewest eligible bodies, so it is the pair
            // an independent draw drops. One agent per pair is the tightest field
            // that can still cover them all, so the count follows the set rather
            // than being written down: Oil and Robot made it ten.
            int pairCount = DeckGen.LeaderCandidates(LeaderPool.Dual)
                .Select(CardIndex.IdentityOf).Distinct().Count();
            var leaders = DeckGen.SpreadLeaders(LeaderPool.Dual, pairCount, rng);
            var pairs = leaders.Select(CardIndex.IdentityOf).Distinct().ToList();
            Harness.Eq(pairCount, pairs.Count, "distinct colour pairs in the field");

            byte pepperFish = CardIndex.MaskOf(new[] { Color.P, Color.F });
            Harness.True(leaders.Any(h => CardIndex.IdentityOf(h) == pepperFish),
                "Pepper and Fish went unrepresented");

            // Every card in the set has to be legal for somebody in the field.
            var covered = 0;
            for (int c = 0; c < CardIndex.Count; c++)
            {
                var def = CardIndex.Def(c);
                if (def.Art is null) continue;
                if (leaders.Any(h => CardIndex.LegalUnder(c, CardIndex.IdentityOf(h)))) covered++;
                else Harness.True(false, $"{def.Id} is legal for nobody");
            }
            Harness.True(covered > 200, $"only {covered} cards reachable");
        });

        Harness.Test("mutation keeps the deck legal and the same size", () =>
        {
            var rng = new Gauss(21);
            string leader = "m-bg-machineblue";
            var deck = DeckGen.Random(leader, DeckShape.Default, rng);
            var stats = new CardStats();
            for (int i = 0; i < 12; i++)
            {
                deck = DeckGen.Mutate(leader, deck, 4, c => stats.Score(c), c => stats.GlobalScore(c, 100), rng);
                var bad = DeckGen.Validate(leader, deck, DeckShape.Default.Size);
                Harness.True(bad is null, $"after {i + 1} rounds of swaps: {bad}");
            }
        });
    }

    private static GameState Play(Agent a, Agent b, int seed, int stopTurn, Intel[] intel)
    {
        var state = Engine.CreateGame(a.ToDeckList(), b.ToDeckList(), seed);
        foreach (var i in intel) i.Begin(state);
        int guard = 0;
        while (state.Winner < 0 && state.Turn < stopTurn && guard++ < 3000)
        {
            int actor = state.CurrentActor;
            var action = Bot.ChooseAction(state, actor);
            var res = Engine.Apply(state, actor, action);
            if (!res.Ok) break;
            foreach (var i in intel) i.Observe(state, actor, action, res.State!);
            state = res.State!;
        }
        return state;
    }

    private static Agent MakeAgent(string name, string leader, Gauss rng, IntelConfig intel) => new()
    {
        Name = name,
        LeaderId = leader,
        Deck = DeckGen.Random(leader, DeckShape.Default, rng),
        Intel = intel,
        ReferenceBot = true,
    };

    private static void Scouting()
    {
        Harness.Test("the tracker never names a card that is not there", () =>
        {
            var rng = new Gauss(31);
            // Deliberately generous rolls, so the invariant is under real pressure.
            var greedy = new IntelConfig
            { DeckScoutChance = 0.9, DeckScoutRolls = 4, HandScoutChance = 0.6, HandScoutRolls = 3 };
            var a = MakeAgent("watcher", "fh-thefish", rng, greedy);
            var b = MakeAgent("target", "ph-archlife", rng, IntelConfig.Blind);
            var intel = new Intel(0, greedy, 99);
            var state = Play(a, b, 4242, 30, new[] { intel });

            var handCounts = new int[CardIndex.Count];
            var deckCounts = new int[CardIndex.Count];
            foreach (var id in state.Players[1].Hand) handCounts[CardIndex.Of(id)]++;
            foreach (var id in state.Players[1].Deck) deckCounts[CardIndex.Of(id)]++;
            for (int c = 0; c < CardIndex.Count; c++)
            {
                Harness.True(intel.KnownHand[c] <= handCounts[c],
                    $"{CardIndex.Id(c)}: named {intel.KnownHand[c]} in hand, really {handCounts[c]}");
                Harness.True(intel.KnownDeck[c] <= deckCounts[c],
                    $"{CardIndex.Id(c)}: named {intel.KnownDeck[c]} in deck, really {deckCounts[c]}");
            }
        });

        Harness.Test("generous rolls do eventually name something", () =>
        {
            var rng = new Gauss(32);
            var greedy = new IntelConfig
            { DeckScoutChance = 0.9, DeckScoutRolls = 4, HandScoutChance = 0.9, HandScoutRolls = 3 };
            var a = MakeAgent("watcher", "fh-thefish", rng, greedy);
            var b = MakeAgent("target", "ph-archlife", rng, IntelConfig.Blind);
            var intel = new Intel(0, greedy, 7);
            Play(a, b, 909, 24, new[] { intel });
            Harness.True(intel.DeckCardsNamed > 0, "named nothing in the deck");
            Harness.True(intel.ScoutRollsTaken > 0, "never rolled");
        });

        Harness.Test("no rolls means no read beyond what is face up", () =>
        {
            var rng = new Gauss(33);
            var a = MakeAgent("watcher", "fh-thefish", rng, IntelConfig.Blind);
            var b = MakeAgent("target", "ph-archlife", rng, IntelConfig.Blind);
            var intel = new Intel(0, IntelConfig.Blind, 3);
            Play(a, b, 515, 24, new[] { intel });
            Harness.Eq(0, intel.DeckCardsNamed, "deck cards named");
            Harness.Eq(0, intel.HandCardsNamed, "hand cards named");
            for (int c = 0; c < CardIndex.Count; c++)
            {
                Harness.Eq(0, intel.KnownHand[c], "hand knowledge");
                Harness.Eq(0, intel.KnownDeck[c], "deck knowledge");
            }
        });

        Harness.Test("copies the opponent has played are counted", () =>
        {
            var rng = new Gauss(34);
            var a = MakeAgent("watcher", "fh-thefish", rng, IntelConfig.Blind);
            var b = MakeAgent("target", "ph-archlife", rng, IntelConfig.Blind);
            var intel = new Intel(0, IntelConfig.Blind, 3);
            var state = Play(a, b, 616, 26, new[] { intel });

            int counted = 0;
            for (int c = 0; c < CardIndex.Count; c++) counted += intel.PlayedTotal[c];
            Harness.True(counted > 0, "counted nothing across 26 turns");

            for (int c = 0; c < CardIndex.Count; c++)
            {
                Harness.True(intel.Accounted[c] >= intel.PlayedTotal[c], "accounting lost a played copy");
                Harness.True(intel.PlausibleRemaining(c) <= CardIndex.CopyLimit(c), "over the rarity cap");
                if (!CardIndex.LegalUnder(c, intel.EnemyIdentity))
                {
                    Harness.Eq(0, intel.PlausibleRemaining(c), "off-colour card treated as possible");
                }
            }
            Harness.True(state.Turn > 1, "game did not start");
        });
    }

    private static void Redaction()
    {
        Harness.Test("the observation is blind to the opponent's hidden cards", () =>
        {
            var rng = new Gauss(41);
            var a = MakeAgent("me", "fh-thefish", rng, IntelConfig.Blind);
            var b = MakeAgent("them", "ph-archlife", rng, IntelConfig.Blind);
            var intel = new Intel(0, IntelConfig.Blind, 3);
            var state = Play(a, b, 777, 12, new[] { intel });

            var enc = new Encoder(0, intel, state);
            var before = enc.EncodeNew(state);

            // Swap every card the viewer is not allowed to see for something
            // else legal for that player, leaving the counts alone.
            var swapped = state.Clone();
            var pool = b.Deck.Distinct(StringComparer.Ordinal).ToList();
            int k = 0;
            for (int i = 0; i < swapped.Players[1].Hand.Count; i++)
            {
                swapped.Players[1].Hand[i] = pool[k++ % pool.Count];
            }
            for (int i = 0; i < swapped.Players[1].Deck.Count; i++)
            {
                swapped.Players[1].Deck[i] = pool[k++ % pool.Count];
            }
            foreach (var s in swapped.Players[1].Slots)
            {
                if (s is null) continue;
                foreach (var h in s.Hp)
                {
                    if (!h.Flipped) h.CardId = pool[k++ % pool.Count];
                }
            }
            if (swapped.Players[1].Leader is { } leader)
            {
                foreach (var h in leader.Hp)
                {
                    if (!h.Flipped) h.CardId = pool[k++ % pool.Count];
                }
            }
            foreach (var s in swapped.Players[0].Slots)
            {
                if (s is null) continue;
                foreach (var h in s.Hp)
                {
                    if (!h.Flipped) h.CardId = pool[k++ % pool.Count];
                }
            }

            var after = enc.EncodeNew(swapped);
            for (int i = 0; i < before.Length; i++)
            {
                Harness.Eq(before[i], after[i], $"feature {i} moved when only hidden cards changed");
            }
        });

        Harness.Test("a scouted card does show up in the observation", () =>
        {
            var rng = new Gauss(42);
            var greedy = new IntelConfig
            { DeckScoutChance = 1.0, DeckScoutRolls = 4, HandScoutChance = 1.0, HandScoutRolls = 3 };
            var a = MakeAgent("me", "fh-thefish", rng, greedy);
            var b = MakeAgent("them", "ph-archlife", rng, IntelConfig.Blind);
            var intel = new Intel(0, greedy, 3);
            // Stopped early on purpose. The tracker clamps every remembered card
            // against the real zones, so a scouted card that has since been
            // drawn or played stops being known, and a bot that empties its hand
            // faster leaves nothing scouted still sitting in the deck.
            var state = Play(a, b, 778, 6, new[] { intel });

            var enc = new Encoder(0, intel, state);
            var obs = enc.EncodeNew(state);
            int cards = CardIndex.Count;
            float handKnown = 0, deckKnown = 0;
            for (int c = 0; c < cards; c++)
            {
                handKnown += obs[14 * cards + c];
                deckKnown += obs[15 * cards + c];
            }
            Harness.True(handKnown + deckKnown > 0, "scouted cards never reached the observation");
        });
    }

    private static void Persistence()
    {
        Harness.Test("a saved network reloads to the same numbers", () =>
        {
            var net = new SelatzaNet(NetShape.Small, 13);
            var rng = new Gauss(2);
            var input = new float[net.SampleSize * 3];
            for (int i = 0; i < input.Length; i++) input[i] = rng.Uniform() < 0.05 ? 0.5f : 0;
            var before = net.Value(input, 3);

            string path = Path.Combine(Path.GetTempPath(), $"selatza-test-{Guid.NewGuid():N}.snn");
            try
            {
                net.Save(path);
                var loaded = SelatzaNet.Load(path);
                var after = loaded.Value(input, 3);
                for (int i = 0; i < before.Length; i++) Harness.Eq(before[i], after[i], $"value {i}");
            }
            finally
            {
                if (File.Exists(path)) File.Delete(path);
            }
        });

        Harness.Test("a run snapshots and resumes with its ratings and decks intact", () =>
        {
            string dir = Path.Combine(Path.GetTempPath(), $"selatza-run-{Guid.NewGuid():N}");
            try
            {
                var cfg = new TournamentConfig
                {
                    Agents = 4,
                    Brains = 2,
                    Anchors = 0,
                    Rounds = 2,
                    GamesPerPairing = 1,
                    Net = NetShape.Small,
                    OutDir = dir,
                    Threads = 2,
                    Quiet = true,
                    EvolveEvery = 0,
                    Train = new TrainConfig { StepsPerRound = 2, BatchSize = 32 },
                };
                var run = new Tournament(cfg);
                run.RunRound();
                run.SaveSnapshot();
                var ratings = run.Agents.Select(a => a.Elo).ToArray();
                var decks = run.Agents.Select(a => string.Join(",", a.Deck)).ToArray();
                var leaders = run.Agents.Select(a => a.LeaderId).ToArray();

                var again = new Tournament(cfg);
                int at = again.TryResume();
                Harness.Eq(1, at, "resumed round");
                for (int i = 0; i < ratings.Length; i++)
                {
                    Harness.Eq(ratings[i], again.Agents[i].Elo, $"agent {i} rating");
                    Harness.Eq(decks[i], string.Join(",", again.Agents[i].Deck), $"agent {i} deck");
                    Harness.Eq(leaders[i], again.Agents[i].LeaderId, $"agent {i} leader");
                }
            }
            finally
            {
                if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);
            }
        });
    }
}
