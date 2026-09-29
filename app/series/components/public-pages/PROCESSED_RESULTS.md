# Résultats Playoffs validés — branchement à venir

## État constaté dans le dépôt

- `playoff_picks`, `playoff_qb_picks` et `playoff_team_paths` décrivent les soumissions, pas les résultats d’une mise à jour complète.
- `playoff_games.game_status` et les scores décrivent les résultats des matchs. Un résultat ESPN FINAL ne valide ni le rating historique d’un QB ni les points/rangs du pool.
- La migration `202609250001_playoff_round_admin.sql` permet de passer une ronde à `finalized` lors de la progression des affrontements. Ce statut n’est donc pas une preuve de scoring. `roundOperations.mjs` réserve explicitement `scored` au futur workflow.
- Le loader collectif actuel ne lit aucune source de ratings Playoffs traités ou de snapshots de rangs cumulés. Aucune source de ce type n’est implémentée dans les migrations/helpers du dépôt inspecté. Aucun audit ni changement de la base distante n’est effectué dans ce chantier.

## Comportement actuel

`processedPlayoffResults()` retourne volontairement des listes vides. QB Ratings n’affiche aucune carte issue des sélections. Le graphique conserve son canevas et ses axes, mais aucune ligne, aucun point ni légende de joueur. Le nombre de joueurs détermine seulement l’échelle de l’axe Y. Les quatre libellés de l’axe X ne constituent pas des résultats.

Les panneaux de classement restent en attente. Aucune table, requête vers une table supposée, migration, règle de scoring ou lecture des résultats réguliers n’est ajoutée.

## Prochain chantier : Mise à jour complète / moteur de scoring Playoffs

Il faudra définir et implémenter un stockage qui distingue clairement une sélection, une donnée ESPN disponible et un résultat traité puis validé. Le processus devra publier des résultats cohérents et identifiables par saison, ronde et exécution validée, avec gestion explicite des recalculs. Un simple booléen fourni par le navigateur ou le statut de la ronde ne doit pas constituer cette preuve.

Remplacer le point d’intégration `processedPlayoffResults` par une lecture de cette source autorisée :

1. **QB Ratings** : charger exclusivement les ratings réellement enregistrés/validés ; regrouper les résultats par QB sur les séries ; fournir aux cartes existantes `qb`, `best`, `average`, `worst`. Les extrêmes portent leur libellé de ronde (`round_name`). Les règles DNP/remplacement et d’agrégation appartiennent à ce prochain chantier. Une sélection sans rating validé reste absente ; un rating valide de zéro reste admissible.
2. **Progression** : charger des snapshots de **rang cumulatif validé après chaque ronde**, jamais les dériver des picks. Fournir au composant existant `rows` avec `userId`, `name`, `realName` et `points` (`week` contient ici la clé de ronde, `rank` le rang validé). Ce nom interne `week` est conservé uniquement pour compatibilité avec le composant visuel copié. Un snapshot Wild Card donne un point ; Divisional ajoute le second ; les rondes sans snapshot validé ne produisent aucun point. Ne pas remplir les périodes manquantes ni propager un rang automatiquement.
3. **Classements** : brancher les panneaux de ronde et cumulatif sur les résultats de la même publication validée, sans formule frontend provisoire.
4. Ajouter des tests d’intégration du loader : absence de publication, résultat brut non validé, publication partielle, isolation des saisons, zéro valide, recalcul et snapshots successifs. Conserver les tests qui empêchent les soumissions, données LIVE/FINAL et statuts de ronde de devenir des résultats historiques.
