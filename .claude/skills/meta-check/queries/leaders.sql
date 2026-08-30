-- Every leader by win rate, with its identity and sample size.
select leader||'~'||colour||'~'||count(*)||'~'||round(100.0*avg(won),2)
    ||'~'||round(avg(turns),2) row
from pg group by leader, colour having count(*)>=200 order by avg(won) desc
