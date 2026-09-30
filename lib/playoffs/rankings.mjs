// Sporting comparison is separate from deterministic display order.
export function cumulativeComparison(a,b){
  return b.cumulative_score-a.cumulative_score || a.cumulative_margin_error-b.cumulative_margin_error ||
    (a.super_bowl_total_error??Infinity)-(b.super_bowl_total_error??Infinity) || 0;
}
export function competitionRanks(rows,compare,field){
  const sorted=[...rows].sort((a,b)=>compare(a,b)||String(a.user_id).localeCompare(String(b.user_id)));
  let rank=0;
  return sorted.map((row,i)=>{if(i===0||compare(sorted[i-1],row)!==0)rank=i+1;return {...row,[field]:rank};});
}
export function validateSuperBowlTotal(roundKey,value){
  if(roundKey!=='super_bowl'){
    if(value!=null)throw new Error('Total de points réservé au Super Bowl.');
    return null;
  }
  if(!Number.isInteger(value)||value<0||value>2147483647)throw new Error('Total Super Bowl entier positif ou nul requis.');
  return value;
}
