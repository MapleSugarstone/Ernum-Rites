-- One colour vs two vs three vs neutral.
select (case when colour='N' then 'neutral' else length(colour)||' colour' end)||'~'
    ||count(*)||'~'||round(100.0*avg(won),2)||'~'||round(avg(turns),2) row
from pg group by (case when colour='N' then 'neutral' else length(colour)||' colour' end)
