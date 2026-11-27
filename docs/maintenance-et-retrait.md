# Maintenance, récupération et retrait du pool NFL

## Repères de livraison

Le dépôt [sebstonge/pool-nfl-app-2](https://github.com/sebstonge/pool-nfl-app-2) contient le code, les migrations et les tests. Dans Vercel, vérifier le déploiement marqué **Production**, son état **Ready** et son commit Git. La refonte en lecture seule provient de `0f4e8d9828aca58455b11e02a4633db4c03c8a2c`. Le commit `1d884cda28a0f1a3f5b87628601efdfae1dc3f95` sert de repère pour revenir à l’interface antérieure avec l’observateur planifié.

Dans l’Observatoire Admin, sélectionne le titulaire à maintenir ou le remplaçant suggéré. Pour « Autre QB », vérifie l’identité proposée par ESPN avant de cliquer sur « Confirmer le titulaire ». Les sources et les effets sont repliés sous la fiche. Une projection reste une indication à vérifier. L’action manuelle est disponible avant le premier kickoff lorsque `manual_admin_enabled` est actif. Les deux réglages du menu automatisé, `enabled` et `automation_enabled`, restent à `false`.

## Ressources et coûts

| Ressource | Rôle |
| --- | --- |
| Vercel | Application Next.js et tâche de notifications `/api/push/scheduled` à 12 h 30 UTC dans le dépôt. |
| Supabase `pool-nfl` (Free, `ca-central-1`) | Authentification, données du pool et journal d’observation. |
| AWS Lambda `pool-nfl-qb-observer` et EventBridge Scheduler (`us-east-2`) | L’observateur reçoit un tick toutes les 15 minutes. La base autorise au plus une collecte par fenêtre de deux heures et une lecture de Sleeper par 24 heures. |
| GitHub | Historique du code et source des déploiements. |

Les services hébergés fonctionnent sans le Mac. PostgreSQL, les clusters jetables et les données fictives servent uniquement aux tests locaux. Le 24 novembre 2026, le journal a confirmé deux collectes autonomes et trois refus de l’intégrité nflverse. Un refus d’intégrité apparaît dans le journal et laisse le menu en place. Conserver la vérification d’intégrité.

Avec 512 Mo, 50 secondes par invocation et un mois de 31 jours, le rythme prévu sans relance représente au plus 2 976 invocations et 74 400 Go-secondes. Le coût d’invocation et de calcul de l’observateur est estimé à 0 USD si les quotas gratuits du compte restent disponibles. Les journaux CloudWatch et le transfert peuvent s’ajouter. Vérifier le montant réellement facturé dans AWS Billing, Vercel et Supabase. [Tarifs Lambda](https://aws.amazon.com/lambda/pricing/) · [Tarifs EventBridge Scheduler](https://aws.amazon.com/eventbridge/pricing/)

## Vérifications courantes et récupération

1. Vérifier l’accueil et l’Observatoire sur le domaine de Production. Dans une semaine réellement ouverte avant le premier kickoff, consulter les passages terminés du journal. Un tick hors fenêtre ne collecte aucune source. En cas de silence inattendu, comparer la dernière invocation AWS et le dernier passage enregistré en base.
2. Pour arrêter uniquement l’observateur, faire désactiver `qb_observation.transport_control.dispatch_enabled` par un administrateur de la base, puis désactiver sa planification EventBridge. Confirmer les deux états. Le journal et les données sportives restent disponibles. Consulter le [détail de l’observateur](qb-observation.md) avant une reprise ou une rotation du HMAC.
3. Pour suspendre les confirmations manuelles, faire repasser `manual_admin_enabled` à `false` par un administrateur de la base. En cas de régression web, revenir via Vercel à un déploiement compatible avec les confirmations déjà journalisées et vérifier son domaine, l’Admin et la tâche de notifications. Consulter la [procédure de retour arrière QB](qb-observation.md#désactivation-des-confirmations-manuelles). [Retour arrière Vercel](https://vercel.com/docs/instant-rollback)
4. En cas de perte de données, choisir une sauvegarde Supabase et vérifier sa date. Tester la restauration dans un projet isolé avant toute intervention en Production. Conserver séparément les objets Storage, le cas échéant, et les références de configuration. Une restauration de la base seule ne restaure pas les objets Storage. Garder les secrets dans leur coffre, hors du dépôt. [Sauvegardes Supabase](https://supabase.com/docs/guides/platform/backups)

## Désinstallation complète

La suppression définitive requiert une décision explicite du propriétaire et une sauvegarde vérifiée.

1. Identifier les domaines, services et ressources appartenant exclusivement au pool. Archiver le dépôt et le commit de Production, exporter les données à conserver, vérifier la restauration et noter les dépendances de configuration sans copier les secrets dans l’archive.
2. Arrêter l’observateur comme indiqué plus haut. Désactiver ensuite la tâche de notifications et retirer la mise en ligne Vercel. Vérifier que le domaine et les déclencheurs ne dirigent plus de trafic vers le projet.
3. Pour le retrait AWS, supprimer uniquement la planification dédiée, l’alias ou la Lambda dédiée selon son usage, puis le rôle d’invocation et le groupe de journaux dédiés après export si nécessaire. Révoquer le HMAC de l’observateur. Vérifier dans AWS qu’aucune tâche ni ressource facturable dédiée ne subsiste.
4. Pour le retrait Vercel, supprimer le projet dédié après le retrait des domaines et des connexions spécifiques au pool. Pour Supabase, supprimer le projet uniquement après confirmation qu’il est dédié au pool, que ses exports sont utilisables et que les autres consommateurs sont arrêtés. Si seule la veille QB est retirée, conserver le projet Supabase et ses objets sportifs.
5. Archiver GitHub ou supprimer le dépôt avec une autorisation distincte. Sur le Mac, arrêter uniquement les processus de test du projet, démonter son image disque si elle subsiste et retirer les copies PostgreSQL et répertoires temporaires dédiés. Identifier chaque chemin avant la suppression et conserver les outils, bases et dossiers partagés.
