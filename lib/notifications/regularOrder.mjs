import {initialOrder} from "../seasons/regularClient.mjs";
// Read-only copy of /matchs selection ordering. Never writes scores or choices.


function normalizeName(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function playerRealName(player) {
  return (
    player?.real_name ||
    player?.display_name ||
    player?.email?.split("@")[0] ||
    "Joueur"
  );
}

function getWeek1Order(players) { return initialOrder(players); }

function getWeeklyScoreValue(row) {
  const candidates = [
    row?.total_score,
    row?.final_score,
    row?.weekly_score,
    row?.score,
    row?.points,
    row?.total,
  ];

  for (const value of candidates) {
    if (
      value !== null &&
      value !== undefined &&
      value !== "" &&
      Number.isFinite(Number(value))
    ) {
      return Number(value);
    }
  }

  return null;
}

export function regularOrder(players,week,previousScores){
 if(Number(week)===1)return getWeek1Order(players);
 const scores=Object.fromEntries(previousScores.map(r=>[r.user_id,getWeeklyScoreValue(r)]));
 return [...players].sort((a,b)=>{
  const x=scores[a.id],y=scores[b.id];
  if(x==null&&y==null)return playerRealName(a).localeCompare(playerRealName(b),'fr');
  if(x==null)return 1;if(y==null)return -1;
  return x-y||playerRealName(a).localeCompare(playerRealName(b),'fr');
 });
}
