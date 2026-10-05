// Names in games are short/full display names; teams also have espn_abbr.
// Only known NFL plural nicknames receive "les". Unknown future names do not.
const clubs = [
 ['ARI','Cardinals'],['ATL','Falcons'],['BAL','Ravens'],['BUF','Bills'],
 ['CAR','Panthers'],['CHI','Bears'],['CIN','Bengals'],['CLE','Browns'],
 ['DAL','Cowboys'],['DEN','Broncos'],['DET','Lions'],['GB','Packers'],
 ['HOU','Texans'],['IND','Colts'],['JAX','Jaguars'],['KC','Chiefs'],
 ['LAC','Chargers'],['LAR','Rams'],['LV','Raiders'],['MIA','Dolphins'],
 ['MIN','Vikings'],['NE','Patriots'],['NO','Saints'],['NYG','Giants'],
 ['NYJ','Jets'],['PHI','Eagles'],['PIT','Steelers'],['SEA','Seahawks'],
 ['SF','49ers'],['TB','Buccaneers'],['TEN','Titans'],['WAS','Commanders'],
];
export function frenchTeam(value) {
 const name=String(value??'').trim();
 if(!name||name==='son adversaire')return 'son adversaire';
 if(/^(?:les?|la|l[’']|son|sa)\b/i.test(name)||/^l[’']/i.test(name))return name;
 const normalized=name.toLowerCase(),alias=normalized==='wsh'?'was':normalized==='jac'?'jax':normalized;
 const team=clubs.find(([abbr,nickname])=>abbr.toLowerCase()===alias||normalized===nickname.toLowerCase()||normalized.endsWith(' '+nickname.toLowerCase()));
 return team?`les ${team[1]}`:`l’équipe « ${name} »`;
}
export function finalRatingMessage(name,opponent,ratingText){
 return `${name} a conclu son match contre ${frenchTeam(opponent)} avec un passer rating de ${ratingText}.`;
}
