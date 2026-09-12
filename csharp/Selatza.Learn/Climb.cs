using Selatza.Ai;
using Selatza.Learn.Nn;

namespace Selatza.Learn;

/// <summary>
/// Evolves one deck against a single fixed opponent.
///
/// The tournament evolves a whole field at once, which is what a metagame looks
/// like but a poor way to answer "can this leader beat that deck at all". Every
/// agent there chases a moving target, so a deck that improves may only have
/// drifted toward the field's average. Here the opponent never changes, and a
/// gain is a gain against the thing you asked about.
///
/// Each round is a race rather than a survey. Every mutant is screened on a
/// small number of games, only the few best are played properly, and the
/// incumbent plays that second stage alongside them on the same seed. Measuring
/// sixteen mutants equally and taking the best of them selects whichever drew
/// well: at sixty games each the interval is about thirteen points, and the
/// maximum of sixteen such draws is mostly luck. Screening cheaply and
/// confirming narrowly spends the same games on a far better decision, and
/// carrying the incumbent into the same seed removes the seed from the
/// comparison entirely.
/// </summary>
public static class Climb
{
    public sealed class Step
    {
        public required int Round { get; init; }
        public required double BestRate { get; init; }
        public required double TriedBest { get; init; }
        public required int Swaps { get; init; }
        /// <summary>The evaluator change this round adopted, when it was one.</summary>
        public string Moved { get; init; } = "";
        public required bool Adopted { get; init; }
    }

    public sealed class Options
    {
        /// <summary>Mutants made each round, all screened in parallel.</summary>
        public int Population { get; init; } = 24;
        /// <summary>Games in the screen. Cheap and noisy on purpose.</summary>
        public int ScreenGames { get; init; } = 24;
        /// <summary>Screen survivors that go on to the measured stage.</summary>
        public int Finalists { get; init; } = 4;
        /// <summary>Games each finalist and the incumbent play in that stage.</summary>
        public int Games { get; init; } = 150;
        public int Rounds { get; init; } = 30;
        public int Threads { get; init; } = Environment.ProcessorCount;
        public int Seed { get; init; } = 1;
        /// <summary>
        /// Largest share of the deck a mutant may rewrite. Step sizes spread
        /// between one card and this, so each round tries both small steps and
        /// large jumps rather than committing to one size.
        /// </summary>
        public double MaxChurn { get; init; } = 0.25;
        /// <summary>Rate the deck has to hold on the final large sample.</summary>
        public double Target { get; init; } = 0.55;
        /// <summary>Games in that final check, which is the number worth quoting.</summary>
        public int ConfirmGames { get; init; } = 1000;
        public IntelConfig? Intel { get; init; }
        public int MinSize { get; init; } = 48;
        public int MaxSize { get; init; } = 54;

        /// <summary>
        /// Share of each round's mutants that change how the bot values a
        /// position rather than which cards it holds. A deck and the
        /// evaluator piloting it are one strategy: a list built to bank a
        /// resource and spend it later loses to an evaluator that prices
        /// that resource at nothing, whatever the cards say. At 0 only the
        /// cards move.
        /// </summary>
        public double WeightShare { get; init; } = 0.4;

        /// <summary>Names of the weights the search may change.</summary>
        public string[] Knobs { get; init; } =
            { "Love", "Reach", "Hand", "Deck", "Body", "Debt", "LeaderHp", "Trigger" };
    }

    public static (Experiment.Deck Best, double Rate, List<Step> History, BotWeights Weights) Run(
        Experiment.Deck start, Experiment.Deck opponent, Options o,
        Action<Step, Experiment.Deck>? onStep = null)
    {
        var rng = new Gauss(o.Seed);
        var best = start.Clone(start.Name);
        BotWeights bestW = BotWeights.Default;
        var knobs = typeof(BotWeights).GetFields()
            .Where(k => k.FieldType == typeof(double) && !k.IsInitOnly
                        && o.Knobs.Contains(k.Name, StringComparer.OrdinalIgnoreCase))
            .ToArray();

        static BotWeights CopyOf(BotWeights w)
        {
            var c = new BotWeights();
            foreach (var k in typeof(BotWeights).GetFields())
            {
                if (!k.IsInitOnly) k.SetValue(c, k.GetValue(w));
            }
            return c;
        }
        var history = new List<Step>();
        int par = Math.Max(1, o.Threads);

        var baseRes = Experiment.Play(best, opponent, o.Games, o.Seed, par, o.Intel,
            weightsA: bestW);
        double bestRate = baseRes.RateA;

        int maxSwaps = Math.Max(2, (int)(best.Cards.Count * o.MaxChurn));

        for (int round = 1; round <= o.Rounds; round++)
        {
            var mutants = new Experiment.Deck[o.Population];
            var weights = new BotWeights[o.Population];
            var swaps = new int[o.Population];
            var movedWeight = new string[o.Population];
            for (int i = 0; i < o.Population; i++)
            {
                // The tail of the population changes the evaluator instead of
                // the cards, so each round tries both kinds of move.
                bool tweakWeights = knobs.Length > 0
                    && i >= (int)(o.Population * (1 - o.WeightShare));
                weights[i] = bestW;
                movedWeight[i] = "";
                if (tweakWeights)
                {
                    var w = CopyOf(bestW);
                    var knob = knobs[rng.NextInt(knobs.Length)];
                    double was = (double)knob.GetValue(w)!;
                    // A multiplicative step, so a weight of 0.6 and one of 12
                    // both move by an amount that means something to them.
                    double factor = 0.5 + rng.Uniform() * 1.5;
                    double now = was == 0 ? rng.Uniform() : was * factor;
                    knob.SetValue(w, now);
                    weights[i] = w;
                    movedWeight[i] = $"{knob.Name} {was:0.##}->{now:0.##}";
                }
                swaps[i] = tweakWeights ? 0
                    : 1 + (int)Math.Round((double)i / Math.Max(1, o.Population - 1) * (maxSwaps - 1));
                var cards = swaps[i] == 0 ? new List<string>(best.Cards)
                    : DeckGen.Mutate(best.LeaderId, best.Cards, swaps[i],
                    // No card memory. Against one opponent the only signal worth
                    // having is the whole deck's result, so moves are random and
                    // selection does the work.
                    _ => rng.Uniform(), _ => rng.Uniform(),
                    rng, o.MinSize, o.MaxSize);
                mutants[i] = new Experiment.Deck
                {
                    Name = $"{start.Name} r{round}m{i}",
                    LeaderId = best.LeaderId,
                    Cards = cards,
                };
            }

            int screenSeed = o.Seed + round * 7919;
            var screen = new double[o.Population];
            Parallel.For(0, o.Population, new ParallelOptions { MaxDegreeOfParallelism = par }, i =>
            {
                screen[i] = Experiment.Play(mutants[i], opponent, o.ScreenGames, screenSeed, 1,
                    o.Intel, weightsA: weights[i]).RateA;
            });

            var finalists = Enumerable.Range(0, o.Population)
                .OrderByDescending(i => screen[i])
                .Take(Math.Max(1, Math.Min(o.Finalists, o.Population)))
                .ToArray();

            // The incumbent runs this stage too, on the same seed as the
            // challengers, so nothing is adopted for having had an easier draw.
            int raceSeed = screenSeed + 104729;
            var field = new List<Experiment.Deck> { best };
            field.AddRange(finalists.Select(i => mutants[i]));
            var fieldW = new List<BotWeights> { bestW };
            fieldW.AddRange(finalists.Select(i => weights[i]));
            var rates = new double[field.Count];
            Parallel.For(0, field.Count, new ParallelOptions { MaxDegreeOfParallelism = par }, i =>
            {
                rates[i] = Experiment.Play(field[i], opponent, o.Games, raceSeed, 1, o.Intel,
                    weightsA: fieldW[i]).RateA;
            });

            int top = 0;
            for (int i = 1; i < rates.Length; i++)
            {
                if (rates[i] > rates[top]) top = i;
            }

            bool adopted = top != 0;
            if (adopted)
            {
                best = field[top];
                bestW = fieldW[top];
            }
            bestRate = rates[top];

            var step = new Step
            {
                Round = round,
                BestRate = bestRate,
                TriedBest = rates.Skip(1).DefaultIfEmpty(0).Max(),
                Swaps = adopted ? swaps[finalists[top - 1]] : 0,
                Moved = adopted ? movedWeight[finalists[top - 1]] : "",
                Adopted = adopted,
            };
            history.Add(step);
            onStep?.Invoke(step, best);

            if (bestRate >= o.Target)
            {
                var check = Experiment.Play(best, opponent, o.ConfirmGames, raceSeed + 15485863, par,
                    o.Intel, weightsA: bestW);
                bestRate = check.RateA;
                if (check.RateA >= o.Target) break;
            }
        }

        var final = Experiment.Play(best, opponent, o.ConfirmGames, o.Seed + 32452843, par,
            o.Intel, weightsA: bestW);
        return (best, final.RateA, history, bestW);
    }
}
