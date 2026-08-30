-- Every colour identity: win rate, game length, how it wins and how it dies.
select colour||'~'||count(*)||'~'||round(100.0*avg(won),2)||'~'||round(avg(turns),2)
    ||'~'||round(100.0*avg(case when won=1 then reason='leader' end),1)
    ||'~'||round(100.0*avg(case when won=0 then reason='leader' end),1) row
from pg group by colour order by avg(won) desc
