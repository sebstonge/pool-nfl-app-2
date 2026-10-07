# Étape 2B-1 — moteur atomique regular → playoffs

Base : `081ef3bab13c09e4af387c7a3a984af0cc881c6d`.
Branche : `feature/lifecycle-transition` ; commit local uniquement.
Aucun bouton ajouté. Aucun accès Supabase distant, publication réelle,
transition réelle, installation distante, push ou merge.

## Audit ciblé et réutilisation

Les contrats déjà installés restent inchangés :

- settings(id=1) : phase, current_season/current_week, revision,
  regular_finalized_at, playoff_reminders_enabled ;
- `regular_final_publication_valid(season,revision)` compare la publication 2A
  au contexte et à l'identité complète des sources régulières ;
- `sync_playoff_seeds`, `finalize_playoff_seeds` : snapshot complet 7 AFC/7 NFC,
  verrous par saison, unicité et immutabilité après finalisation ;
- `manage_playoff_round` (version scoring) : préparation de Wild Card vide,
  insertion des matchs et vraie transition draft → open ;
- `extractEspnSeeds`, `validateSeedRows`, `discoverGames`, `assertMatchups` :
  identités équipes/ESPN, WSH→WAS, horaires futurs et affiches officielles ;
- guards des écritures régulières et trigger d'incrémentation revision ;
- triggers d'ouverture et guards notifications strictement conservés.

La clarification utilisateur corrige D.12 : avec rappels=false, l'absence
complète d'événement playoff_open est un résultat normal et requis.
Aucune modification de lifecycle_foundation, aucune exception, aucun flag
transitoire, aucune insertion dans une queue depuis le nouveau moteur.

## PREPARE — serveur, lectures uniquement

`POST /api/admin/lifecycle-transition`, Bearer validé avec Supabase Auth,
puis `users.is_admin = true` vérifié côté serveur. Confirmation explicite,
saison et révision attendue sont obligatoires. Le navigateur ne fournit jamais
la preuve ESPN ni le snapshot SQL ; toute propriété de ce genre est ignorée.
La réponse ne contient que le résultat de transition ou une erreur.
Ne pas appeler cette route pour la saison 2026 actuellement en cours.

1. `lifecycle_transition_state(season)` lit settings, sources régulières,
   publication 2A et toutes les données Séries de la saison (seeds, rondes,
   matchs, picks, QB picks, parcours, runs et résultats).
2. Refus immédiat si contexte fermé/périmé, publication absente/invalide,
   rappels activés ou données Séries conflictuelles. Aucun appel ESPN si ces
   préconditions locales échouent.
3. Lecture fraîche des standings réguliers ESPN pour la saison explicite.
   Pour **toutes** les équipes du calendrier régulier certifié, les valeurs
   wins/losses/ties sont comparées au bilan recompté depuis les scores FINAL
   de la publication 2A. Une équipe absente, dupliquée ou un bilan décalé bloque.
   Pas de déduction à partir d'une date, de la semaine courante ou MAX(season).
4. Extraction exacte des 14 qualifiés, 7 AFC + 7 NFC, seeds uniques 1…7,
   noms du référentiel teams et identifiants ESPN numériques.
5. Lecture du scoreboard postseason Wild Card : exactement six événements.
   Le resolver existant vérifie saison/type/semaine, équipes/identifiants,
   un seul événement par affiche, horaire futur, état pre et completed=false.
6. Rapprochement contre les trois affiches de chaque conférence : 2–7, 3–6,
   4–5. Aucun match #1. Aucun score fabriqué : home_score/away_score restent NULL.
7. Préparation datée liée à saison, révision et published_at de la publication.
   Aucune écriture pendant PREPARE ; aucun appel ESPN dans la transaction SQL.

Source publique inspectée en lecture seule : standings ESPN réguliers 2025,
`https://site.web.api.espn.com/apis/v2/sports/football/nfl/standings?seasontype=2&type=0&level=3&season=2025`.
Les champs wins/losses/ties/playoffSeed existent dans les entrées de divisions.
Cette lecture ne certifie pas la saison 2026. La simulation utilise uniquement
la saison synthétique 2099 et un fetcher local ; aucun événement fictif n'est
fourni à ESPN ni envoyé à Supabase distant.

## Conflits et préservation

- Tous les matchs existants de la saison, TEST-* ou officiels, sont conservés
  et bloquent cette initialisation. L'erreur identifie ID, external_game_id
  et ronde. Le moteur n'essaie pas de nettoyer une base de développement.
- Des choix, parcours, résultats ou runs déjà présents bloquent aussi la transition.
- Les rondes existantes doivent être draft, avoir la clé/l'ordre attendus et ne
  pas porter de trace d'ouverture. Les autres rondes draft sont conservées.
- Un événement ESPN déjà utilisé dans une autre saison est refusé en transaction.
- Seeds absents : réutilisation de sync_playoff_seeds puis finalize_playoff_seeds.
- Seeds existants : les 14 identités doivent correspondre exactement à ESPN
  (saison, conférence, seed, nom, ID ESPN), avec une capture uniforme.
  Sinon, refus explicite : aucun remplacement automatique d'un snapshot provisoire
  différent. Une synchronisation/revue séparée et autorisée devra le précéder.
- Snapshot identique provisoire : finalisation des lignes existantes sans changer
  leurs IDs ni captured_at. Une nouvelle validation ESPN n'est pas présentée
  comme une nouvelle date de capture initiale.
- Snapshot déjà uniformément finalisé et identique : conservé sans modification.

## COMMIT — transaction unique

Nouvelle RPC :
`transition_to_playoffs(integer,bigint,uuid,jsonb,jsonb) RETURNS jsonb`.
Paramètres : saison, révision attendue, administrateur authentifié, snapshot lu,
préparation serveur. Appel uniquement depuis service_role (ou propriétaire SQL).

Ordre des verrous : advisory saison (même clé que seeds/scoring), tables sources
régulières, tables publication/Séries, puis settings FOR UPDATE. Cela évite
l'inversion consistant à verrouiller settings avant les tables que les écrivains
réguliers verrouillent avant leur guard settings FOR SHARE. Tous les verrous
sont conservés jusqu'à la fin de transaction.

Sous ces verrous :

- revalidation Admin, saison, phase regular, revision, absence de fermeture,
  rappels=false ;
- appel réel à regular_final_publication_valid : false est un refus absolu ;
- comparaison exacte du snapshot courant et du snapshot préparé ;
- version/saison/révision/publication compatibles et préparation fraîche
  (5 minutes maximum, tolérance positive d'horloge de 5 secondes) ;
- validation SQL indépendante des seeds, doublons, conférences, six WC,
  dates futures, scores NULL et paires sportives sans les BYE ;
- contrôle des conflits avant toute écriture ;
- réutilisation des RPC seeds, puis manage_playoff_round('prepare','wild_card') ;
- vérification Wild Card open et exactement six matchs ;
- mise à jour unique de settings : phase='playoffs',
  regular_finalized_at=transaction_timestamp() ;
- le trigger existant incrémente revision une seule fois. Le moteur n'assigne
  jamais revision ni current_season/current_week/playoff_reminders_enabled.

Toute erreur annule seeds, matchs, ouverture et settings ensemble. Les fonctions
existantes appelées ne font pas de commit autonome. Les résultats et la publication
réguliers sont préservés ; seul leur contexte passe à fermé. Le validateur 2A
retourne ensuite false, conformément à son contrat réservé à phase=regular.

Un deuxième appel retourne « Déjà en Séries : aucune transition supplémentaire ».
Aucune nouvelle mutation, aucun doublon ni deuxième incrémentation. Une préparation
sur un contexte régulier de révision périmée est refusée.

## Notifications et fermeture

manage_playoff_round provoque une vraie ouverture draft → open. Les triggers
existants sont bien invoqués ; leur guard retourne sans mettre quoi que ce soit
en file, car le flag reste false. reminder_opened_at reste NULL. La fermeture
réussit indépendamment de la notification. Aucun déclenchement différé ajouté.
Une activation future ne rejouera donc pas rétroactivement cette ouverture.

Après commit, les guards lifecycle existants continuent de refuser les écritures
régulières, y compris authenticated (ancien onglet/Admin) et service_role.
Aucun bypass de ces guards n'est ajouté.

## Migration et permissions

`supabase/migrations/202610070001_lifecycle_transition.sql` :

- BEGIN/COMMIT ; deux nouvelles fonctions seulement :
  lifecycle_transition_state(integer), transition_to_playoffs(integer,bigint,uuid,jsonb,jsonb) ;
- SECURITY DEFINER avec search_path vide ; EXECUTE retiré de PUBLIC, anon,
  authenticated, accordé seulement à service_role et conservé au propriétaire ;
- à installer ultérieurement avec le propriétaire postgres, comme les fonctions
  précédentes, pour respecter le guard settings existant ;
- aucune table, colonne, policy ou trigger supplémentaire ; aucune donnée modifiée
  au simple moment de l'installation ; aucune migration existante modifiée.

**Migration NON appliquée à distance.** Les anciennes migrations sont utilisées
uniquement pour monter une base de test éphémère locale. Ne pas les rejouer en
production et ne pas utiliser db push. Aucune installation n'est demandée ici.

## Validation et limites

314 tests réussis, 0 échec, 0 ignoré, dont 59 tests/sous-tests ciblés nouveaux.
Toutes les suites existantes sont incluses. Test SQL sur PGlite avec les vraies
fonctions de publication 2A, seeds, gestion de ronde, scoring et guards installées
sur des fixtures locales 2099. Aucun mock du validateur de publication côté SQL.

Vérifiés : auth, mauvaise phase/saison/révision, publication absente/périmée,
standings incomplets/bilan non final, seeds malformés, mauvais WC, TEST préservés,
conflits intersaison, snapshot périmé, BYE sans match, réutilisation des rondes draft,
finalisation des seeds, fermeture régulière, révision unique, échec tardif/rollback,
deux appels concurrents côté appelant, refus des writes réguliers après fermeture,
zéro notification et flag inchangé.

`npm run build` réussi avec variables Supabase factices et clés VAPID éphémères.
Aucun test HTTP contre l'API réelle, aucun scoring/publication/transition distante.

Limites explicites :

- PGlite sérialise ses requêtes ; le test de deux appels concurrents prouve le
  résultat idempotent dans cet environnement, pas une contention réelle entre
  plusieurs connexions PostgreSQL. Les verrous PostgreSQL explicites assurent
  la sérialisation prévue ; une validation multi-session indépendante reste utile.
- Les classements et les affiches NFL restent une autorité ESPN : les bilans sont
  rapprochés, les seeds/affiches sont cohérents, mais le moteur ne réimplémente pas
  tous les tie-breakers NFL. Pas de garantie contre une correction externe future
  après la préparation ; sa durée est bornée et les kicks doivent rester futurs.
- La transition doit être préparée avant le premier match WC, avec calendrier
  officiel disponible. Elle refuse les horaires inconnus ou déjà commencés.
- Le snapshot et les verrous sont volontairement larges : intégrité privilégiée
  au débit pour une opération unique de fin de saison. Budget route : 60 secondes.
- Les TEST-* et les choix de développement existants empêchent la transition
  réelle ; leur traitement nécessitera un mandat distinct. Rien n'est supprimé ici.
- Aucun contrôle réel de 2026 en semaine 4 n'a été exécuté. Les bilans et événements
  synthétiques de test ne sont jamais présentés comme une qualification réelle.
