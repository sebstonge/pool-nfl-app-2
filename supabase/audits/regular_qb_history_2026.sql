-- READ ONLY. Run manually in SQL Editor before any recovery.
-- Current qbs identity is context only, NEVER historical evidence.
WITH occurrences AS (
  SELECT
    qp.season, qp.week, qp.user_id,
    coalesce(nullif(u.display_name,''),nullif(u.real_name,''),qp.user_id::text) AS joueur,
    qp.id AS qb_pick_id, qp.qb_id, qp.created_at AS selected_at,
    to_jsonb(qp)->>'selected_qb_name' AS selected_qb_name_snapshot,
    to_jsonb(qp)->>'selected_espn_athlete_id' AS selected_espn_athlete_id_snapshot,
    to_jsonb(qp)->>'selected_team' AS selected_team_snapshot,
    q.name AS catalog_name_now, q.espn_athlete_id AS catalog_espn_id_now,
    q.team AS catalog_team_now, q.active AS catalog_active_now,
    q.is_active_starter AS catalog_starter_now,
    to_jsonb(q)->>'created_at' AS catalog_created_at,
    to_jsonb(q)->>'updated_at' AS catalog_updated_at_if_available,
    qr.id AS rating_id, qr.actual_qb_name, qr.actual_espn_athlete_id,
    qr.passer_rating, qr.created_at AS rating_created_at,
    to_jsonb(qr)->>'updated_at' AS rating_updated_at_if_available,
    ws.base_points, ws.multiplier, ws.final_score,
    pub.published_at AS season_publication_at,
    pubq.value AS catalog_at_season_publication_not_selection,
    (pub.source->'qb_picks') @> jsonb_build_array(jsonb_build_object('id',qp.id)) AS pick_in_publication
  FROM public.qb_picks qp
  LEFT JOIN public.users u ON u.id=qp.user_id
  LEFT JOIN public.qbs q ON q.id=qp.qb_id
  LEFT JOIN public.qb_ratings qr ON qr.season=qp.season AND qr.week=qp.week AND qr.qb_id=qp.qb_id
  LEFT JOIN public.weekly_scores ws ON ws.season=qp.season AND ws.week=qp.week AND ws.user_id=qp.user_id
  LEFT JOIN public.regular_final_publications pub ON pub.season=qp.season
  LEFT JOIN LATERAL (
    SELECT item AS value FROM jsonb_array_elements(coalesce(pub.source->'qbs','[]'::jsonb)) item
    WHERE item->>'id'=qp.qb_id::text LIMIT 1
  ) pubq ON true
  WHERE qp.season=2026
)
SELECT *,
  CASE
    WHEN nullif(btrim(selected_qb_name_snapshot),'') IS NOT NULL
     AND nullif(btrim(selected_espn_athlete_id_snapshot),'') IS NOT NULL
     AND nullif(btrim(selected_team_snapshot),'') IS NOT NULL
     AND nullif(btrim(actual_espn_athlete_id),'') IS NOT NULL AND passer_rating IS NOT NULL
    THEN CASE WHEN selected_espn_athlete_id_snapshot=actual_espn_athlete_id
      THEN 'CERTAIN — NORMAL' ELSE 'CERTAIN — REMPLACEMENT' END
    ELSE 'AMBIGU'
  END AS classification,
  CASE WHEN selected_espn_athlete_id_snapshot IS NULL
    THEN 'Identité initiale à prouver ; le catalogue actuel ne suffit pas.'
    WHEN actual_espn_athlete_id IS NULL OR passer_rating IS NULL
    THEN 'Résultat officiel incomplet ou en attente.'
    ELSE 'Comparaison snapshot de sélection / résultat enregistré.'
  END AS preuve_ou_information_manquante
FROM occurrences
ORDER BY week, selected_at, qb_pick_id;
