# Étape 2B-2 — Admin et expérience publique par phase

Base : 3d30774deb6376548dbcc5adb1b752a1a6ac3ff5.
Branche : feature/lifecycle-ui-routing. Livraison locale, sans migration.

## Choix d’architecture

Les six pages publiques sont des points d’entrée serveur ciblés, dynamiques.
Elles lisent settings(id=1) via loadLifecycle, sans cache (noStore + fetch no-store).
Le client privilégié reste exclusivement côté serveur ; seules les informations
nécessaires au rendu sont transmises. Un contexte indisponible provoque une erreur,
jamais un retour silencieux vers les écritures régulières.

Les cinq grandes pages régulières sont déplacées, sans changement de contenu,
dans RegularPage.js dans leur répertoire d’origine. Aucun import relatif ne change.
Les entrées page.js choisissent la page régulière ou la page /series existante.
Aucun middleware, rewrite global, changement de login, API ou assets.

L’accueil garde son composant d’authentification : connexion, inscription,
profil incomplet et changement obligatoire de mot de passe restent traités
avant de présenter l’accueil Séries aux participants connectés.
La tuile Admin régulière est réservée à is_admin=true. L’accueil Séries avait
déjà sa tuile Admin protégée, vers /admin/playoffs.

Les six destinations normales restent /, /matchs, /tous-les-choix, /qb-ratings,
/analytics et /classements. SeriesExperience fournit les liens publics en phase
playoffs sans modifier les styles de navigation ou la carte/bell de notifications.
Les liens utilisent des ancres : chaque navigation recharge le contexte serveur.
Les onglets déjà ouverts ne sont pas remplacés en direct ; les guards DB continuent
de protéger les anciennes écritures.

Les routes /series restent accessibles. Pendant regular, elles conservent leurs
liens de prévisualisation et le bandeau Admin. Pendant playoffs, elles utilisent
les liens publics et masquent le bandeau de prévisualisation.
Offseason n’est pas implémenté : les vues régulières existantes restent choisies,
avec leurs écritures fermées par les guards DB existants.

## Admin régulier

/admin redirige l’Admin authentifié vers /admin/playoffs quand phase=playoffs,
avant le chargement des outils réguliers. Les non-admin ne voient pas les actions.

Une section de fin de saison propose deux actions explicitement confirmées :
- Publier les résultats finaux : route 2A existante, aucune publication automatique.
- PASSER EN SÉRIES : route 2B-1 existante, aucune RPC ni écriture directe du navigateur.

Une case de confirmation et un verrou anti-double-clic précèdent l’appel.
Saison/révision sont celles du contexte affiché ; le serveur vérifie tout à nouveau.
Les erreurs métier sont affichées, sans changement optimiste de phase.
Après publication, le contexte est relu. Après transition réussie, un chargement
complet de /admin/playoffs présente l’administration active.

La mise à jour régulière ordinaire reste inchangée. La publication finale reste
séparée : ni une semaine prédéfinie ni un bouton de mise à jour LIVE ne prouve
que la saison est terminée. La route 2A conserve sa validation complète.
Les routes de publication/transition exposent maintenant leurs erreurs métier
connues (PublicationError / RoundError) ; les autres erreurs restent contrôlées.
Le moteur SQL 2B-1 et les migrations ne sont pas modifiés.

## Admin Séries et limite d’avancement

Pendant playoffs, l’écran principal utilise RoundAdmin et son action existante
Mise à jour complète, puis Passer à la ronde suivante quand celle-ci est autorisée.
Les outils de seeds/préparation Wild Card ne font pas partie de cet écran actif.
Le journal de notifications reste inchangé.

La finalisation définitive reste disponible sous « Validation définitive de la
ronde », avec confirmation distincte. L’ouverture suivante exige toujours une
ronde déjà finalisée. Il n’existe pas de transaction commune regroupant
publish_playoff_scoring(finalize) et manage_playoff_round(advance).
Aucun enchaînement de deux écritures depuis le client n’est ajouté.

Sous-étape future : construire une transaction serveur unique qui valide la
publication, prépare les affiches ESPN en lecture seule puis finalise la ronde
et ouvre la suivante ensemble. Ce moteur n’est pas implémenté en 2B-2.
Les primitives existantes continuent de fonctionner séparément et sûrement.

## Sécurité, validation et portée

Aucune migration, aucun changement de scoring, seeds, calendrier ou permissions.
Les guards des écritures régulières, y compris service_role, restent inchangés.
Les routes push régulières avaient déjà leurs contrôles lifecycle.
Aucune activation de rappels et aucun cron modifié.

24 tests ciblés : rendu des vrais points d’entrée dans les deux phases, liens,
confirmation, refus serveur, erreurs métier, succès avec navigation, connexion
anonyme, changement de mot de passe et contexte serveur non mis en cache.
Les dépendances externes sont simulées, sans requête Supabase distante.

Suite complète : 352 tests réussis, 0 échec, 0 ignoré.
npm run build : réussi, variables Supabase factices et VAPID éphémères.
Les fixtures SQL de la suite restent locales/éphémères ; aucune transition 2026.
Pas de validation connectée à la production ni de capture Preview dans ce chantier.
