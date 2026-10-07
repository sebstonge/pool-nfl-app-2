# 2B-3 — Passage atomique

Migration nouvelle : `202610080001_playoff_atomic_advance.sql`. Installation MANUELLE ultérieure, après les migrations scoring, rappels et lifecycle. Ne rejouer aucune migration précédente. Aucune donnée, phase ou ronde n'est changée à l'installation.

La route Admin authentifie l'utilisateur et transmet son UUID au nouveau helper `advanceRound`. PREPARE réutilise `playoff_scoring_state`, `expectedMatchups` et `discoverGames`. Le réseau ESPN reste entièrement hors transaction. Aucun calcul de scoring/QB/path/ranking n'est dupliqué.

`advance_playoff_round_atomic(integer,text,uuid,jsonb,jsonb)` est SECURITY DEFINER avec search_path vide, EXECUTE uniquement service_role (et propriétaire). Elle verrouille les références, tables playoffs et settings, vérifie l'Admin, phase/saison, snapshot exact, seeds finales, chaîne complète de survivants et reseeding SQL. Elle refuse les TEST et cibles incompatibles. Elle appelle `publish_playoff_scoring(...,'finalize',...)` avant toute modification de cible, puis `manage_playoff_round(...,'advance',...)` dans la même transaction. Tout échec annule aussi la finalisation.

`playoff_round_advances` est le reçu durable : une ligne par source, cible unique, acteur, date, résultat. RLS activée, aucune policy, service_role SELECT seulement; écritures par la RPC. La source est la clé d'idempotence, sans clé navigateur supplémentaire. Une répétition de cette source retourne son reçu, même après progression ultérieure, sans réseau ESPN ni nouvelle ouverture; la RPC revérifie encore Admin, phase et saison active. Le reçu décrit l'opération historique, pas l'état courant de la cible.

Le bouton devient disponible en `scored` pour les trois premières rondes. La confirmation décrit la finalisation irréversible et l'ouverture atomique. La finalisation séparée est retirée de leur workflow normal. Le Super Bowl conserve sa finalisation existante, sans bouton d'avancement; la clôture offseason reste hors scope. Une ancienne source déjà finalisée sans reçu est refusée : pas de récupération implicite de données historiques.

Aucun guard notification changé. Avec flag false, ouverture sans événement ni reminder_opened_at. Aucun appel push dans la transaction. Seeds originales intactes, aucun changement de settings. L'initialisation Wild Card/2B-1 reste inchangée.

Limites : PostgreSQL valide les affrontements sportifs et le payload local, pas une nouvelle version ESPN apparue après PREPARE. Les références sont verrouillées brièvement pendant COMMIT. Un match cible préexistant n'est accepté que compatible, futur, pre, sans score, choix ni publication; aucun remplacement destructif. Les anciens RPC internes restent présents, notamment pour 2B-1; l'action API advance utilise exclusivement la nouvelle RPC.

Tests SQL : fixtures isolées, migrations réelles, scoring réel, trois transitions, upset #7, orientation ESPN du Super Bowl, snapshot/publication périmés, rôles, phase, TEST, cible commencée/ouverte, retry et panne après finalisation, notifications false. Tests Node : ordre PREPARE/COMMIT, panne ESPN sans écriture, retry sans réseau, admissibilité scored.
