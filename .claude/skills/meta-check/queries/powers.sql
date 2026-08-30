-- The blind-spot query: for every card with a Power, how often the bot fires it
-- and what the game does either way. A big gap with a low fire rate means the
-- card is being misplayed, not that it is weak.
with onboard as (select distinct game, seat, card from bd where card is not null),
     fired as (select distinct game, seat, card from ev
               where type='ActivatePower' and power is not null and power<>''),
     j as (select o.card, o.game, o.seat, (f.game is not null) used, p.won
           from onboard o
           left join fired f on f.game=o.game and f.seat=o.seat and f.card=o.card
           join pg p on p.game=o.game and p.seat=o.seat)
select card||'~'||count(*)||'~'||round(100.0*avg(used),1)
    ||'~'||round(100.0*avg(case when used then won end),1)
    ||'~'||round(100.0*avg(case when not used then won end),1) row
from j group by card having count(*)>=1500 and sum(used)>=200
