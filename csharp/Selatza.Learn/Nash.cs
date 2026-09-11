namespace Selatza.Learn;

/// <summary>
/// What a rational metagame would actually play, rather than what beat the most
/// games.
///
/// A ladder rating is one number per agent and assumes the field is transitive:
/// that if A beats B and B beats C then A beats C. A card game is not like
/// that. A deck can crush the field leader and lose to the mid-table, and a
/// single rating cannot express it, so a ranking by rating quietly hides the
/// counter-pick. The payoff matrix does hold it, and the equilibrium of that
/// matrix says how much weight a strategy deserves: a deck that only answers
/// one opponent gets a small share, and a deck nothing answers gets a large
/// one.
///
/// Solved by replicator dynamics rather than a linear program, which is enough
/// for a report and needs nothing outside this file. The result is a mixture,
/// not an ordering, so two decks can share the weight when each answers the
/// other's prey.
/// </summary>
public static class Nash
{
    /// <summary>
    /// A mixture over the rows of an antisymmetric payoff matrix, where
    /// <paramref name="payoff"/>[i][j] is i's advantage over j in the range -1
    /// to 1 and a null entry means the pair never met.
    /// </summary>
    public static double[] Mixture(double?[][] payoff, int iterations = 200000)
    {
        int n = payoff.Length;
        if (n == 0) return Array.Empty<double>();

        // Fictitious play: each step best-responds to the running average of
        // what has been played, and the average of the path is the answer.
        // Replicator dynamics was tried first and orbits instead of settling:
        // this set holds a real rock-paper-scissors triangle at the top (the
        // lite3 field had one beating the next 88, 62 and 75 percent), and a
        // trajectory method circles such a cycle forever. The time average of
        // fictitious play converges in a zero-sum game even when the path does
        // not, which is the property that matters here.
        var count = new double[n];
        var sum = new double[n];
        count[0] = 1;
        for (int t = 1; t <= iterations; t++)
        {
            double total = 0;
            for (int i = 0; i < n; i++) total += count[i];

            int best = 0;
            double bestScore = double.MinValue;
            for (int i = 0; i < n; i++)
            {
                // A pair that never met, and a row against itself, both count
                // as an even game. Normalising by the mass actually played
                // instead makes every row score zero at the centre of a
                // rock-paper-scissors, where the tie then breaks to the same
                // index forever and the mixture collapses onto it.
                double score = 0;
                for (int j = 0; j < n; j++)
                {
                    if (payoff[i][j] is { } v) score += count[j] / total * v;
                }
                if (score > bestScore)
                {
                    bestScore = score;
                    best = i;
                }
                sum[i] += count[i] / total;
            }
            count[best]++;
        }

        double norm = 0;
        for (int i = 0; i < n; i++) norm += sum[i];
        var outMix = new double[n];
        if (norm <= 0) { for (int i = 0; i < n; i++) outMix[i] = 1.0 / n; return outMix; }
        for (int i = 0; i < n; i++) outMix[i] = sum[i] / norm;
        return outMix;
    }
}
