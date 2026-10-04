# Résultats Playoffs traités

Le stockage est désormais explicite : `playoff_round_runs` et `playoff_round_results`, publiés atomiquement par la Mise à jour complète. La migration locale et son application **manuelle** sont documentées dans [`lib/playoffs/SCORING.md`](../../../../lib/playoffs/SCORING.md).

`read_playoff_results` lit une publication cohérente en une requête SQL, sans sa source privée. `processedPlayoffResults(data)` adapte uniquement ces résultats aux composants visuels existants : QB Ratings, classement de ronde, cumulatif et progression. Les sélections, scores bruts, LIVE, statuts de ronde et utilisateurs seuls ne créent jamais d’historique.

Sans migration, le loader conserve l’état vide. Les erreurs de permissions/réseau ne sont pas masquées. Un rating zéro est un résultat valide. Un QB partagé compte une fois par match dans sa moyenne; les auteurs sont regroupés. Les points de progression viennent des rangs cumulatifs enregistrés dans chaque publication, jamais recalculés à partir des picks.
