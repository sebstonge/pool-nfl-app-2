"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import BottomNav from "../components/BottomNav";

function shortName(email) {
  if (!email) return "—";
  return email.split("@")[0];
}

function RatingBlock({ type, rating }) {
  if (!rating) {
    return <div style={{ color: "#9ca3af" }}>Aucun rating</div>;
  }

  const isBest = type === "best";

  return (
    <div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 900,
          color: isBest ? "#22c55e" : "#ef4444",
        }}
      >
        {isBest ? "🔥" : "❄️"} {Number(rating.passer_rating).toFixed(1)}
      </div>

      <div style={{ color: "#cbd5e1", marginTop: 4 }}>
        Semaine {rating.week}
      </div>

      <div style={{ color: "#94a3b8", marginTop: 4 }}>
        Sélectionné par {rating.selected_by || "—"}
      </div>
    </div>
  );
}

export default function QBRatingsPage() {
  const [rows, setRows] = useState([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function loadData() {
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
              selected_by: shortName(user?.email),
            };
          };

          return {
            qb,
            best: attachSelector(best),
            worst: attachSelector(worst),
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

  return (
    <main className="page" style={{ maxWidth: 1200 }}>
      <section
        className="header-card"
        style={{
          background: "linear-gradient(135deg, #020617, #0f172a)",
        }}
      >
        <h1>QB Ratings 📊</h1>
        <p>Meilleur et pire passer rating de chaque QB cette saison.</p>
      </section>

      {message && (
        <section className="card">
          <p>{message}</p>
        </section>
      )}

      <section
        style={{
          background: "#020617",
          color: "white",
          borderRadius: 20,
          padding: 20,
          border: "1px solid #1f2937",
          boxShadow: "0 12px 30px rgba(0,0,0,0.25)",
          overflowX: "auto",
        }}
      >
        <h2 style={{ marginTop: 0, color: "#22c55e" }}>
          📈 Passer ratings par QB
        </h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "60px 110px minmax(180px, 1.2fr) minmax(220px, 1fr) minmax(220px, 1fr)",
            gap: 12,
            padding: "12px 0",
            borderBottom: "1px solid #334155",
            color: "#94a3b8",
            fontWeight: 800,
            minWidth: 850,
          }}
        >
          <div>#</div>
          <div>Équipe</div>
          <div>QB</div>
          <div>Meilleur rating</div>
          <div>Pire rating</div>
        </div>

        {rows.map((row, index) => (
          <div
            key={row.qb.id}
            style={{
              display: "grid",
              gridTemplateColumns:
                "60px 110px minmax(180px, 1.2fr) minmax(220px, 1fr) minmax(220px, 1fr)",
              gap: 12,
              alignItems: "center",
              padding: "18px 0",
              borderBottom:
                index === rows.length - 1 ? "none" : "1px solid #1e293b",
              minWidth: 850,
            }}
          >
            <div>
              <span
                style={{
                  display: "inline-flex",
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  alignItems: "center",
                  justifyContent: "center",
                  background: index < 3 ? "#166534" : "#1e293b",
                  color: "white",
                  fontWeight: 900,
                }}
              >
                {index + 1}
              </span>
            </div>

            <div>
              {row.qb.logo ? (
                <img
                  src={row.qb.logo}
                  alt={row.qb.team}
                  style={{
                    width: 76,
                    height: 76,
                    objectFit: "contain",
                  }}
                />
              ) : (
                <strong>{row.qb.team}</strong>
              )}
            </div>

            <div>
              <strong style={{ fontSize: 20 }}>{row.qb.name}</strong>

              <p
                style={{
                  margin: "4px 0 0 0",
                  color: "#94a3b8",
                }}
              >
                {row.qb.team}
              </p>
            </div>

            <RatingBlock type="best" rating={row.best} />

            <RatingBlock type="worst" rating={row.worst} />
          </div>
        ))}
      </section>

      <BottomNav />
    </main>
  );
}
