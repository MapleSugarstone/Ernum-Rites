-- What going first is worth, overall and per colour.
select 'ALL~'||count(*)||'~'||round(100.0*avg(case when onplay=1 then won end),2) row from pg
union all
select colour||'~'||count(*)||'~'||round(100.0*avg(case when onplay=1 then won end),2)
from pg where length(colour)=1 group by colour
