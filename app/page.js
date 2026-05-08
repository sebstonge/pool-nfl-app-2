"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabase";
import BottomNav from "./components/BottomNav";

export default function HomePage() {
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    async function loadUser() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const currentUser = session?.user ?? null;
      setUser(currentUser);

      if (currentUser) {
        const { data: profile } = await supabase
          .from("users")
          .select("is_admin")
          .eq("id", currentUser.id)
          .maybeSingle();

        setIsAdmin(profile?.is_admin === true);
      }
    }

    loadUser();
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    window.location.reload();
  }

  return (
    <main className="page">
      <section className="header-card">
        <h1>Pool NFL 🏈</h1>
        <p>Prêt pour la semaine?</p>

        {user ? (
          <div style={{ marginTop: 18 }}>
            <p className="status-ok">
              Connecté : {user.email} ✅
            </p>

            <button
              className="button-secondary"
              onClick={signOut}
              style={{ marginTop: 10 }}
            >
              Se déconnecter
            </button>
          </div>
        ) : (
          <Link href="/auth" className="button">
            Se connecter
          </Link>
        )}
      </section>

      <section className="nav-grid">
        <Link href="/matchs" className="nav-card">
          <div
            className="nav-icon"
            style={{
              background:
                "linear-gradient(135deg,#16a34a,#22c55e)",
            }}
          >
            ✅
          </div>

          <div>
            Mes choix
            <span>Faire mes prédictions</span>
          </div>
        </Link>

        <Link href="/qb" className="nav-card">
          <div
            className="nav-icon"
            style={{
              background:
                "linear-gradient(135deg,#7c3aed,#a855f7)",
            }}
          >
            🎯
          </div>

          <div>
            QB
            <span>Choisir mon QB de la semaine</span>
          </div>
        </Link>

        <Link href="/tous-les-choix" className="nav-card">
          <div
            className="nav-icon"
            style={{
              background:
                "linear-gradient(135deg,#2563eb,#60a5fa)",
            }}
          >
            👀
          </div>

          <div>
            Tous les choix
            <span>Voir les prédictions de tous</span>
          </div>
        </Link>

        <Link href="/qb-ratings" className="nav-card">
          <div
            className="nav-icon"
            style={{
              background:
                "linear-gradient(135deg,#0f766e,#14b8a6)",
            }}
          >
            📊
          </div>

          <div>
            QB Ratings
            <span>Meilleurs et pires ratings</span>
          </div>
        </Link>

        <Link href="/classements" className="nav-card">
          <div
            className="nav-icon"
            style={{
              background:
                "linear-gradient(135deg,#ca8a04,#facc15)",
            }}
          >
            🏆
          </div>

          <div>
            Classements
            <span>Hebdo et saison</span>
          </div>
        </Link>

        {isAdmin && (
          <Link href="/admin" className="nav-card">
            <div
              className="nav-icon"
              style={{
                background:
                  "linear-gradient(135deg,#475569,#94a3b8)",
              }}
            >
              ⚙️
            </div>

            <div>
              Admin
              <span>Scores, stats et calculs</span>
            </div>
          </Link>
        )}
      </section>

      <BottomNav />
    </main>
  );
}
