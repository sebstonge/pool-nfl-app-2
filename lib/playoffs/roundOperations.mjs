import { ROUNDS, RoundError, currentRound, expectedMatchups, frozenSeeds, official, assertMatchups, roundSummary } from './rounds.mjs';
import { discoverGames, gameUpdate } from './roundEspn.mjs';
async function read(query) {
  const {data,error} = await query;
  if (error) throw new Error(error.message);
  return data || [];
}
export async function readRoundData(client,season) {
  const [seeds,rounds] = await Promise.all([
    read(client.from('playoff_seeds').select('*').eq('season',season)),
    read(client.from('playoff_rounds').select('*').eq('season',season).order('round_order')),
  ]);
  const games = rounds.length ? await read(client.from('playoff_games').select('*').in('round_id',rounds.map(r=>r.id)).order('id')) : [];
  const data = {season,seeds,rounds,games};
  const summary = roundSummary(data);
  const ids = summary.games.filter(official).map(g=>g.id);
  const picks = [];
  if (ids.length) {
    for (let offset=0; ; offset+=1000) {
      const page=await read(client.from('playoff_picks').select('user_id,game_id').in('game_id',ids).order('id').range(offset,offset+999));
      picks.push(...page);
      if (page.length<1000) break;
    }
  }
  const users = new Map();
  for (const p of picks) {if(!users.has(p.user_id))users.set(p.user_id,new Set());users.get(p.user_id).add(p.game_id);}
  // Match choices only: never imply QB/path submission completeness.
  data.completeMatchParticipants = ids.length === summary.definition.count
    ? [...users.values()].filter(set=>set.size===ids.length).length : 0;
  return data;
}
export async function manageRound(client,{action,season,roundKey},fetcher=fetch) {
  const data = await readRoundData(client,season);
  if (action === 'read') return {data};
  frozenSeeds(data.seeds,season);
  const current = currentRound(data.rounds);
  if (roundKey !== current.round_key) throw new RoundError('La ronde active a changé. Relis les données avant de continuer.');
  if (data.rounds.some(r => r.status === 'scored')) throw new RoundError('Une ronde scorée nécessite le futur workflow de scoring.');
  if (action==='prepare' && roundKey!=='wild_card') throw new RoundError('Seul le Wild Card possède une initialisation. Utilise le passage à la ronde suivante.');
  const index = ROUNDS.findIndex(r=>r.key===roundKey);
  if (data.rounds.some(r=>r.round_order<index+1 && r.status!=='finalized') ||
      data.rounds.some(r=>r.round_order>index+1 && r.status!=='draft')) throw new RoundError('Les états des rondes ne forment pas une progression cohérente.');
  const currentGames = data.games.filter(g=>g.round_id===current.id);
  if (currentGames.some(g=>!official(g))) throw new RoundError('Matchs TEST ou non officiels présents : données conservées, opération refusée.');
  if (action==='prepare' && current.status==='draft' && currentGames.length) throw new RoundError('Le Wild Card contient déjà des matchs. Initialisation refusée pour préserver les données.');
  let targetKey=roundKey, payload=[], warnings=[];
  const teams = await read(client.from('teams').select('name,espn_abbr'));
  if(action === 'update') {
    if (!['open','locked'].includes(current.status)) throw new RoundError('La ronde doit être ouverte ou verrouillée.');
    assertMatchups(currentGames,expectedMatchups(data.seeds,season,roundKey,data.rounds,data.games),roundKey);
    const updates = await Promise.all(currentGames.map(async g=>{
      try{return await gameUpdate(g,{season,seeds:data.seeds,teams,fetcher});}
      catch{warnings.push(`${g.away_team} / ${g.home_team} : réponse ESPN indisponible ou invalide, valeurs conservées.`);return null;}
    }));
    payload=updates.filter(Boolean);
  } else {
    if (action === 'advance') {
      if (!['open','locked'].includes(current.status) || index === 3) throw new RoundError('Aucune ronde suivante disponible.');
      targetKey=ROUNDS[index+1].key;
    } else if (action !== 'prepare') throw new RoundError('Action inconnue.');
    const expected=expectedMatchups(data.seeds,season,targetKey,data.rounds,data.games);
    if (action==='prepare' && ['open','locked'].includes(current.status)) {
      assertMatchups(currentGames,expected,roundKey);
      return {data,message:'Ronde déjà ouverte : aucun doublon créé.'};
    }
    if (action==='prepare' && current.status!=='draft') throw new RoundError('Cette ronde ne peut pas être préparée.');
    const target=data.rounds.find(r=>r.round_key===targetKey);
    if (target && data.games.some(g=>g.round_id===target.id && !official(g))) throw new RoundError('La ronde cible contient des matchs TEST ou non officiels. Aucune donnée modifiée.');
    payload=await discoverGames({season,key:targetKey,expected,seeds:data.seeds,teams,fetcher});
  }
  const {error} = await client.rpc('manage_playoff_round',{
    p_season:season,p_action:action,p_round_key:roundKey,p_games:payload,
    p_expected:{rounds:data.rounds,games:data.games},
  });
  if (error) {
    if (['PGRST202','42883'].includes(error.code)) throw new RoundError('La migration de gestion des rondes doit être installée avant cette action.');
    throw new RoundError('Opération refusée : données modifiées ou ronde incompatible. Relis le snapshot; aucune transition partielle n’a été enregistrée.');
  }
  return {data:await readRoundData(client,season),warnings,message:action==='update'?'Mise à jour terminée, sans calcul de points.':action==='advance'?'Ronde suivante ouverte.':'Ronde ouverte.'};
}
