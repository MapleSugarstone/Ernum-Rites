using Selatza.Learn.Nn;

namespace Selatza.Learn;

public sealed class TrainConfig
{
    public int BatchSize { get; set; } = 128;

    /// <summary>Gradient steps taken after each round of play.</summary>
    public int StepsPerRound { get; set; } = 150;

    public float Lr { get; set; } = 2e-3f;
    public float LrDecay { get; set; } = 0.995f;
    public float MinLr { get; set; } = 3e-4f;

    public float ValueWeight { get; set; } = 1f;

    /// <summary>
    /// Scale on the residual the network is asked to learn. The target is the
    /// result of the game minus what the evaluator thought of the position, so a
    /// network with nothing to say predicts zero and leaves the evaluator's
    /// ranking untouched. Below 1 it is asked for a smaller correction than the
    /// evidence suggests, which is the conservative setting.
    /// </summary>
    public float ResidualScale { get; set; } = 1f;

    /// <summary>
    /// Share of the label taken from what the position turned into a round of
    /// play later, as the search scored it, with the rest taken from the result
    /// of the game. A result is one noisy bit from the end of a nine-turn game;
    /// the next turn's score is denser and closer, and it is what teaches a
    /// network the shape of a turn that set something up. Zero is the pure
    /// result.
    /// </summary>
    public float Bootstrap { get; set; } = 0.3f;

    /// <summary>
    /// Guessing the opponent's hand is not what the agent is for; it is there so
    /// the trunk has a reason to read the card-counting plane at all.
    /// </summary>
    public float HandWeight { get; set; } = 0.3f;

    public float TrapWeight { get; set; } = 0.2f;

    /// <summary>Positions kept before the oldest half is dropped.</summary>
    public int ReplayCap { get; set; } = 60000;

    /// <summary>
    /// Times each stored position is expected to be sampled in a round, which
    /// caps the step count while the buffer is still small. The first rounds of
    /// a run hold a few hundred positions, and hammering them two hundred times
    /// teaches a network the buffer rather than the game.
    /// </summary>
    public double SampleReuse { get; set; } = 4;

    public TrainConfig Clone() => (TrainConfig)MemberwiseClone();
}

public readonly record struct TrainReport(double Value, double Hand, double Trap, int Steps)
{
    public double Total => Value + Hand + Trap;
    public override string ToString() => $"value {Value:0.0000} hand {Hand:0.0000} trap {Trap:0.0000}";
}

public static class Trainer
{
    /// <summary>
    /// Regression onto how wrong the old evaluator was about a position: the
    /// result of the game minus what the evaluator thought. A network that has
    /// learned nothing predicts zero and changes no decisions, which is the
    /// property that makes this safe to switch on.
    ///
    /// The batch is split across the brain's replicas, each accumulating its own
    /// gradients, which are summed before the step. Training is the slow half of
    /// a round, and this is where the cores go.
    /// </summary>
    public static TrainReport Train(Brain brain, TrainConfig cfg, Gauss rng, int threads = 1)
    {
        var store = brain.Store;
        if (store.Count < cfg.BatchSize) return new TrainReport(0, 0, 0, 0);

        var net = brain.Net;
        int batch = cfg.BatchSize;
        threads = Math.Max(1, Math.Min(threads, batch / 16));
        brain.EnsureReplicas(threads, 4242);

        var rows = new int[batch];
        var input = new float[batch * net.SampleSize];
        var value = new float[batch];
        var prior = new float[batch];
        var hand = new float[batch * SelatzaNet.HandBuckets];
        var trap = new float[batch];
        var boot = new float[batch];

        int chunk = (batch + threads - 1) / threads;
        var losses = new double[threads * 3];
        var opts = new ParallelOptions { MaxDegreeOfParallelism = threads };
        var master = net.Parameters;

        // Per-thread scratch, allocated once: a step otherwise churns megabytes.
        var dvBuf = new float[threads][];
        var dhBuf = new float[threads][];
        var dtBuf = new float[threads][];
        for (int t = 0; t < threads; t++)
        {
            dvBuf[t] = new float[chunk];
            dhBuf[t] = new float[chunk * SelatzaNet.HandBuckets];
            dtBuf[t] = new float[chunk];
        }

        double sumV = 0, sumH = 0, sumT = 0;
        int steps = 0;
        int plan = cfg.SampleReuse > 0
            ? Math.Clamp((int)(store.Count * cfg.SampleReuse / batch), 1, cfg.StepsPerRound)
            : cfg.StepsPerRound;

        for (int s = 0; s < plan; s++)
        {
            for (int i = 0; i < batch; i++) rows[i] = rng.NextInt(store.Count);
            store.Fill(rows, input, value, prior, hand, trap, boot);
            float mix = Math.Clamp(cfg.Bootstrap, 0f, 1f);
            for (int i = 0; i < batch; i++)
            {
                float target = (1 - mix) * value[i] + mix * boot[i];
                value[i] = Math.Clamp(cfg.ResidualScale * (target - prior[i]), -1f, 1f);
            }
            Array.Clear(losses);

            Parallel.For(0, threads, opts, t =>
            {
                int from = t * chunk;
                int count = Math.Min(chunk, batch - from);
                if (count <= 0) return;
                var replica = brain.Replica(t);
                replica.Forward(input, from, count, training: true);
                var pv = replica.LastValue.Data;
                var ph = replica.LastHand.Data;
                var pt = replica.LastTrap.Data;

                var dv = dvBuf[t];
                var dh = dhBuf[t];
                var dt = dtBuf[t];
                float invB = 1f / batch;
                double lv = 0, lh = 0, lt = 0;

                for (int i = 0; i < count; i++)
                {
                    float e = pv[i] - value[from + i];
                    lv += e * e;
                    dv[i] = cfg.ValueWeight * 2f * e * invB;

                    float p = 1f / (1f + MathF.Exp(-pt[i]));
                    float y = trap[from + i];
                    lt += -(y * MathF.Log(p + 1e-7f) + (1 - y) * MathF.Log(1 - p + 1e-7f));
                    dt[i] = cfg.TrapWeight * (p - y) * invB;
                }
                for (int i = 0; i < count * SelatzaNet.HandBuckets; i++)
                {
                    float e = ph[i] - hand[from * SelatzaNet.HandBuckets + i];
                    lh += e * e;
                    dh[i] = cfg.HandWeight * 2f * e * invB / SelatzaNet.HandBuckets;
                }

                Adam.ZeroGrads(replica.Parameters);
                replica.Backward(dv, dh, dt, count);
                losses[t * 3] = lv;
                losses[t * 3 + 1] = lh;
                losses[t * 3 + 2] = lt;
            });

            for (int pi = 0; pi < master.Count; pi++)
            {
                var g = master[pi].G;
                Array.Clear(g);
                for (int t = 0; t < threads; t++)
                {
                    var src = brain.Replica(t).Parameters[pi].G;
                    for (int i = 0; i < g.Length; i++) g[i] += src[i];
                }
            }
            brain.Optimizer.Step(master);
            net.AfterStep();
            brain.RefreshReplicas(threads);

            double lvAll = 0, lhAll = 0, ltAll = 0;
            for (int t = 0; t < threads; t++)
            {
                lvAll += losses[t * 3];
                lhAll += losses[t * 3 + 1];
                ltAll += losses[t * 3 + 2];
            }
            sumV += lvAll / batch;
            sumH += lhAll / (batch * SelatzaNet.HandBuckets);
            sumT += ltAll / batch;
            steps++;
        }

        brain.TrainedSteps += steps;
        brain.Optimizer.Lr = Math.Max(cfg.MinLr, brain.Optimizer.Lr * cfg.LrDecay);
        var report = new TrainReport(sumV / steps, sumH / steps, sumT / steps, steps);
        brain.LastLoss = report.Total;
        return report;
    }
}
