"""Reads a round-robin matrix and says what a rational field would play.

A round-robin win rate weights every opponent equally, and a third of any
evolved field is decks nobody would bring, so the raw average flatters whatever
beats bad decks. The equilibrium mixture weights a deck by how much a rational
field would actually play it, which is the number to read for balance.

    python scripts/rrnash.py runs/rr-lite3.csv
"""
import collections
import csv
import io
import sys


def mixture(payoff, iters=20000, step=0.01):
    """Replicator dynamics on an antisymmetric matrix; None means never met."""
    n = len(payoff)
    w = [1.0 / n] * n
    for _ in range(iters):
        grad = [0.0] * n
        for i in range(n):
            s = m = 0.0
            for j in range(n):
                v = payoff[i][j]
                if i == j or v is None:
                    continue
                s += w[j] * v
                m += w[j]
            grad[i] = s / m if m > 0 else 0.0
        avg = sum(w[i] * grad[i] for i in range(n))
        tot = 0.0
        for i in range(n):
            w[i] *= 1 + step * (grad[i] - avg)
            w[i] = max(w[i], 1e-12)
            tot += w[i]
        w = [x / tot for x in w]
    return w


path = sys.argv[1] if len(sys.argv) > 1 else "runs/rr-lite3.csv"
rows = list(csv.DictReader(io.open(path, encoding="utf-8")))
names = sorted({r["a"] for r in rows} | {r["b"] for r in rows},
               key=lambda d: int(d.split()[0]))
idx = {d: i for i, d in enumerate(names)}
n = len(names)

pay = [[None] * n for _ in range(n)]
wins = collections.Counter()
games = collections.Counter()
for r in rows:
    a, b, g = r["a"], r["b"], int(r["games"])
    wa, wb = int(r["a_wins"]), int(r["b_wins"])
    wins[a] += wa
    wins[b] += wb
    games[a] += g
    games[b] += g
    pay[idx[a]][idx[b]] = 2 * (wa / g) - 1
    pay[idx[b]][idx[a]] = 2 * (wb / g) - 1

done = sum(1 for i in range(n) for j in range(n) if i != j and pay[i][j] is not None) // 2
print(f"{n} decks, {done} of {n*(n-1)//2} pairings played\n")

w = mixture(pay)
rate = {d: wins[d] / games[d] for d in names}

# Win rate weighted by how much a rational field would play each opponent,
# rather than by how many of each the trainer happened to produce.
weighted = {}
for d in names:
    i = idx[d]
    num = den = 0.0
    for j, o in enumerate(names):
        if i == j or pay[i][j] is None:
            continue
        num += w[j] * (pay[i][j] + 1) / 2
        den += w[j]
    weighted[d] = num / den if den > 0 else 0.0

print(f"{'deck':32s} {'nash':>7s} {'flat':>7s} {'weighted':>9s}")
for d in sorted(names, key=lambda x: -w[idx[x]])[:20]:
    print(f"  {d[:30]:30s} {100*w[idx[d]]:6.1f}% {100*rate[d]:6.1f}% {100*weighted[d]:8.1f}%")

print("\ndecks the mixture rates far above their flat win rate (counter-picks):")
gap = sorted(names, key=lambda d: -(w[idx[d]] - rate[d] / sum(rate.values())))
for d in gap[:8]:
    if w[idx[d]] < 0.005:
        break
    print(f"  {d[:30]:30s} nash {100*w[idx[d]]:5.1f}%  flat rank "
          f"{sorted(names, key=lambda x: -rate[x]).index(d)+1}")

carry = sum(w[idx[d]] for d in names if w[idx[d]] >= 0.01)
support = [d for d in names if w[idx[d]] >= 0.01]
print(f"\n{len(support)} decks hold 1% or more of the mixture, {100*carry:.0f}% of the weight")
io.open("runs/rr-nash-support.txt", "w", encoding="utf-8", newline="\n").write(
    "\n".join(support) + "\n")
print("support written to runs/rr-nash-support.txt")
