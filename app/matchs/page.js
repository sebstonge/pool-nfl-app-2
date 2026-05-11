"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import BottomNav from "../components/BottomNav";

function getPickBadge(game, pick) {
  if (game.home_score == null || game.away_score == null) return "⚪";

  const winner =
    game.home_score > game.away_score
      ? game.home_team
      : game.away_team;

  const realSpread = Math.abs(
    game.home_score - game.away_score
  );

  if (pick.picked_team !== winner) return "🔴";

  if (
    Number(pick.predicted_spread) === realSpread
  ) {
    return "🟢";
  }

  return "🟡";
}

function TeamLogo({
  logo,
  name,
  selected = false,
  onClick,
  size = 78,
}) {
  const [error, setError] = useState(false);

  return (
    <button
      onClick={onClick}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: selected
          ? "#ffffff"
          : "transparent",
        border: selected
          ? "3px solid #ffffff"
          : "2px solid rgba(148,163,184,0.18)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: onClick ? "pointer" : "default",
        transition: "0.2s",
        boxShadow: selected
          ? "0 0 18px rgba(255,255,255,0.30)"
          : "none",
      }}
    >
      {!error && logo ? (
        <img
          src={logo}
          alt={name}
          width={size - 18}
          height={size - 18}
          onError={() => setError(true)}
          style={{
            objectFit: "contain",
          }}
        />
      ) : (
        <span
          style={{
            color: "#f8fafc",
            fontWeight: 900,
          }}
        >
          {name?.slice(0, 2)}
        </span>
      )}
    </button>
  );
}

function QBPhoto({ qb }) {
  const [error, setError] = useState(false);

  if (!qb?.photo_url || error) {
    return (
      <div
        style={{
          width: 78,
          height: 78,
          borderRadius: "50%",
          background:
            "rgba(148,163,184,0.16)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontWeight: 900,
        }}
      >
        QB
      </div>
    );
  }

  return (
    <img
      src={qb.photo_url}
      alt={qb.name}
      width={78}
      height={78}
      onError={() => setError(true)}
      style={{
        borderRadius: "50%",
        objectFit: "cover",
      }}
    />
  );
}

export default function MatchsPage() {
  const [user, setUser] = useState(null);
  const [week, setWeek] = useState(1);

  const [games, setGames] = useState([]);
  const [submittedPicks, setSubmittedPicks] =
    useState([]);

  const [localPicks, setLocalPicks] =
    useState({});

  const [qbs, setQbs] = useState([]);
  const [selectedQB, setSelectedQB] =
    useState("");

  const [submittedQB, setSubmittedQB] =
    useState(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const currentUser = session?.user;

    if (!currentUser) {
      window.location.href = "/auth";
      return;
    }

    setUser(currentUser);

    const { data: settings } = await supabase
      .from("settings")
      .select("*")
      .single();

    const currentWeek =
      settings?.current_week || 1;

    setWeek(currentWeek);

    const { data: gamesData } = await supabase
      .from("games")
      .select("*")
      .eq("week", currentWeek)
      .eq("is_pool_eligible", true)
      .order("id");

    setGames(gamesData || []);

    const { data: picksData } = await supabase
      .from("picks")
      .select("*")
      .eq("user_id", currentUser.id)
      .eq("week", currentWeek);

    setSubmittedPicks(picksData || []);

    const { data: qbList } = await supabase
      .from("qbs")
      .select("*")
      .order("name");

    setQbs(qbList || []);

    const { data: qbPick } = await supabase
      .from("qb_picks")
      .select(`
        *,
        qbs (*)
      `)
      .eq("user_id", currentUser.id)
      .eq("week", currentWeek)
      .maybeSingle();

    if (qbPick) {
      setSubmittedQB(qbPick);
    }
  }

  function updatePick(gameId, field, value) {
    setLocalPicks((prev) => ({
      ...prev,
      [gameId]: {
        ...prev[gameId],
        [field]: value,
      },
    }));
  }

  async function submitAll() {
    if (!submittedQB && !selectedQB) {
      alert("Choisis un QB.");
      return;
    }

    const gamesToSubmit = games.filter(
      (game) =>
        !submittedPicks.find(
          (p) => p.game_id === game.id
        )
    );

    for (const game of gamesToSubmit) {
      const pick = localPicks[game.id];

      if (
        !pick?.picked_team ||
        !pick?.predicted_spread
      ) {
        alert(
          "Complète tous les matchs."
        );
        return;
      }
    }

    if (!submittedQB && selectedQB) {
      await supabase.from("qb_picks").insert({
        user_id: user.id,
        week,
        qb_id: selectedQB,
      });
    }

    const inserts = gamesToSubmit.map(
      (game) => ({
        user_id: user.id,
        game_id: game.id,
        week,
        picked_team:
          localPicks[game.id]
            ?.picked_team,
        predicted_spread: Number(
          localPicks[game.id]
            ?.predicted_spread
        ),
      })
    );

    if (inserts.length > 0) {
      await supabase
        .from("picks")
        .insert(inserts);
    }

    loadData();
  }

  const submittedIds = submittedPicks.map(
    (p) => p.game_id
  );

  const gamesToPick = games.filter(
    (g) => !submittedIds.includes(g.id)
  );

  return (
    <main className="page">
      <section className="header-card">
        <h1>Mes choix ✅</h1>
        <p>Semaine {week}</p>
      </section>

      {!submittedQB ? (
        <section className="card">
          <h2>QB de la semaine</h2>

          <select
            className="input"
            value={selectedQB}
            onChange={(e) =>
              setSelectedQB(e.target.value)
            }
          >
            <option value="">
              Choisir un QB
            </option>

            {qbs.map((qb) => (
              <option
                key={qb.id}
                value={qb.id}
              >
                {qb.name}
              </option>
            ))}
          </select>
        </section>
      ) : (
        <section
          className="card"
          style={{
            border:
              "1px solid rgba(34,197,94,0.25)",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 18,
              alignItems: "center",
            }}
          >
            <QBPhoto qb={submittedQB.qbs} />

            <div>
              <div
                style={{
                  color: "#22c55e",
                  fontWeight: 900,
                  fontSize: 14,
                }}
              >
                QB
              </div>

              <h2 style={{ margin: 0 }}>
                {submittedQB.qbs?.name}
              </h2>

              <p
                style={{
                  margin: 0,
                  color: "#94a3b8",
                }}
              >
                {submittedQB.qbs?.team}
                {submittedQB.rating != null &&
                  ` — Rating : ${submittedQB.rating}`}
              </p>
            </div>
          </div>
        </section>
      )}

      {gamesToPick.map((game) => {
        const local =
          localPicks[game.id] || {};

        return (
          <section
            key={game.id}
            className="card"
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "1fr auto 1fr",
                alignItems: "center",
                gap: 18,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                }}
              >
                <TeamLogo
                  logo={game.away_logo}
                  name={game.away_team}
                  selected={
                    local.picked_team ===
                    game.away_team
                  }
                  onClick={() =>
                    updatePick(
                      game.id,
                      "picked_team",
                      game.away_team
                    )
                  }
                />
              </div>

              <div
                style={{
                  fontSize: 28,
                  fontWeight: 900,
                }}
              >
                @
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                }}
              >
                <TeamLogo
                  logo={game.home_logo}
                  name={game.home_team}
                  selected={
                    local.picked_team ===
                    game.home_team
                  }
                  onClick={() =>
                    updatePick(
                      game.id,
                      "picked_team",
                      game.home_team
                    )
                  }
                />
              </div>
            </div>

            <input
              type="number"
              className="input"
              placeholder="Écart prédit"
              value={
                local.predicted_spread ||
                ""
              }
              onChange={(e) =>
                updatePick(
                  game.id,
                  "predicted_spread",
                  e.target.value
                )
              }
              style={{ marginTop: 18 }}
            />
          </section>
        );
      })}

      {submittedPicks.map((pick) => {
        const game = games.find(
          (g) => g.id === pick.game_id
        );

        if (!game) return null;

        const awaySelected =
          pick.picked_team ===
          game.away_team;

        const homeSelected =
          pick.picked_team ===
          game.home_team;

        return (
          <section
            key={pick.id}
            className="card"
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "1fr auto 1fr auto auto",
                alignItems: "center",
                gap: 14,
              }}
            >
              <TeamLogo
                logo={game.away_logo}
                name={game.away_team}
                selected={awaySelected}
              />

              <div
                style={{
                  fontSize: 26,
                  fontWeight: 900,
                }}
              >
                @
              </div>

              <TeamLogo
                logo={game.home_logo}
                name={game.home_team}
                selected={homeSelected}
              />

              <div
                style={{
                  fontSize: 28,
                  fontWeight: 900,
                }}
              >
                par{" "}
                {pick.predicted_spread}
              </div>

              <div
                style={{
                  fontSize: 24,
                }}
              >
                {getPickBadge(game, pick)}
              </div>
            </div>

            {game.home_score != null && (
              <div
                style={{
                  marginTop: 14,
                  textAlign: "center",
                  color: "#94a3b8",
                  fontWeight: 700,
                }}
              >
                {game.away_score} -{" "}
                {game.home_score}
                {" • "}
                Écart réel :{" "}
                {Math.abs(
                  game.home_score -
                    game.away_score
                )}
              </div>
            )}
          </section>
        );
      })}

      {(gamesToPick.length > 0 ||
        !submittedQB) && (
        <button
          className="button"
          style={{
            width: "100%",
            marginTop: 12,
          }}
          onClick={submitAll}
        >
          Soumettre mes choix
        </button>
      )}

      <BottomNav />
    </main>
  );
}
