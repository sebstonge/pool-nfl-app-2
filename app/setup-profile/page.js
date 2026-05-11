"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function SetupProfilePage() {
  const router = useRouter();

  const [user, setUser] = useState(null);
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function loadUser() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const currentUser = session?.user;

      if (!currentUser) {
        router.push("/auth");
        return;
      }

      setUser(currentUser);

      const { data: profile } = await supabase
        .from("users")
        .select("display_name")
        .eq("id", currentUser.id)
        .maybeSingle();

      if (profile?.display_name) {
        router.push("/");
      }
    }

    loadUser();
  }, [router]);

  async function saveProfile() {
    if (!displayName.trim()) {
      setMessage("Entre un nom d’utilisateur.");
      return;
    }

    if (displayName.length < 3) {
      setMessage("Minimum 3 caractères.");
      return;
    }

    setLoading(true);

    const { error } = await supabase
      .from("users")
      .update({
        display_name: displayName.trim(),
      })
      .eq("id", user.id);

    setLoading(false);

    if (error) {
      setMessage(
        "Nom déjà utilisé ou invalide."
      );
      return;
    }

    router.push("/");
  }

  return (
    <main className="page">
      <section className="header-card">
        <h1>Choisis ton nom 🏈</h1>

        <p>
          Ce nom sera affiché dans les
          classements et les choix.
        </p>
      </section>

      <section className="card">
        <input
          className="input"
          placeholder="Ex: SKOOOOOOL"
          value={displayName}
          onChange={(e) =>
            setDisplayName(e.target.value)
          }
          maxLength={20}
        />

        <button
          className="button"
          onClick={saveProfile}
          disabled={loading}
          style={{ width: "100%" }}
        >
          {loading
            ? "Sauvegarde..."
            : "Continuer"}
        </button>

        {message && (
          <p
            style={{
              marginTop: 12,
              color: "#ef4444",
            }}
          >
            {message}
          </p>
        )}
      </section>
    </main>
  );
}
