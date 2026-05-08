"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

function QBLogo({ qb }) {
  const [hasError, setHasError] = useState(false);

  if (!qb?.logo || hasError) {
    return (
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 16,
          background: "rgba(148,163,184,0.16)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 900,
        }}
      >
        {qb?.name?.slice(0, 2) || "QB"}
      </div>
    );
  }

  return (
    <img
      src={qb.logo}
      alt={qb.name}
      onError={() => setHasError(true)}
      style={{
        width: 62,
        height: 62,
        objectFit: "contain",
      }}
    />
  );
}

export default function QBPage() {
  const [user, setUser] = useState(null);
  const [currentWeek, setCurrentWeek] = useState(null);
  const [availableQbs, setAvailableQbs] = useState([]);
  const [selectedQbId, setSelectedQbId] = useState("");
  const [selectedQb, setSelectedQb] = useState(null);
  const [existingPick, setExistingPick] = useState(null);
  const [message, setMessage] = useState("");

  async function loadData() {
    const { data: sessionData } = await supabase.auth.getSession();
    const currentUser = sessionData.session?.user ?? null;
    setUser(currentUser);

    if (!currentUser) {
      setMessage("Connecte-toi pour choisir ton QB.");
      return;
    }

    const { data: settingsData, error: settingsError } = await supabase
      .from("settings")
      .select("*")
      .single();

    if (settingsError) {
      setMessage("Erreur settings : " + settingsError.message);
      return;
    }

    const week = settingsData.current_week;
    setCurrentWeek(week);

    const { data: myCurrentPick } = await supabase
      .from("qb_picks")
      .select(`
        *,
        qbs (
          id,
          name,
          team,
          logo
        )
      `)
      .eq("user_id", currentUser.id)
      .eq("week", week)
      .maybeSingle();

    if (myCurrentPick) {
      setExistingPick(myCurrentPick);
      setSelectedQb(myCurrentPick.qbs);
      return;
    }

    const { data: allQbsData } = await supabase
      .from("qbs")
      .select("*")
      .eq("active", true)
      .order("name", { ascending: true });

    const { data: takenThisWeekData } = await supabase
      .from("qb_picks")
      .select("qb_id")
      .eq("week", week);

    const { data: myHistoryData } = await supabase
      .from("qb_history")
      .select("qb_id")
      .eq("user_id", currentUser.id);

    const takenThisWeekIds = (takenThisWeekData || []).map((q) => q.qb_id);
    const myUsedIds = (myHistoryData || []).map((q) => q.qb_id);

    const filteredQbs = (allQbsData || []).filter((qb) => {
      return !takenThisWeekIds.includes(qb.id) && !myUsedIds.includes(qb.id);
    });

    setAvailableQbs(filteredQbs);
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const qb = availableQbs.find((q) => q.id === selectedQbId);
    setSelectedQb(qb || null);
  }, [selectedQbId, availableQbs]);

  const saveQB = async () => {
    if (!user) {
      setMessage("Connecte-toi pour choisir ton QB.");
      return;
    }

    if (existingPick) {
      setMessage("Ton QB est déjà soumis pour cette semaine.");
      return;
    }

    if (!selectedQbId) {
      setMessage("Choisis un QB avant de sauvegarder.");
      return;
    }

    const confirmation = window.confirm(
      "Ce choix est irréversible. Confirmer ton QB?"
    );

    if (!confirmation) return;

    const { error: pickError } = await supabase.from("qb_picks").insert({
      user_id: user.id,
      week: currentWeek,
      qb_id: selectedQbId,
    });

    if (pickError) {
      setMessage("Erreur choix QB : " + pickError.message);
      return;
    }

    const { error: historyError } = await supabase.from("qb_history").insert({
      user_id: user.id,
      qb_id: selectedQbId,
    });

    if (historyError) {
      setMessage("Erreur historique QB : " + historyError.message);
      return;
    }

    setMessage("QB sauvegardé ✅ Choix verrouillé.");
    await loadData();
  };

  return (
    <main className="page">
      <section className="header-card">
        <h1>Choisir mon QB 🎯</h1>
        <p>Semaine {currentWeek || "..."}</p>
      </section>

      <p>
        <a href="/">← Retour accueil</a>
      </p>

      {message && (
        <section className="card">
          <p>{message}</p>
        </section>
      )}

      {existingPick && selectedQb && (
        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div>
              <span className="badge badge-green">QB soumis</span>
              <h2 style={{ marginBottom: 6 }}>Ton QB est verrouillé</h2>
              <p style={{ color: "#94a3b8", marginTop: 0 }}>
                Semaine {currentWeek}
              </p>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              marginTop: 16,
              padding: 16,
              borderRadius: 18,
              background: "rgba(34,197,94,0.08)",
              border: "1px solid rgba(34,197,94,0.22)",
            }}
          >
            <QBLogo qb={selectedQb} />

            <div>
              <strong style={{ fontSize: 22 }}>{selectedQb.name}</strong>
              <p style={{ margin: "4px 0 0 0", color: "#94a3b8" }}>
                {selectedQb.team}
              </p>
            </div>
          </div>
        </section>
      )}

      {!existingPick && (
        <section className="card">
          <div style={{ marginBottom: 14 }}>
            <span className="badge badge-yellow">À sélectionner</span>
            <h2 style={{ marginBottom: 6 }}>Choisis ton QB</h2>
            <p style={{ color: "#94a3b8", marginTop: 0 }}>
              Les QB déjà pris cette semaine ou déjà utilisés par toi sont masqués.
            </p>
          </div>

          {availableQbs.length === 0 ? (
            <p className="status-warning">Aucun QB disponible.</p>
          ) : (
            <>
              <select
                className="input"
                value={selectedQbId}
                onChange={(e) => setSelectedQbId(e.target.value)}
              >
                <option value="">-- Sélectionner un QB --</option>

                {availableQbs.map((qb) => (
                  <option key={qb.id} value={qb.id}>
                    {qb.name}
                  </option>
                ))}
              </select>

              {selectedQb && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    marginTop: 14,
                    marginBottom: 14,
                    padding: 16,
                    borderRadius: 18,
                    background: "rgba(168,85,247,0.10)",
                    border: "1px solid rgba(168,85,247,0.25)",
                  }}
                >
                  <QBLogo qb={selectedQb} />

                  <div>
                    <strong style={{ fontSize: 22 }}>{selectedQb.name}</strong>
                    <p style={{ margin: "4px 0 0 0", color: "#94a3b8" }}>
                      {selectedQb.team}
                    </p>
                  </div>
                </div>
              )}

              <button className="button" onClick={saveQB}>
                Sauvegarder mon QB
              </button>

              <p className="status-warning" style={{ marginBottom: 0 }}>
                Attention : ce choix est irréversible.
              </p>
            </>
          )}
        </section>
      )}

      <nav className="bottom-nav">
        <a href="/">
          <strong>🏠</strong>
          Accueil
        </a>
        <a href="/matchs">
          <strong>✅</strong>
          Mes choix
        </a>
        <a href="/qb">
          <strong>🎯</strong>
          QB
        </a>
        <a href="/classements">
          <strong>🏆</strong>
          Classements
        </a>
        <a href="/tous-les-choix">
          <strong>👀</strong>
          Choix
        </a>
      </nav>
    </main>
  );
}
