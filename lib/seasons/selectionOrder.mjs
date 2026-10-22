import {initialOrder} from './regularClient.mjs';

function scoreValue(value) {
  if (!['number','string'].includes(typeof value) || String(value).trim()==='') return null;
  const score=Number(value);
  return Number.isFinite(score) ? score : null;
}

function weekNumber(value) {
  const week=Number(value);
  if (!Number.isInteger(week) || week<1) throw new Error('Semaine de sélection invalide.');
  return week;
}

// Compare sums of persisted decimal scores exactly (0.1 + 0.2 equals 0.3).
// These integer keys are used only for ordering; no stored score is rounded.
function decimalScore(value) {
  const [mantissa,exponent='0']=String(value).toLowerCase().split('e');
  return {units:BigInt(mantissa.replace('.','')),scale:(mantissa.split('.')[1]?.length || 0)-Number(exponent)};
}

// PostgreSQL stores microseconds; Date.parse alone would merge distinct picks.
function selectedAt(value) {
  if (!value) return null;
  const milliseconds=Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  const fraction=String(value).match(/\.(\d+)/)?.[1] || '';
  return milliseconds*1000+Number(fraction.padEnd(6,'0').slice(3,6));
}

// Existing submissions retain the observed order. Missing/identical timestamps
// use the reconstructed order, ultimately initial_order then the stable user ID.
function observedOrder(fallback,week,picks) {
  const times=new Map();
  for (const pick of picks) {
    if (Number(pick.week)!==week) continue;
    const time=selectedAt(pick.created_at);
    if (time!==null) times.set(pick.user_id,time);
  }
  const positions=new Map(fallback.map((p,i)=>[p.id,i]));
  return [...fallback].sort((a,b)=>{
    const x=times.get(a.id),y=times.get(b.id);
    if (x!=null && y!=null && x!==y) return x-y;
    if (x!=null && y==null) return -1;
    if (x==null && y!=null) return 1;
    return positions.get(a.id)-positions.get(b.id);
  });
}

// Pure regular-season rule. Inputs must belong to one season (regularClient).
// General standing is the cumulative final_score, without a name/rank tie-break.
export function regularOrder(players,week,weeklyScores=[],qbPickHistory=[]) {
  week=weekNumber(week);
  let order=initialOrder(players);
  const weeks=new Map(),totals=new Map(),members=new Set(players.map(p=>p.id));
  let scale=0;
  for (const row of weeklyScores) {
    const number=Number(row.week),score=scoreValue(row.final_score);
    if (!Number.isInteger(number) || number<1 || number>=week || score===null || !members.has(row.user_id)) continue;
    if (!weeks.has(number)) weeks.set(number,new Map());
    weeks.get(number).set(row.user_id,score);
    scale=Math.max(scale,decimalScore(score).scale);
  }
  for (let current=2;current<=week;current++) {
    const previous=current-1,scores=weeks.get(previous) || new Map();
    for (const [id,score] of scores) {
      const decimal=decimalScore(score);
      totals.set(id,(totals.get(id) ?? 0n)+decimal.units*10n**BigInt(scale-decimal.scale));
    }
    const prior=previous===1 ? order : observedOrder(order,previous,qbPickHistory);
    const positions=new Map(prior.map((p,i)=>[p.id,i]));
    order=[...prior].sort((a,b)=>{
      const x=scores.get(a.id),y=scores.get(b.id);
      // A missing score is never a real zero; retain missing scores at the end.
      if (x==null && y!=null) return 1;
      if (x!=null && y==null) return -1;
      if (x!=null && y!=null && x!==y) return x-y;
      const totalA=totals.get(a.id),totalB=totals.get(b.id);
      if (totalA==null && totalB!=null) return 1;
      if (totalA!=null && totalB==null) return -1;
      if (totalA!=null && totalB!=null && totalA!==totalB) return totalA<totalB ? -1 : 1;
      return positions.get(a.id)-positions.get(b.id);
    });
  }
  return order;
}

export function remainingSelectionOrder(order,currentWeekPicks=[]) {
  const submitted=new Set(currentWeekPicks.map(p=>p.user_id));
  return order.filter(p=>!submitted.has(p.id));
}

// Historical timing must not replace a completed week's actual predecessors
// with the new rule applied retroactively. Week 1 still uses its explicit order.
export function historicalRegularOrder(players,week,scores,picks) {
  const order=regularOrder(players,week,scores,picks);
  if (Number(week)===1) return order;
  const times=players.map(player=>selectedAt(picks.find(p=>p.user_id===player.id && Number(p.week)===Number(week))?.created_at));
  // A partial history cannot prove that its first dated pick was first to play.
  return times.every(t=>t!==null) && new Set(times).size===players.length
    ? observedOrder(order,Number(week),picks) : order;
}

export async function loadRegularOrder(client,week,players) {
  week=weekNumber(week);
  if (!players) {
    const result=await client.from('users').select('id, email, display_name, real_name');
    if (result.error) throw result.error;
    players=result.data || [];
  }
  if (week===1) return regularOrder(players,week);
  const [scores,picks]=await Promise.all([
    client.from('weekly_scores').select('user_id,week,final_score').lt('week',week),
    client.from('qb_picks').select('user_id,week,created_at').lt('week',week),
  ]);
  if (scores.error) throw scores.error;
  if (picks.error) throw picks.error;
  return regularOrder(players,week,scores.data || [],picks.data || []);
}

// Re-read at submission time: a cached order in an old tab is not permission.
// The caller supplies the season-pinned regularClient used for its writes.
export async function assertRegularTurn(client,week,userId) {
  const [order,picks,settings]=await Promise.all([
    loadRegularOrder(client,week),
    client.from('qb_picks').select('user_id').eq('week',Number(week)),
    client.from('settings').select('current_week').eq('id',1).single(),
  ]);
  if (picks.error) throw picks.error;
  if (settings.error) throw settings.error;
  if (Number(settings.data?.current_week)!==Number(week)) throw new Error('La semaine a changé. Recharge la page avant de soumettre.');
  if (remainingSelectionOrder(order,picks.data || [])[0]?.id!==userId) {
    throw new Error('Ce n’est pas encore ton tour, ou ton QB est déjà soumis. Recharge la page.');
  }
}
