# Habillage saisonnier régulier

La couche décorative concerne Accueil, Mes choix et Tous les choix. La base navy,
les dimensions, les contrôles, la navigation et les couleurs fonctionnelles restent
inchangés. Aucun effet animé ni nouveau stockage n'est nécessaire.

- Source : matchs `is_pool_eligible = true` de la saison/semaine régulière active.
- Calendrier : `America/Toronto`, comme l'éligibilité régulière.
- Thanksgiving : quatrième jeudi de novembre de l'année du match.
- Noël : ambiance si la semaine contient un match admissible le 24 ou le 25 décembre.
  Le 24 reçoit un accent sapin discret; le 25 reçoit un accent rouge profond/sapin.
  Les autres cartes gardent leur aspect normal.
- Tous les choix : aucune décoration de calendrier lorsqu'on consulte une autre semaine.
- Accueil : petite lecture facultative du calendrier après connexion, limitée à
  `settings` et `games`. Un échec ne bloque jamais la page. Aucun RPC ni écriture.

## Aperçu sans Supabase

Dans le dépôt, démarrer Next en mode développement, avec des valeurs locales
factices. Ne pas utiliser de clé ni de projet Supabase réel :

```sh
WATCHPACK_POLLING=true NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 NEXT_PUBLIC_SUPABASE_ANON_KEY=local-placeholder SUPABASE_SERVICE_ROLE_KEY=local-placeholder NEXT_TELEMETRY_DISABLED=1 npm run dev -- --hostname 127.0.0.1 --port 3012
```

- http://127.0.0.1:3012/dev/seasonal-preview?seasonalPreview=thanksgiving
- http://127.0.0.1:3012/dev/seasonal-preview?seasonalPreview=christmas

Ajouter `&page=home` ou `&page=tous-les-choix` pour les autres compositions.
La galerie réutilise les véritables cartes régulières, avec des illustrations en
mémoire, sans monter les loaders des pages ni leurs actions de soumission.
Les logos utilisent le CDN ESPN habituel. Aucune donnée n'est persistée.

Sur les pages régulières locales déjà chargées, le même paramètre
`?seasonalPreview=thanksgiving` ou `?seasonalPreview=christmas` décore aussi les
données présentes sans changer leurs dates. Dans l'aperçu seulement, les accents
sont répartis par index : Thanksgiving / normal / normal, ou veille / Noël / normal.
Ce ne sont pas des affirmations sur les dates affichées.

En build Production, y compris Vercel Preview, le paramètre est ignoré et la galerie
retourne 404. Seules les dates réelles déclenchent les accents. Aucun numéro de
semaine NFL n'est codé en dur dans la détection.
