-- Average board state per colour across every turn of every game.
select colour||'~'||round(avg(bodies),2)||'~'||round(avg(debt),2)||'~'||round(avg(hand),2)
    ||'~'||round(avg(deck),1)||'~'||round(avg(leaderhp),2)||'~'||round(avg(deckouts),3) row
from bd where length(colour)=1 and slot=0 group by colour order by avg(bodies) desc
