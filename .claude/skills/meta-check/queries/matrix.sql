-- Mono colour vs mono colour. Row beats column.
select me||'~'||round(100.0*avg(case when oppcolour='P' then won end),1)
    ||'~'||round(100.0*avg(case when oppcolour='O' then won end),1)
    ||'~'||round(100.0*avg(case when oppcolour='R' then won end),1)
    ||'~'||round(100.0*avg(case when oppcolour='S' then won end),1)
    ||'~'||round(100.0*avg(case when oppcolour='F' then won end),1)
    ||'~'||round(100.0*avg(case when oppcolour='N' then won end),1)
    ||'~'||round(100.0*avg(won),1) row
from (select colour me, oppcolour, won from pg where length(colour)=1)
group by me order by avg(won) desc
