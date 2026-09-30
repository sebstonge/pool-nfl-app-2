// Local-only synthetic 13-game season. Existing reseeding builds every pairing.
import {ROUNDS,expectedMatchups} from './rounds.mjs';
import {fixtureSeeds} from './roundFixtures.mjs';
export function scoringFixture(season=2101) {
  const seeds=fixtureSeeds().map(s=>({...s,season})),rounds=[],games=[],qbs=[];
  const users=['00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000013'];
  const batches=[];
  for(let i=0;i<4;i++){
    const round={id:100+i,season,round_key:ROUNDS[i].key,round_name:ROUNDS[i].name,round_order:i+1,status:'open'};
    const pairs=expectedMatchups(seeds,season,round.round_key,rounds,games);
    const winners=['AFC7','NFC1','AFC3','NFC3','AFC4','NFC4'];
    const current=pairs.map((p,j)=>{
      const winner=winners.find(t=>[p.home_team,p.away_team].includes(t))||p.home_team;
      return {...p,id:1000+i*10+j,round_id:round.id,external_game_id:String(1000+i*10+j),game_date:'2200-01-10T18:00:00Z',game_status:'post',home_score:winner===p.home_team?24:17,away_score:winner===p.away_team?24:17};
    });
    const qb={id:100+i,name:`Fixture QB ${i}`,team:'AFC7',is_active_starter:true,active:true,espn_athlete_id:String(500+i)};qbs.push(qb);
    const normalized=[{id:qb.espn_athlete_id,name:qb.name,team:qb.team,snaps:i===1?0:40,rating:i===1?null:100,passingOrder:0},{id:`${900+i}`,name:'Fixture replacement',team:qb.team,snaps:i===1?40:0,rating:100,passingOrder:1}];
    const paths=users.map((user_id,u)=>({user_id,round_id:round.id,team:u===0?'AFC7':u===1?'NFC1':i===3?'AFC7':'AFC3'}));
    const picks=users.flatMap((user_id,u)=>current.map((g,j)=>({user_id,game_id:g.id,picked_team:[g.home_team,g.away_team].includes(paths[u].team)?paths[u].team:j===current.length-1?g.away_team:g.home_team,predicted_spread:j%2?3:7})));
    batches.push({round,games:current.map(g=>({...g,external_game_id:`TEST-${g.external_game_id}`,test_qb_results:g.home_team===qb.team||g.away_team===qb.team?normalized:[]})),paths,picks,qbPicks:users.map(user_id=>({user_id,round_id:round.id,qb_id:qb.id}))});
    rounds.push(round);games.push(...current);
  }
  return {seeds,users,qbs,batches};
}
