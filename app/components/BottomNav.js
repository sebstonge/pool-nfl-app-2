"use client";

import { useEffect, useState } from "react";

export default function BottomNav() {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    function updateLayout() {
      setIsDesktop(window.innerWidth >= 900);
    }

    updateLayout();

    window.addEventListener("resize", updateLayout);

    return () => {
      window.removeEventListener("resize", updateLayout);
    };
  }, []);

  const links = [
    {
      href: "/",
      icon: "🏠",
      label: "Accueil",
    },
    {
      href: "/matchs",
      icon: "✅",
      label: "Mes choix",
    },
    {
      href: "/tous-les-choix",
      icon: "👀",
      label: "Tous les choix",
    },
    {
      href: "/qb-ratings",
      icon: "📊",
      label: "QB Ratings",
    },
    {
      href: "/analytics",
      icon: "📈",
      label: "Stats",
    },
    {
      href: "/classements",
      icon: "🏆",
      label: "Classements",
    },
  ];

  /*
   * =========================================================
   * MOBILE / TABLETTE
   * =========================================================
   *
   * On conserve exactement le comportement actuel.
   */

  if (!isDesktop) {
    return (
      <nav className="bottom-nav">
        {links.map((link) => (
          <a key={link.href} href={link.href}>
            <strong>{link.icon}</strong>
            {link.label}
          </a>
        ))}
      </nav>
    );
  }

  /*
   * =========================================================
   * DESKTOP
   * =========================================================
   */

  return (
    <nav
      style={{
        position: "fixed",
        top: 18,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,

        width: "calc(100% - 48px)",
        maxWidth: 1320,

        padding: "9px 12px",

        display: "flex",
        alignItems: "center",
        gap: 6,

        borderRadius: 22,

        background: "rgba(8,15,35,0.94)",

        border:
          "1px solid rgba(148,163,184,0.18)",

        boxShadow:
          "0 14px 40px rgba(0,0,0,0.30)",

        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
      }}
    >
      {/* =====================================================
          IDENTITÉ
          ===================================================== */}

      <a
        href="/"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,

          padding: "9px 16px 9px 10px",

          marginRight: "auto",

          color: "#f8fafc",
          textDecoration: "none",

          fontWeight: 900,
          fontSize: 17,

          whiteSpace: "nowrap",
        }}
      >
        <span
          style={{
            fontSize: 24,
            lineHeight: 1,
          }}
        >
          🏈
        </span>

        <span>POOL NFL</span>
      </a>

      {/* =====================================================
          NAVIGATION
          ===================================================== */}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,

              padding: "10px 12px",

              borderRadius: 13,

              color: "#cbd5e1",
              textDecoration: "none",

              fontSize: 13,
              fontWeight: 800,

              whiteSpace: "nowrap",

              transition:
                "background 0.15s ease, color 0.15s ease",
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.background =
                "rgba(59,130,246,0.12)";

              event.currentTarget.style.color =
                "#f8fafc";
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background =
                "transparent";

              event.currentTarget.style.color =
                "#cbd5e1";
            }}
          >
            <span
              style={{
                fontSize: 17,
                lineHeight: 1,
              }}
            >
              {link.icon}
            </span>

            <span>{link.label}</span>
          </a>
        ))}
      </div>
    </nav>
  );
}
