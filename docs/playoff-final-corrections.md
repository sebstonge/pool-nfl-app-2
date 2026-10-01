# Corrections finales Playoffs

## Saison explicite

`lib/playoffs/context.mjs` est la seule configuration de saison active (NFL 2026).
Les pages publiques ne lisent aucun paramètre URL de saison. Les loaders filtrent
les rondes en base et refusent les incohérences ; une saison absente reste vide.
Le futur système seasons/phase remplacera cette source, pas les calculs des pages.

## Migration manuelle restante

Fichier : `supabase/migrations/202610010001_playoff_results_season_guard.sql`.
Prérequis : la migration scoring `202609290001_playoff_scoring.sql` est déjà installée.

Plus tard, dans le SQL Editor du projet Supabase choisi explicitement :
1. Copier **uniquement tout le contenu** de `202610010001_playoff_results_season_guard.sql`.
2. Exécuter le bloc complet BEGIN/COMMIT une fois.
3. Vérifier la définition et les permissions de `public.read_playoff_results(bigint[])`.

Ne pas rejouer les migrations seeds, round_admin, scoring ou rappels.
Ne pas exécuter `supabase db push`. Aucune application distante n'est faite dans cette passe.

La fonction conserve sa signature, son JSON, son fonctionnement security invoker
et ses droits authenticated/service_role. Elle refuse les IDs inconnus (y compris
un élément NULL) et les saisons mélangées. Une liste vide reste vide et les IDs
répétés ne dupliquent pas les résultats. CREATE OR REPLACE permet une réapplication
isolée. Aucun changement de données, de table ou de politique RLS.
La lecture de playoff_rounds reste soumise aux droits de l'appelant, comme les loaders publics.
