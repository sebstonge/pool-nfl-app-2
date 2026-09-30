import { RoundError } from './rounds.mjs';
import { finalWinner } from './scoring.mjs';
const number = raw => raw!==null&&raw!==undefined&&String(raw).trim()!==''&&Number.isFinite(Number(raw))?Number(raw):null;
export function passerRating({attempts,completions,yards,touchdowns,interceptions}) {
  if(![attempts,completions,yards,touchdowns,interceptions].every(Number.isFinite)||attempts<0||completions<0||completions>attempts||touchdowns<0||interceptions<0)return null;
  if(attempts===0)return 0;
  const cap=n=>Math.min(2.375,Math.max(0,n));
  return Number(((cap((completions/attempts-.3)*5)+cap((yards/attempts-3)*.25)+cap(touchdowns/attempts*20)+cap(2.375-interceptions/attempts*25))/6*100).toFixed(1));
}
// Adapter for the existing ESPN summary/boxscore source. Absence from passing
// is NOT proof of zero snaps. Unsupported/missing participation fails closed.
export function summaryQuarterbacks(summary,teamAbbr) {
  const norm=s=>String(s||'').toUpperCase().replace(/^WSH$/,'WAS');
  const teams=(summary?.boxscore?.players||[]).filter(p=>norm(p.team?.abbreviation)===norm(teamAbbr));
  if(teams.length!==1)throw new RoundError('Statistiques QB : correspondance équipe ambiguë.');
  const categories=teams[0].statistics||[],passing=categories.find(c=>c.name==='passing');
  const players=new Map();
  for(const category of categories){
    const labels=(category.labels||category.names||[]).map(s=>String(s).toUpperCase());
    for(const row of category.athletes||[]){
      const id=String(row.athlete?.id||'');if(!id)continue;
      const p=players.get(id)||{id,name:row.athlete.displayName,team_abbr:teamAbbr,snaps:null,played:false,rating:null};
      const stat=key=>number(row.stats?.[labels.indexOf(key)]);
      // Only explicit offensive snaps, never ambiguous total/special-team snaps.
      const snaps=stat('OFF SNAPS')??stat('OFFENSIVE SNAPS');if(snaps!==null)p.snaps=snaps;
      if(row.didNotPlay===true)p.snaps=0;
      if(category===passing){
        const ca=String(row.stats?.[labels.indexOf('C/ATT')]||'').split('/').map(number);
        const attempts=stat('ATT')??ca[1],completions=stat('CMP')??stat('C')??ca[0];
        const sacks=number(String(row.stats?.[labels.indexOf('SACKS')]||'').split('-')[0]);
        if(attempts>0 || sacks>0)p.played=true;
        p.rating=stat('RTG')??stat('RAT')??stat('RATE')??passerRating({attempts,completions,yards:stat('YDS'),touchdowns:stat('TD'),interceptions:stat('INT')});
        p.passingOrder=passing.athletes.indexOf(row);
      }
      if(category.name==='rushing'&&(stat('CAR')>0||stat('ATT')>0))p.played=true;
      players.set(id,p);
    }
  }
  return [...players.values()];
}
export function resolveQB(selected,players,game) {
  if(!finalWinner(game))throw new RoundError('Rating réservé aux matchs FINAL.');
  const chosen=selected.espn_athlete_id?players.find(p=>p.id===String(selected.espn_athlete_id)):
    players.filter(p=>p.name?.trim().toLowerCase()===selected.name?.trim().toLowerCase()).length===1?
      players.find(p=>p.name?.trim().toLowerCase()===selected.name?.trim().toLowerCase()):null;
  if(!chosen)throw new RoundError('Participation du QB sélectionné non confirmée.');
  const played=chosen.snaps>0||chosen.played===true;
  if(chosen.snaps===0&&chosen.played)throw new RoundError('Participation QB contradictoire.');
  if(!played&&chosen.snaps!==0)throw new RoundError('Zéro snap non confirmé : aucun DNP déduit.');
  // Same first-passer fallback as regular, but ONLY after proven DNP.
  const actual=played?chosen:[...players].filter(p=>(p.snaps>0||p.played)&&Number.isFinite(p.rating))
    .sort((a,b)=>(a.passingOrder??Infinity)-(b.passingOrder??Infinity))[0];
  if(!actual||!Number.isFinite(actual.rating)||actual.rating<0||actual.rating>158.3)throw new RoundError('Rating QB incomplet.');
  return {selected_qb_id:selected.id,actual_espn_athlete_id:actual.id,actual_qb_name:actual.name,team:selected.team,
    passer_rating:actual.rating,consumed:played,dnp:!played,game_id:game.id,participation:played?'played':'zero_offensive_snaps'};
}
