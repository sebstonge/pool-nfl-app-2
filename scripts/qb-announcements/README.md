# Prototype local de collecte des annonces QB

Le script lit les sources publiques NFL, clubs et ESPN. Le résultat JSON est un relevé de preuves et de propositions. La semaine et l'identité précédente sont des entrées locales. Le script ne connaît ni l'ouverture réelle des choix du pool ni ses réservations.

```sh
node scripts/qb-announcements/run.mjs --benchmark --limit 24
node --test scripts/qb-announcements/*.test.mjs
```

Le benchmark analyse les URL annotées dans `cases.mjs` et un échantillon des découvertes. Les articles historiques sont comparés au premier kickoff de leur propre semaine. Le roster actuel aide à vérifier leur identité ESPN, tandis que le statut de blessure actuel est réservé à la semaine courante. Le champ `historical` signale un rejeu. `proposals` contient les propositions pour la semaine demandée encore avant le gel et `replayedProposals` les cas historiques reconnus.

Pour une autre semaine, donner `--season`, `--week` et éventuellement une priorité `--team` répétable. `--baseline chemin.json` attend un objet indexé par abréviation d'équipe. Par exemple `{"ARI":{"id":"2578570","name":"Jacoby Brissett"}}`. Un champ ISO `publishedAt` facultatif indique la dernière annonce acceptée pour empêcher qu'une plus ancienne reprenne le dessus. Sans titulaire précédent renseigné, une annonce reste à examiner.

## Périmètre de collecte

L'index NFL et jusqu'à quatre clubs qui jouent sont consultés par exécution. La rotation se fait sur des créneaux de deux heures. Les URL canoniques sont dédupliquées. Le collecteur peut recevoir les URL déjà lues et les délais de reprise par domaine. Les robots, les délais et les erreurs d'accès bornent la collecte. Les 32 sources sont configurées à partir de l'annuaire NFL. Le benchmark mesure seulement les sources et les articles qu'il atteint. [Annuaire NFL](https://www.nfl.com/teams/)

Le calendrier complet provient de l'index des événements ESPN et du scoreboard de la semaine. L'ID et l'équipe du candidat viennent du roster ESPN. Les phrases explicites, leur attribution, le match visé et les dates servent à classer l'article. Le rang du depth chart ne participe pas à la décision.

Les détections individuelles évaluent les articles étiquetés. Le regroupement final garde la preuve admissible la plus récente pour le même match et la même équipe. Un conflit pertinent conserve l'identité précédente. Une modification d'article après le premier kickoff ne peut pas faire foi rétroactivement.

Le benchmark est une observation ponctuelle. La marge entre publication et gel est calculable. Mesurer le délai de première détection nécessite des passages successifs horodatés. À quatre clubs par passage, le cycle des 32 clubs prend jusqu'à 16 heures sans priorité. Une annonce peut donc manquer la fenêtre si elle ne remonte pas à l'index NFL.
