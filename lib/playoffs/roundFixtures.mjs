// Synthetic fixtures only. Never submitted to a remote database.
export const fixtureSeeds = () => ['AFC','NFC'].flatMap((conference,c)=>Array.from({length:7},(_,i)=>({
  season:2099,team:`${conference}${i+1}`,espn_team_id:String(c*10+i+1),conference,seed:i+1,
  captured_at:'2099-01-01T00:00:00Z',finalized_at:'2099-01-02T00:00:00Z',
})));
export const fixtureTeams = () => fixtureSeeds().map(s=>({name:s.team,espn_abbr:s.team}));
export function fixtureSchedule(matchups,key='wild_card') {
  const seeds=fixtureSeeds(); const week={wild_card:1,divisional:2,conference:3,super_bowl:5}[key];
  return {season:{year:2099,type:3},week:{number:week},events:matchups.map((p,i)=>({
    id:String(900+i),season:{year:2099,type:3},week:{number:week},date:'2100-01-10T18:00:00Z',
    competitions:[{date:'2100-01-10T18:00:00Z',timeValid:true,status:{type:{state:'pre',completed:false}},
      competitors:['home','away'].map(side=>({homeAway:side,team:{id:seeds.find(s=>s.team===p[`${side}_team`]).espn_team_id,abbreviation:p[`${side}_team`]},score:'0'}))}],
  }))};
}
export const response = data => async()=>({ok:true,json:async()=>data});
