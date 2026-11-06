# Veille et menu hebdomadaire des QB

L’Admin régulier affiche les différences entre les QB indiqués par nflverse et les titulaires proposés dans le pool. Il peut confirmer un signal après vérification, l’écarter, retirer un QB indisponible ou sélectionner un QB du catalogue par nom et identifiant ESPN. Une correction confirmée s’applique seulement à la semaine régulière visée.

## Flux d’observation

- Le tick PostgreSQL utilise la saison et la semaine régulières actives, l’ouverture réelle dans `qb_selection_weeks.started_at` et tous les matchs NFL de la semaine, admissibles au pool ou non. Il envoie au plus une collecte par tranche de deux heures à partir de l’ouverture.
- Le worker utilise les fichiers de calendrier et de roster des [releases nflverse](https://github.com/nflverse/nflverse-data/releases) sous [CC BY 4.0](https://github.com/nflverse#licensing), avec attribution à nflverse et aux fournisseurs applicables. Il valide la fraîcheur, l’empreinte publiée et la concordance de tous les IDs de match. Le premier kickoff est le plus tôt des deux calendriers. Jusqu’à six GET, 45 secondes maximum, avec respect de `Retry-After`. La copie des effectifs est lue uniquement en présence d’un écart et peut être mise en cache. Les timestamps horaires sont interprétés dans `America/Toronto`.
- Un écart nflverse reste **à confirmer**, même lorsque l’ID ESPN du candidat a été rapproché de façon unique. La date de détection reste distincte d’une date d’annonce. Aucune source gratuite autorisée et suffisamment explicite n’a été retenue pour une affectation automatique. Les articles du prototype restent des fixtures et du code de recherche local. Le worker déployable ne consulte ni NFL.com, ni ESPN, ni RotoWire, ni les sites des équipes. Sleeper ne participe pas à la décision.
- PostgreSQL récolte la réponse asynchrone de `pg_net` et valide sa signature et son contexte. Les signaux nflverse sont dédupliqués par saison, semaine, match, équipe et QB. Un signal écarté ne crée pas d’alerte répétée. Un clic Admin peut demander une vérification supplémentaire, dans la même fenêtre et avec au moins cinq minutes entre cette demande et la précédente collecte.
- Le worker effectue seulement des lectures HTTPS. Il ne reçoit aucun identifiant Supabase. Seul un Admin authentifié peut confirmer ou corriger le menu. La transaction revalide le calendrier, l’heure réelle et la saison. Un changement de titulaire ne libère jamais une équipe déjà réservée. Le résultat officiel consomme le QB réellement crédité. En attente de preuve, le choix original reste indisponible. L’affichage live et le calcul de remplacement se fondent toujours sur le match individuel.
- Le contrôle d’admissibilité utilise le résultat enregistré dans `qb_ratings`. La migration empêche les joueurs ordinaires d’insérer ou de modifier cette preuve. La lecture des ratings et les écritures Admin ou serveur autorisées sont conservées.

## Vérification de l’infrastructure avant activation

Exécuter ces lectures avec le rôle qui planifiera le tick. Le contrôle ne lit aucune valeur de secret.

```sql
select name, default_version, installed_version
from pg_available_extensions
where name in ('pg_cron', 'pg_net', 'supabase_vault', 'pgcrypto');

select name, setting, unit
from pg_settings
where name in ('cron.timezone', 'cron.launch_active_jobs', 'pg_net.ttl');

select
  to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') as http_post,
  to_regprocedure('cron.schedule(text,text,text)') as schedule,
  to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)') as alter_job,
  to_regprocedure('extensions.hmac(bytea,bytea,text)') as hmac,
  to_regclass('vault.decrypted_secrets') as vault,
  to_regclass('net._http_response') as response_table;

select rolname,
  has_any_column_privilege(oid, to_regclass('vault.decrypted_secrets'), 'SELECT') as vault_read,
  has_any_column_privilege(oid, to_regclass('net.http_request_queue'), 'SELECT') as queue_read,
  has_table_privilege(oid, to_regclass('net._http_response'), 'INSERT,UPDATE,DELETE,TRUNCATE')
    or has_any_column_privilege(oid, to_regclass('net._http_response'), 'INSERT,UPDATE') as response_write
from pg_roles
where rolname in (current_user, 'anon', 'authenticated', 'authenticator', 'service_role');
```

Le propriétaire doit pouvoir exécuter `net.http_post`, lire la réponse et déchiffrer les deux secrets dédiés. Vérifier que les rôles applicatifs ne peuvent pas lire ces secrets et examiner les droits effectifs sur les tables internes de `pg_net`. Selon la version, ils peuvent être larges. Les signatures HMAC protègent l’intégrité des échanges. Les droits des rôles applicatifs sur ces tables peuvent toujours affecter la disponibilité de la collecte et doivent être examinés avant activation.

## Installation ultérieure, sur approbation

1. Après revue, appliquer manuellement les versions de cette branche de `20261105132645_qb_observation_log.sql` puis `202611060001_regular_weekly_qb_menu.sql`. L’observation et le menu sont séparés. Le menu est désactivé à l’installation. Les migrations n’activent aucun job, ne contiennent aucun secret et ne changent aucune sélection existante.
2. Générer le paquet autonome avec `node scripts/qb-announcements/package-observer.mjs /chemin/vers/un-nouveau-dossier`. Compresser le **contenu** du dossier en ZIP. Configurer une AWS Lambda Function URL en Node.js 24, handler `index.handler`, 512 Mo, timeout 50 secondes, sans VPC privé, NAT ou concurrence provisionnée. Utiliser la Function URL HTTPS avec le suffixe `/api/cron/qb-observation`. `AuthType=NONE` permet le POST de `pg_net`; le worker vérifie HMAC avant toute collecte. Limiter la concurrence et surveiller l’usage. L’endpoint refuse les appels non signés. N’y installer aucun identifiant de base.
3. Générer un secret aléatoire dédié de 32 octets, encodé en hexadécimal. Configurer `QB_OBSERVATION_SECRET` sur le worker et `qb_observation_secret` dans Vault, avec la même valeur. Stocker l’URL du worker dans Vault sous `qb_observation_url`. Garder `QB_OBSERVATION_ENABLED` absent ou désactivé jusqu’au feu vert. Les requêtes `POST` et les réponses sont signées en HMAC-SHA256. Le secret lui-même ne transite pas dans la file HTTP.
4. Vérifier hors Production un POST signé, son délai réel, la récolte et l’absence de proposition admissible produite par une projection. Une fois autorisé, planifier sous `postgres` le job `qb-observation-tick` à `*/5 * * * *` avec `set local lock_timeout = '250ms'; select public.run_qb_observation_tick();`. Le premier tick éligible suit l’ouverture et prend le titulaire connu comme référence. La réponse reste asynchrone. Le job récolte les réponses et ne lance qu’une collecte automatique par tranche de deux heures.
5. Garder le menu désactivé pendant l’observation. Après validation, l’activer comme propriétaire de préférence à l’ouverture d’une semaine vierge de choix. Un premier relevé complet et signé est requis pour écrire une correction. Vérifier l’Admin, le menu, les QB pris et la réservation avant de poursuivre.

```sql
-- Commande manuelle distincte, uniquement après validation du menu.
update qb_observation.regular_menu_config set enabled = true where singleton;
```

Pour suspendre la collecte, désactiver Cron et le flag du worker. Garder les réservations actives jusqu’à la fin de la semaine. Le menu continue de servir les affectations déjà enregistrées. Pour revenir au catalogue, passer `enabled = false` à une frontière de semaine avant le premier choix de la nouvelle semaine, après revue des offres. La règle de consommation reste celle du code applicatif déployé.

```sql
-- Planifier manuellement, une fois le worker signé validé et l’activation autorisée.
select cron.schedule('qb-observation-tick', '*/5 * * * *',
  $$set local lock_timeout = '250ms'; select public.run_qb_observation_tick();$$);

-- Désactivation rapide, sans toucher au menu ni aux réservations.
select cron.alter_job(jobid, active := false) from cron.job where jobname = 'qb-observation-tick';
```

Coût estimé pour la collecte. nflverse est gratuit. Pour Lambda à la demande, 372 passages de 50 s avec 512 Mo représentent 9 300 Go-secondes. Le coût de calcul et d’invocations attendu dans le quota gratuit est de 0 $ US, ou environ 0,16 $ US hors quota, journaux, transfert et taxes. Les appels non signés peuvent consommer des invocations.

Références officielles

- [Supabase Cron](https://supabase.com/docs/guides/cron/quickstart)
- [Supabase pg_net](https://supabase.com/docs/guides/database/extensions/pg_net)
- [Supabase Vault](https://supabase.com/docs/guides/database/vault)
- [AWS Lambda Function URLs](https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html)
- [Tarifs Lambda](https://aws.amazon.com/lambda/pricing/)
