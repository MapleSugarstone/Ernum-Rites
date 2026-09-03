namespace Selatza.Cards;

/// <summary>
/// The small vocabulary of deferred board picks the set shares, mirrored key
/// for key with src/cards/shared-choices.ts. Registered once from CardIndex.
/// </summary>
public static class SharedChoices
{
    private static bool _done;
    private static readonly object Gate = new();

    public static void Register()
    {
        lock (Gate)
        {
            if (_done) return;
            _done = true;
        }

        // Kapigras takes the seat it was pointed at and wears that leader's
        // card. The seat is read rather than the body, so a leader that has not
        // entered yet is copied from the card its deck names.
        Choices.Register("kapigras", (state, choice, pick) =>
        {
            if (pick.Ref is not { Kind: TargetKind.Leader } r) return;
            if (choice.At is not { } at || state.Find(at) is not { } body) return;
            var copyId = Generated.OilCopy(state.Players[r.Player].LeaderCardId);
            body.CardId = copyId;
            int want = Registry.Card(copyId).Hp * 2 + 2;
            if (body.Hp.Count < want) Effects.AssignHp(state, body, want - body.Hp.Count);
            Effects.Log(state, choice.Player,
                $"Kapigras shakes apart and reforms as {Registry.Card(copyId).Name}.");
        });

        Choices.Register("deal-1", (state, choice, pick) =>
        {
            if (pick.Ref is { } r)
            {
                Effects.DealDamage(state, r, 1 + Effects.EffectDamageOf(state, choice.Player));
            }
        });

        Choices.Register("wound-1", (state, _, pick) =>
        {
            if (pick.Ref is { } r) Effects.AddWounds(state, r, 1);
        });

        Choices.Register("gain-hp-1", (state, _, pick) =>
        {
            if (pick.Ref is { } r && state.Find(r) is { } s) Effects.AssignHp(state, s, 1);
        });

        Choices.Register("gain-hp-2", (state, _, pick) =>
        {
            if (pick.Ref is { } r && state.Find(r) is { } s) Effects.AssignHp(state, s, 2);
        });

        Choices.Register("buff-1", (state, _, pick) =>
        {
            if (pick.Ref is { } r && state.Find(r) is { } s)
            {
                s.StrengthMods.Add(new StrengthMod(1, ModDuration.Permanent));
            }
        });

        Choices.Register("heal-1", (state, _, pick) =>
        {
            if (pick.Ref is { } r) Effects.UnflipHp(state, r, 1);
        });

        Choices.Register("heal-2", (state, _, pick) =>
        {
            if (pick.Ref is { } r) Effects.UnflipHp(state, r, 2);
        });

        Choices.Register("catch-1", (state, _, pick) =>
        {
            if (pick.Ref is { } r) Effects.CatchHp(state, r, 1);
        });

        Choices.Register("shield-1", (state, choice, pick) =>
        {
            if (pick.Ref is not { } r || state.Find(r) is not { } s) return;
            s.Shields += 1;
            Effects.Log(state, choice.Player,
                $"{Registry.Card(s.CardId).Name} raises 1 Power Shield.");
        });

        Choices.Register("sap-supporter", (state, choice, pick) =>
        {
            if (pick.Ref is not { } r || r.Kind != TargetKind.Supporter) return;
            var row = state.Players[r.Player].Supporters;
            if (r.Index < 0 || r.Index >= row.Count) return;
            var s = row[r.Index];
            if (s.Sapped) return;
            s.Sapped = true;
            Effects.Log(state, choice.Player, $"{Registry.Card(s.CardId).Name} is sapped.");
        });

        Choices.Register("debt-summon-to-hand", (state, choice, pick) =>
        {
            if (pick.Ref is not { } r || r.Kind != TargetKind.Debt) return;
            var p = state.Players[choice.Player];
            if (r.Index < 0 || r.Index >= p.DebtZone.Count) return;
            var id = p.DebtZone[r.Index];
            Effects.RemoveFromDebt(state, choice.Player, r.Index);
            if (Effects.ToHand(state, choice.Player, id))
            {
                Effects.Log(state, choice.Player,
                    $"{Registry.Card(id).Name} comes back from the debt zone.");
            }
        });

        // Download: the chosen card leaves their debt and arrives rebuilt in Robot.
        Choices.Register("download", (state, choice, pick) =>
        {
            if (pick.Ref is not { } r || r.Kind != TargetKind.Debt) return;
            var zone = state.Players[r.Player].DebtZone;
            if (r.Index < 0 || r.Index >= zone.Count) return;
            var id = zone[r.Index];
            Effects.RemoveFromDebt(state, r.Player, r.Index);
            if (Effects.ToHand(state, choice.Player, Generated.RobotCopy(id)))
            {
                Effects.Log(state, choice.Player,
                    $"{Registry.Card(id).Name} is pulled out of the scrap and rebuilt in Robot.");
            }
        });

        // The Pod's rattle: one chosen revive, then a second with fresh indices.
        Choices.Register("pod-revive", (state, choice, pick) =>
        {
            if (pick.Ref is { } r && r.Kind == TargetKind.Discard)
            {
                var p = state.Players[choice.Player];
                if (r.Index >= 0 && r.Index < p.Discard.Count)
                {
                    var id = p.Discard[r.Index];
                    p.Discard.RemoveAt(r.Index);
                    if (Effects.ToHand(state, choice.Player, id))
                    {
                        Effects.Log(state, choice.Player,
                            $"{Registry.Card(id).Name} comes back from the discard pile.");
                    }
                }
            }
            Effects.ChooseBoard(state, choice.Player, choice.Source, "discard-spell-to-hand",
                Effects.DiscardSpellRefs(state, choice.Player), "Return which spell to hand?");
        });

        Choices.Register("discard-spell-to-hand", (state, choice, pick) =>
        {
            if (pick.Ref is not { } r || r.Kind != TargetKind.Discard) return;
            var p = state.Players[choice.Player];
            if (r.Index < 0 || r.Index >= p.Discard.Count) return;
            var id = p.Discard[r.Index];
            p.Discard.RemoveAt(r.Index);
            if (Effects.ToHand(state, choice.Player, id))
            {
                Effects.Log(state, choice.Player,
                    $"{Registry.Card(id).Name} comes back from the discard pile.");
            }
        });

        // Sordid Fruit: the same return, with its draw on the far side of the
        // pick. Drawing beside the choice let a draw that emptied the deck
        // shuffle the discard pile back in, and the refs the choice was built
        // from then named a pile that had moved.
        Choices.Register("sordid-fruit", (state, choice, pick) =>
        {
            var p = state.Players[choice.Player];
            if (pick.Ref is { Kind: TargetKind.Discard } r
                && r.Index >= 0 && r.Index < p.Discard.Count)
            {
                var id = p.Discard[r.Index];
                p.Discard.RemoveAt(r.Index);
                if (Effects.ToHand(state, choice.Player, id))
                {
                    Effects.Log(state, choice.Player,
                        $"{Registry.Card(id).Name} comes back from the discard pile.");
                }
            }
            Effects.DrawCards(state, choice.Player, 1);
        });

        // The other halves of Digital Rabbits, Fabricate and Living Spell.
        Choices.Register("rabbits", (state, choice, pick) =>
        {
            var cards = new List<string>(choice.Cards ?? Array.Empty<string>());
            var p = state.Players[choice.Player];
            if (pick.Index is { } i)
            {
                var id = cards[i];
                cards.RemoveAt(i);
                int slot = Array.FindIndex(p.Slots, x => x is null);
                if (slot < 0) Effects.ToHand(state, choice.Player, id);
                else Effects.PutSummonDirect(state, choice.Player, id, slot, 2, Color.R, 3, 2);
            }
            p.Deck.AddRange(cards);
        });

        Choices.Register("fabricate", (state, choice, pick) =>
        {
            var cards = new List<string>(choice.Cards ?? Array.Empty<string>());
            var p = state.Players[choice.Player];
            if (pick.Index is { } i)
            {
                var id = cards[i];
                cards.RemoveAt(i);
                int slot = Array.FindIndex(p.Slots, x => x is null);
                if (slot < 0) Effects.ToHand(state, choice.Player, id);
                else
                {
                    Effects.PutSummonDirect(state, choice.Player, id, slot, 0, Color.R,
                        Registry.Card(id).Hp + 2, asPrinted: true);
                }
            }
            p.Deck.AddRange(cards);
        });

        Choices.Register("living-spell", (state, choice, pick) =>
        {
            var cards = new List<string>(choice.Cards ?? Array.Empty<string>());
            var p = state.Players[choice.Player];
            if (pick.Index is { } i && choice.At is { } at)
            {
                var id = cards[i];
                cards.RemoveAt(i);
                var self = state.Find(at);
                if (self is null) Effects.ToHand(state, choice.Player, id);
                else
                {
                    p.Discard.Add(id);
                    self.CardId = Generated.LivingSummon(id, Registry.Card(id).Cost.Total, 6, 2);
                    Effects.Log(state, choice.Player,
                        $"{Registry.Card(id).Name} stands up and looks around.");
                }
            }
            p.Deck.AddRange(cards);
        });

        // The draw lands before this fires, so a freshly drawn card is pickable.
        Choices.Register("stack-hp-from-hand", (state, choice, pick) =>
        {
            if (pick.Ref is not { Kind: TargetKind.Hand } h) return;
            if (choice.At is not { } at || state.Find(at) is not { } body) return;
            var hand = state.Players[choice.Player].Hand;
            if (h.Index < 0 || h.Index >= hand.Count) return;
            var id = hand[h.Index];
            hand.RemoveAt(h.Index);
            body.Hp.Add(new HpCard { CardId = id, Flipped = false });
            Effects.Log(state, choice.Player,
                $"A card from hand slides under {Registry.Card(body.CardId).Name} as HP.");
        });
    }
}
