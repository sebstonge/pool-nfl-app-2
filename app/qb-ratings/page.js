"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import BottomNav from "../components/BottomNav";

function displayName(user) {
  if (user?.display_name) return user.display_name;
  if (user?.email) return user.email.split("@")[0];
  return "—";
}

function getQbHeadshot(qb) {
  if (!qb?.espn_athlete_id) return null;
  return `https://a.espncdn.com/i/headshots/nfl/players/full/${qb.espn_athlete_id}.png`;
}

function QBPhoto({ qb, size = 96 }) {
  const [error, setError] = useState(false);
  const src = getQbHeadshot(qb);

  if (!src || error) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 22,
          background: "rgba(148,163,184,0.16)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 900,
          color: "#f8fafc",
        }}
      >
        QB
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={qb.name}
      onError={() => setError(true)}
      style={{
        width: size,
        height: size,
        objectFit: "contain",
      }}
    />
  );
}

function TeamLogo({ logo, name, size = 54 }) {
  const [error, setError] = useState(false);

  if (!logo || error) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 16,
          background: "rgba(148,163,184,0.16)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 900,
          color: "#f8fafc",
        }}
      >
        {name?.slice(0, 2)}
      </div>
    );
  }

  return (
    <img
      src={logo}
      alt={name}
      onError={() => setError(true)}
      style={{
        width: size,
        height: size,
        objectFit: "contain",
      }}
    />
  );
}

function RatingMiniCard({ label, type, rating }) {
  const isBest = type === "best";

  if (!rating) {
    return (
      <div
        style={{
          padding: 14,
          borderRadius: 18,
          background: "rgba(148,163,184,0.08)",
          border: "1px solid rgba(148,163,184,0.14)",
        }}
      >
        <p style={{ margin: 0, color: "#94a3b8", fontWeight: 900 }}>
          {label}
        </p>
        <h3 style={{ margin: "8px 0 0 0" }}>Aucun rating</h3>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 14,
        borderRadius: 18,
        background: isBest
          ? "rgba(34,197,94,0.08)"
          : "rgba(239,68,68,0.08)",
        border: isBest
          ? "1px solid rgba(34,197,94,0.22)"
          : "1px solid rgba(239,68,68,0.22)",
      }}
    >
      <p
        style={{
          margin: 0,
          color: isBest ? "#22c55e" : "#ef4444",
          fontWeight: 900,
        }}
      >
        {label}
      </p>

      <h2
        style={{
          margin: "6px 0",
          fontSize: 30,
          color: isBest ? "#22c55e" : "#ef4444",
        }}
      >
        {Number(rating.passer_rating).toFixed(1)}
      </h2>

      <p style={{ margin: 0, color: "#94a3b8" }}>
        Semaine {rating.week} — {rating.selected_by || "—"}
      </p>
    </div>
  );
}

export default function QBRatingsPage() {
  const [rows, setRows] = useState([]);
  const [teams, setTeams] = useState([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function loadData() {
      const { data: teamsData } = await supabase.from("teams").select("*");
      setTeams(teamsData || []);

      const { data: usersData } = await supabase.from("users").select("*");

      const { data: qbsData, error: qbsError } = await supabase
        .from("qbs")
        .select("*")
        .order("team", { ascending: true });

      if (qbsError) {
        setMessage("Erreur QB : " + qbsError.message);
        return;
      }

      const { data: ratingsData, error: ratingsError } = await supabase
        .from("qb_ratings")
        .select("*");

      if (ratingsError) {
        setMessage("Erreur ratings : " + ratingsError.message);
        return;
      }

      const { data: qbPicksData, error: picksError } = await supabase
        .from("qb_picks")
        .select("*");

      if (picksError) {
        setMessage("Erreur picks QB : " + picksError.message);
        return;
      }

      const builtRows = (qbsData || [])
        .map((qb) => {
          const qbRatings = (ratingsData || []).filter(
            (r) => r.qb_id === qb.id && r.passer_rating != null
          );

          const best =
            [...qbRatings].sort(
              (a, b) => Number(b.passer_rating) - Number(a.passer_rating)
            )[0] || null;

          const worst =
            [...qbRatings].sort(
              (a, b) => Number(a.passer_rating) - Number(b.passer_rating)
            )[0] || null;

          const attachSelector = (rating) => {
            if (!rating) return null;

            const pick = (qbPicksData || []).find(
              (p) => p.qb_id === qb.id && p.week === rating.week
            );

            const user = (usersData || []).find((u) => u.id === pick?.user_id);

            return {
              ...rating,
             selected_by: displayName(user),
            };
          };

          const average =
  qbRatings.length > 0
    ? qbRatings.reduce(
        (sum, rating) =>
          sum + Number(rating.passer_rating || 0),
        0
      ) / qbRatings.length
    : null;

return {
  qb,
  best: attachSelector(best),
  worst: attachSelector(worst),
  average,
};
        })
        .filter((row) => row.best || row.worst)
        .sort((a, b) => {
          const aBest = Number(a.best?.passer_rating || 0);
          const bBest = Number(b.best?.passer_rating || 0);
          return bBest - aBest;
        });

      setRows(builtRows);
    }

    loadData();
  }, []);

  const getTeamLogo = (teamName) => {
    const team = teams.find(
      (t) =>
        t.name?.toLowerCase().trim() === teamName?.toLowerCase().trim()
    );

    return team?.espn_abbr
      ? `https://a.espncdn.com/i/teamlogos/nfl/500/${team.espn_abbr.toLowerCase()}.png`
      : team?.logo || null;
  };

  return (
    <main className="page" style={{ maxWidth: 1100 }}>
      <section className="header-card">
        <h1>QB Ratings 📊</h1>
        <p>Meilleur et pire passer rating de chaque QB cette saison.</p>
      </section>

      {message && (
        <section className="card">
          <p>{message}</p>
        </section>
      )}

      {rows.length === 0 && (
        <section className="card">
          <p>Aucun rating QB pour le moment.</p>
        </section>
      )}

      {rows.map((row, index) => (
        <section key={row.qb.id} className="card">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "54px 110px 1fr",
              gap: 16,
              alignItems: "center",
              marginBottom: 16,
            }}
          >
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 14,
                background: index < 3 ? "#166534" : "#1e293b",
                color: "white",
                fontWeight: 900,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              #{index + 1}
            </div>

            <QBPhoto qb={row.qb} size={104} />

            <div>
              <h2 style={{ margin: 0 }}>{row.qb.name}</h2>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginTop: 8,
                  color: "#94a3b8",
                }}
              >
                <TeamLogo
                  logo={getTeamLogo(row.qb.team)}
                  name={row.qb.team}
                  size={42}
                />
                <strong>{row.qb.team}</strong>
              </div>
            </div>
          </div>

          <div
         style={{
  display: "grid",
  gridTemplateColumns:
    typeof window !== "undefined" && window.innerWidth < 900
      ? "1fr"
      : "repeat(3, minmax(0, 1fr))",
  gap: 10,
}}
          >
   <RatingMiniCard
  label="Meilleur rating"
  type="best"
  rating={row.best}
/>

<div
  style={{
    padding:
  typeof window !== "undefined" && window.innerWidth < 900
    ? 12
    : 10,
    borderRadius: 18,
    background: "rgba(148,163,184,0.08)",
    border: "1px solid rgba(148,163,184,0.16)",
  }}
>
  <p
    style={{
      margin: 0,
      color: "#94a3b8",
      fontWeight: 900,
    }}
  >
    Moyenne saison
  </p>

  <h2
    style={{
      margin: "6px 0",
      fontSize: 30,
      color: "#e2e8f0",
    }}
  >
    {row.average != null
      ? row.average.toFixed(1)
      : "--"}
  </h2>

  <p style={{ margin: 0, color: "#94a3b8" }}>
    Toutes les semaines
  </p>
</div>

<RatingMiniCard
  label="Pire rating"
  type="worst"
  rating={row.worst}
/>
          </div>
        </section>
      ))}

      <BottomNav />
    </main>
  );
}
