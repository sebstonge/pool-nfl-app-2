// Read-only copy of /matchs selection ordering. Never writes scores or choices.
const WEEK_1_QB_ORDER = [
  "Alexandre",
  "Edouard",
  "Louis-Simon",
  "Séb",
  "Charles",
  "Naomie",
  "Léa",
  "Félix",
  "Carolyne",
  "Mathieu",
  "Katy",
  "Pierre-André",
  "Étienne",
];

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

function getWeek1Order(players) {
  const ordered = [];
  const usedIds = new Set();

  WEEK_1_QB_ORDER.forEach((wantedName) => {
    const wanted = normalizeName(wantedName);

    let player = players.find(
      (p) =>
        !usedIds.has(p.id) &&
        normalizeName(p.real_name) === wanted
    );

    if (!player) {
      player = players.find((p) => {
        if (usedIds.has(p.id)) return false;

        const actual = normalizeName(p.real_name);

        return (
          actual.startsWith(wanted) ||
          wanted.startsWith(actual)
        );
      });
    }

    if (player) {
      ordered.push(player);
      usedIds.add(player.id);
    }
  });

  const leftovers = players
    .filter((p) => !usedIds.has(p.id))
    .sort((a, b) =>
      playerRealName(a).localeCompare(
        playerRealName(b),
        "fr"
      )
    );

  return [...ordered, ...leftovers];
}

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
