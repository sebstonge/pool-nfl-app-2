"use client";

import { useEffect, useState } from "react";
import { getSeasonalGameAccent, getSeasonalPreview, getSeasonalTheme } from "../../../lib/seasonal/seasonalTheme.mjs";
import styles from "./seasonal.module.css";

export default function useSeasonalTheme(games, {
  activeWeek,
  viewedWeek = activeWeek,
  season,
  enabled = true,
} = {}) {
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    // Next compiles this guard out of Production and Vercel Preview builds.
    if (process.env.NODE_ENV !== "development") return;
    const readPreview = () => setPreview(getSeasonalPreview(
      new URLSearchParams(window.location.search).get("seasonalPreview"),
      process.env.NODE_ENV,
    ));
    readPreview();
    window.addEventListener("popstate", readPreview);
    return () => window.removeEventListener("popstate", readPreview);
  }, []);

  const options = { activeWeek, viewedWeek, season, preview, environment: process.env.NODE_ENV };
  const theme = enabled ? getSeasonalTheme(games, options) : null;

  return {
    theme,
    pageClassName: theme ? `${styles.surface} ${styles[theme]}` : "",
    gameAccent: (game, index) => getSeasonalGameAccent(game, theme, { ...options, previewIndex: index }),
  };
}
