"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function QBPage() {
  const [user, setUser] = useState(null);
  const [qbs, setQbs] = useState([]);
  const [qbPicks, setQbPicks] = useState([]);
  const [qbHistory, setQbHistory] = useState([]);
  const [selectedQbId, setSelectedQbId] = useState("");
  const [message, setMessage] = useState("");
  const currentWeek = 1;

  useEffect(() => {
    async function load() {
      const { data: sessionData } = await supabase.auth.getSession();
      const currentUser = sessionData.session?.user ?? null;
      setUser(currentUser);

      const { data: qbsData } = await supabase
        .from("qbs")
        .select("*")
        .eq("active", true)
        .order("name", { ascending: true });

      setQbs(qbsData || []);

      const { data: qbPicksData } = await supabase
        .from("qb_picks")
        .select("*")
        .eq("week", currentWeek);

      setQbPicks(qbPicksData || []);

      if (currentUser) {
        const { data: historyData } = await supabase
          .from("qb_history")
          .select("*")
          .eq("user_id", currentUser.id);

        setQbHistory(historyData || []);
      }
    }

    load();
  }, []);

  const saveQB = async () => {
    if (!user) {
      setMessage("Connecte-toi avant de choisir un QB.");
      return;
    }

    if (!selectedQbId) {
      setMessage("Choisis un QB.");
      return;
    }

    const alreadyTakenThisWeek = qbPicks.some(
      (pick) => pick.qb_id === selectedQbId && pick.user_id !== user.id
    );

    if (alreadyTakenThisWeek) {
      setMessage("Ce QB est déjà choisi par un autre joueur cette semaine.");
      return;
    }

    const alreadyUsedByYou = qbHistory.some(
      (history) => history.qb_id === selectedQbId
    );

    if (alreadyUsedByYou) {
      setMessage("Tu as déjà utilisé ce QB cette saison.");
      return;
    }

    const { error: pickError } = await supabase.from("qb_picks").upsert({
      user_id: user.id,
      qb_id: selectedQbId,
      week: currentWeek,
    });

    if (pickError) {
      setMessage("Erreur choix QB : " + pickError.message);
      return;
    }

    const { error: historyError } = await supabase
      .from("qb_history")
      .upsert({
        user_id: user.id,
        qb_id: selectedQbId,
      });

    if (historyError) {
      setMessage("Erreur historique QB : " + historyError.message);
      return;
    }

    setMessage("QB sauvegardé ✅");
  };

  return (
    <main style={{ padding: 20 }}>
      <h1>Choisir mon QB</h1>

      <p>
        <a href="/">Retour accueil</a>
      </p>

      <p>Semaine {currentWeek}</p>

      {!user && (
        <p style={{ color: "darkred" }}>
          Mode lecture seulement : connecte-toi pour choisir un QB.
        </p>
      )}

      {message && <p>{message}</p>}

      {qbs.map((qb) => {
        const takenThisWeek = qbPicks.some(
          (pick) => pick.qb_id === qb.id && pick.user_id !== user?.id
        );

        const usedByYou = qbHistory.some(
          (history) => history.qb_id === qb.id
        );

        const disabled = takenThisWeek || usedByYou;

        return (
          <div
            key={qb.id}
            style={{
              border: "1px solid #ddd",
              borderRadius: 10,
              padding: 15,
              marginBottom: 12,
              maxWidth: 500,
              opacity: disabled ? 0.5 : 1,
            }}
          >
            <strong>{qb.name}</strong>
            <br />
            Équipe : {qb.team}

            <br />

            {takenThisWeek && <span>Déjà choisi cette semaine</span>}
            {usedByYou && <span>Déjà utilisé par toi cette saison</span>}

            <br />

            <button
              disabled={disabled}
              onClick={() => setSelectedQbId(qb.id)}
              style={{
                padding: 10,
                marginTop: 10,
                fontWeight: selectedQbId === qb.id ? "bold" : "normal",
              }}
            >
              {selectedQbId === qb.id ? "Sélectionné ✅" : "Choisir"}
            </button>
          </div>
        );
      })}

      <button onClick={saveQB} style={{ padding: 12, marginTop: 10 }}>
        Sauvegarder mon QB
      </button>
    </main>
  );
}
