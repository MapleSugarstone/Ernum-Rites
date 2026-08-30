-- How each mono colour wins and how it dies, with game length.
select colour||'~'||count(*)||'~'||round(100.0*avg(won),2)||'~'||round(avg(turns),2)
    ||'~'||round(100.0*avg(case when won=1 then reason='leader' end),1)
    ||'~'||round(100.0*avg(case when won=0 then reason='leader' end),1) row
from pg where length(colour)=1 group by colour order by avg(won) desc
