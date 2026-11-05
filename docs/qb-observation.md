# Observation des annonces de QB titulaires

Le journal se consulte dans l’Admin régulier, sous **Observation QB**. La collecte utilise NFL.com, les sites officiels des clubs et le calendrier et les effectifs ESPN. Le QB affiché comme référence vient du titulaire actif du catalogue régulier. Une équipe sans titulaire identifiable de façon unique ne produit pas de proposition admissible.

## Flux d’observation

- Le tick PostgreSQL utilise la saison et la semaine régulières actives, l’ouverture réelle dans `qb_selection_weeks.started_at` et tous les matchs NFL de la semaine, admissibles au pool ou non. Il envoie au plus une collecte par tranche de deux heures à partir de l’ouverture.
- Le worker compare les IDs de ces matchs à ceux du calendrier ESPN complet et retient le plus tôt des deux premiers coups d’envoi. Un calendrier non concordant, un match commencé ou un gel atteint arrête la collecte ou rend son résultat inutilisable.
- NFL.com est prioritaire. Le worker sélectionne jusqu’à quatre sites de clubs par passage, avec trois places en rotation pour les équipes qui jouent et une pour les autres, lorsqu’il y en a. Si toutes les équipes jouent, les quatre places servent aux équipes de la semaine. Chaque passage est limité à 45 secondes et à 64 requêtes HTTP, toutes sources confondues. Les limites du prototype sur les articles et les robots continuent de s’appliquer. Les demandes `Retry-After` sont conservées entre passages.
- PostgreSQL récupère la réponse asynchrone de `pg_net` et vérifie sa signature, son contexte et son heure d’observation avant de journaliser les propositions. La déduplication utilise la saison, la semaine et l’URL canonique. Les signaux plus récents ou contradictoires peuvent rendre une ancienne proposition inadmissible dans le journal.
- Le worker isolé effectue uniquement des lectures HTTPS de sources publiques. Il ne reçoit ni identifiants Supabase, ni accès au catalogue. Le tick écrit seulement dans le schéma privé `qb_observation` et la file HTTP de `pg_net`. Le journal Admin passe par une RPC de lecture qui vérifie le rôle Admin de l’utilisateur.

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

1. Appliquer manuellement `supabase/migrations/20261105132645_qb_observation_log.sql`. Elle crée le journal et ses RPC dans une transaction. La création de secrets, l’installation d’extensions et la création d’un job Cron sont des opérations distinctes.
2. Générer le paquet autonome avec `node scripts/qb-announcements/package-observer.mjs /chemin/vers/un-nouveau-dossier`. Le déployer dans un **projet Vercel séparé**, Node.js 22, avec une durée de fonction de 60 secondes. Utiliser l’URL HTTPS canonique du worker se terminant par `/api/cron/qb-observation`, sans redirection ni écran d’authentification. Le projet ne doit contenir aucun identifiant de base.
3. Générer un secret aléatoire dédié de 32 octets, encodé en hexadécimal. Configurer `QB_OBSERVATION_SECRET` sur le worker et `qb_observation_secret` dans Vault, avec la même valeur. Stocker l’URL du worker dans Vault sous `qb_observation_url`. Garder `QB_OBSERVATION_ENABLED` absent ou désactivé jusqu’au feu vert. Les requêtes `POST` et les réponses sont signées en HMAC-SHA256. Le secret lui-même ne transite pas dans la file HTTP.
4. Après approbation, planifier sous le rôle propriétaire `postgres` la commande `select public.run_qb_observation_tick();` avec l’expression `*/5 * * * *`. Ce tick récolte rapidement les réponses de `pg_net` et prend en compte une ouverture dans les cinq minutes environ. Il ne lance qu’une collecte par tranche de deux heures. Activer le worker avec `QB_OBSERVATION_ENABLED=true` uniquement lorsque le projet et les permissions ont été vérifiés.
5. Pour suspendre l’observation, désactiver le job et retirer ou désactiver `QB_OBSERVATION_ENABLED`.

Références officielles

- [Supabase Cron](https://supabase.com/docs/guides/cron/quickstart)
- [Supabase pg_net](https://supabase.com/docs/guides/database/extensions/pg_net)
- [Supabase Vault](https://supabase.com/docs/guides/database/vault)
- [Vercel Node.js](https://vercel.com/docs/functions/runtimes/node-js)
