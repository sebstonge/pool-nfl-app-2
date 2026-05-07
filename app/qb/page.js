"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

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
      const takenThisWeek = takenThisWeekIds.includes(qb.id);
      const alreadyUsedByMe = myUsedIds.includes(qb.id);

      return !takenThisWeek && !alreadyUsedByMe;
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
        <p>Un QB par semaine. Choix irréversible.</p>
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
          <h2>QB soumis ✅</h2>

          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {selectedQb.logo && (
              <img
                src={selectedQb.logo}
                alt={selectedQb.name}
                style={{
                  width: 56,
                  height: 56,
                  objectFit: "contain",
                }}
              />
            )}

            <div>
              <strong>{selectedQb.name}</strong>
              <p style={{ margin: "4px 0 0 0", color: "#6b7280" }}>
                Semaine {currentWeek}
              </p>
            </div>
          </div>
        </section>
      )}

      {!existingPick && (
        <section className="card">
          <h2>Semaine {currentWeek}</h2>

          {availableQbs.length === 0 ? (
            <p>Aucun QB disponible.</p>
          ) : (
            <>
              <label>
                <strong>Choisis ton QB</strong>
              </label>

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
                    gap: 14,
                    marginTop: 12,
                    marginBottom: 12,
                  }}
                >
                  {selectedQb.logo && (
                    <img
                      src={selectedQb.logo}
                      alt={selectedQb.name}
                      style={{
                        width: 56,
                        height: 56,
                        objectFit: "contain",
                      }}
                    />
                  )}

                  <strong>{selectedQb.name}</strong>
                </div>
              )}

              <button className="button" onClick={saveQB}>
                Sauvegarder mon QB
              </button>

              <p className="status-warning">
                Attention : ce choix est irréversible.
              </p>
            </>
          )}
        </section>
      )}
    </main>
  );
}
