# Journal Admin des notifications — revue locale

Base : `7f621398be877135a8e9c44d926020e1ac115f4c`.
Branche : `feature/admin-notification-log`.
Aucune opération Supabase distante, aucun push, aucun merge.

## Audit initial et choix minimal

Le transport réel est `lib/pushNotifications.js`, via `web-push.sendNotification`.
Il renvoie les succès/échecs par abonnement et supprime toujours les abonnements
expirés (404/410). Un utilisateur peut posséder plusieurs appareils.
Les appelants réellement présents sont next-player, first-player, scheduled,
qb-final, rankings-updated, test et le worker reminders. sendPushToAll existe
mais n'a aucun appelant dans ce dépôt et n'est pas modifié/instrumenté ici.

La file actuelle `push_notification_events` contient event_key, user_id,
notification_type, scheduled_for, status, sent_at et les champs de réservation /
annulation des rappels. Ses horodatages de création et de tentative générale,
les compteurs de transport, les messages et erreurs ne sont pas systématiquement
conservés par le code existant. Le lecteur ne suppose pas de colonne created_at
sur cette table. scheduled_for est une date prévue, jamais une date de création.

Différences concrètes auditées :

- next-player ne marque pas systématiquement sent/sent_at après succès ;
- next-player et first-player peuvent supprimer leur événement quand sent = 0 ;
- rankings-updated peut envoyer immédiatement sans créer une ligne dans la file ;
- qb-final / scheduled enregistrent sent si au moins un appareil a été accepté ;
- no_subscription peut aussi correspondre à des tentatives toutes en échec ;
- les échecs de scheduled peuvent rester pending pour un nouvel essai ;
- reminder_attempted_at est une réservation avant transport, pas un accusé push ;
- les nombres retournés par le transport et certaines erreurs ne vivaient que
  dans la réponse HTTP / les journaux serveur.

Donc ajouter seulement une vue sur la file aurait produit un historique trompeur.
Le choix est une table d'observations du transport, PAS une seconde file : aucun
scheduler, claim, retry, envoi, trigger ni mécanisme de notification ajouté.

## Architecture

Un composant client commun `app/admin/components/NotificationLog.js`, avec CSS
local, est ajouté à /admin et /admin/playoffs. Les autres sections, la navigation,
la cloche et les pages publiques restent inchangées. Cards, boutons et inputs
réutilisent les classes existantes. Liste compacte, détails natifs dépliables,
filtres Toutes / Envoyées-acceptées / Échecs, actualisation manuelle, Toronto.

`GET /api/admin/notification-log?scope=regular|playoffs&filter=all|sent|failed` :
validation du Bearer via Supabase Auth puis users.is_admin côté serveur. Aucune
confiance dans les paramètres client pour l'autorisation. Réponses private/no-store.
Les lectures service_role projettent uniquement les informations nécessaires.
Le JSON retourné ne contient jamais de subscription, endpoint, token, secret,
email, ID utilisateur brut ou erreur brute du fournisseur.

Le lecteur fusionne une fenêtre bornée de file existante et de nouvelles
observations ; les événements déjà observés sont dédupliqués par event_key + user.
Les tentatives répétées restent des observations distinctes, pour ne pas masquer
un échec suivi d'une réussite. Maximum 50 lignes affichées, après filtrage.
Les filtres portent sur cette fenêtre récente, pas sur tout l'historique.
Les anciens événements sans date fiable ne peuvent pas être ordonnés exactement.

Chaque ligne concerne un destinataire (nom du profil disponible) et indique
séparément les appareils acceptés / en échec. Aucun regroupement artificiel de
campagnes : 2 appareils acceptés pour un joueur restent 1 destinataire.
Les types playoff_* sont séparés du régulier. Le bandeau Séries indique la
désactivation si le flag serveur, la phase ou le flag lifecycle ne permettent
pas les rappels. Aucun de ces contrôles n'est modifié.

## Télémétrie et vérité des états

Les routes ajoutent seulement un contexte `{eventKey,type}` à leur appel existant.
`observeDelivery` observe `sendPushToUser`, sans changer ses résultats ni retries.
Une ligne est créée au début du traitement, puis la tentative est horodatée avant
le dernier guard lifecycle et le transport. Si aucune tentative n'a eu lieu au
terme du traitement, attempted_at est remis à NULL et les compteurs sont 0.
Le guard lifecycle reste la dernière vérification avant le transport effectif.

En fin normale, accepted_count et failed_count sont calculés à partir des
résultats réels par abonnement ; leur somme = attempted_count. accepted_at est
l'instant où le résultat positif est enregistré, pas l'instant de réception mobile.
Les erreurs conservées sont des catégories fixes / codes HTTP, jamais le texte
brut d'un SDK. Le DTO Admin n'en expose que des explications prédéfinies.

- Acceptée : fournisseur push ayant répondu positivement pour ces appareils.
- Échec / acceptation non confirmée : refus ou erreur transport, dont timeout
  potentiellement ambigu ; ce n'est pas une preuve que le téléphone n'a rien reçu.
- Partiellement acceptée : au moins un succès et un échec dans ce traitement.
- Non envoyée / aucune tentative : 0 résultat transport (pas d'abonnement ou guard).
- Interruption : compteurs inconnus, même si certains appareils ont peut-être reçu
  le message avant l'interruption. Aucun nombre n'est inventé.
- Historique sent : état enregistré dans la file, compteurs inconnus.
- Historique pending : mise en file si planification disponible, sinon simple
  événement enregistré ; ne prouve aucune acceptation.

Aucune télémétrie ne prouve une lecture ou une livraison sur l'appareil.
La réservation peut précéder une interruption avant l'appel réseau : une ligne
incomplète exprime une issue inconnue, pas une acceptation.
Une panne d'écriture de télémétrie ne bloque pas l'envoi existant et ne déclenche
pas de retry. Par conséquent le journal peut être incomplet ; les historiques
supprimés avant cette migration ne sont pas récupérables. Aucun backfill inventé.

## Migration à revoir, non appliquée à distance

`202610060001_notification_delivery_log.sql`, BEGIN/COMMIT :

- nouvelle table push_notification_deliveries ; UUID primaire, event_key nullable,
  user_id UUID, scope regular/playoffs, type, titre, body ;
- created_at, attempted_at, completed_at, accepted_at ;
- compteurs attempted_count / accepted_count / failed_count, tous NULL tant que
  le bilan n'est pas connu, contraintes non négatives et somme cohérente ;
- failure_reason texte de diagnostic contrôlé ;
- index (scope,created_at DESC) et event_key ;
- RLS activée, zéro policy client ; aucun grant anon/authenticated/PUBLIC ;
- service_role : SELECT, INSERT, UPDATE uniquement (pas DELETE/TRUNCATE) ;
- aucun trigger, aucune fonction, aucune modification de table/file existante ;
- aucune FK vers la file : ses suppressions actuelles ne doivent pas supprimer
  l'observation ; aucune donnée existante n'est réécrite.

Si cette migration manque, l'envoi fonctionne toujours et le journal montre un
avertissement explicite avec les événements historiques disponibles. Elle devra
être examinée puis installée manuellement avant de bénéficier de la télémétrie.
Aucun SQL d'installation distante n'a été exécuté durant ce chantier.

## Déterminants français

L'adversaire du message qb-final vient de games.home_team/away_team, avec des noms
courts ou complets ; ailleurs teams possède aussi espn_abbr. Un helper local aux
notifications reconnaît les 32 surnoms NFL pluriels, noms complets suffixés et
abréviations (dont WSH/WAS). Il conserve un déterminant déjà fourni. Un futur nom
inconnu devient `l’équipe « Nom »`, pas automatiquement `les Nom`. Le fallback
existant `son adversaire` reste naturel. Aucun nom stocké / affiché ailleurs modifié.

Message exact :

> Bryce Young a conclu son match contre les Lions avec un passer rating de 110.7.

Le rating, ses règles, sa récupération ESPN et son format à une décimale sont inchangés.

## Validation

246 tests réussis, 0 échec, 0 ignoré (231 existants + 15 nouveaux), dont :
autorisation route Admin / refus utilisateur ordinaire, liste vide, succès,
échec, partiel, historique incomplet, destinataire vs appareils, filtres/scopes,
limite 50, timezone Toronto été/hiver, exclusion de secrets, déterminants et message,
transport réel avec dépendances simulées (cleanup 410, guard, zéro abonnement),
panne télémétrie sans changement d'envoi, interruption conservée comme inconnue,
lecture sans migration, état désactivé des rappels, droits SQL et RLS.
La migration est exécutée uniquement dans PostgreSQL éphémère local (PGlite).

`npm run build` : validation avec Supabase factice et clés VAPID éphémères,
sans appel de notification réel. Aucun test d'envoi réel / aucun appareil contacté.

Limites : rétention/purge future non ajoutée ; noms des destinataires lus depuis
le profil actuel ; les anciennes lignes sans timestamp ne prouvent pas leur
chronologie ; pas de preuve de réception/lecture ni de reprise de télémétrie
perdue. Aucun changement des règles du pool, scoring, lifecycle, phase, saison,
semaine, révision, publication finale, seeds, rondes, cron ou activation des rappels.
