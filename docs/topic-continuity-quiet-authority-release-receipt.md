# Memory Fabric v2.2 — reçu d'implémentation

Date : 2026-08-08

Portée : Topic Continuity, Temporal Event Retrieval & Evidence Coverage, Quiet Authority

Runtime cible : `supermemory.codex-runtime.v5`
État : **contract-ready** ; validation live et approbation production à exécuter sur Z2

## Résultat livré

- Topic Dossier chiffré et append-only, résolution exacte/fork/high-confidence et migration historique sûre.
- Topic Working View bornée à 100K et Working Map v2 citée bornée à 8K.
- Checkpoints déterministes sur compaction et fin de session, enrichissement Hindsight séparé et non autoritaire.
- Recall multi-session lié au `working_set_id`, sans sélection libre ni listing de `topic_id` par MCP.
- Séparation stricte entre `observed_at`, `event_time` et validité d'autorité.
- Retrieval Plan déterministe, trois passages maximum, couverture vérifiée et abstention lorsque l'exhaustivité n'est pas prouvée.
- Quiet Authority versionnée avec états current, provisional, disputed, superseded, revoked et expired.
- Exceptions latent/visible/blocking, sans notification proactive, avec résolution auditée.
- Hindsight 0.9.0 demeure l'unique plan appris ; Neo4j/GraphD demeure la projection temporelle reconstruisible.
- Un seul provider et un seul modèle : `openai-codex`, `gpt-5.6-luna`, raisonnement `high`.
- Aucun canari, déploiement progressif, fallback provider, modèle local, index vectoriel ou service Docker supplémentaire.

## Preuves exécutées

| Gate | Résultat |
| --- | --- |
| Suite complète `npm test` | 276 tests ; 275 pass ; 0 fail ; 1 live skip explicite |
| Memory Fabric v2.0 | 45/45 critères, pass |
| Memory Fabric v2.2 | 42/42 critères, pass |
| Specs | pass |
| Secrets | 637 fichiers contrôlés, 0 finding |
| Codex release | pass |
| Release readiness | pass, y compris `memory_fabric_v22` |
| Syntaxe de tous les fichiers JS/MJS modifiés | pass |
| Compose six services | `docker compose config --quiet`, pass |
| Playwright — Travail et Exceptions | pass ; 0 erreur console |
| Codebase Memory | index fast rafraîchi ; 8 859 nœuds, 14 264 arêtes, 0 fichier source ignoré |

Le scénario multi-session retrouve et rouvre une décision citée de la première session après vingt sessions intermédiaires, puis vérifie sa disparition immédiate après tombstone. Le backup/restore conserve byte-for-byte les ledgers Topic, Authority et Exception et demande ensuite un rebuild déterministe.

## Gate live volontairement non simulé

`verify:runtime` retourne correctement `readiness_level=contract-ready` : le contrat est vert, mais aucun conteneur Hindsight Z2 n'est actif depuis cet environnement et aucune preuve live récente n'est présente. Ce résultat est attendu et fail-closed. Aucun service, modèle ou conteneur n'a été déployé localement pour contourner ce gate.

Après déploiement sur Z2, l'opérateur doit :

1. exécuter le smoke Hindsight authentifié avec une banque sacrificielle ou la banque de validation prévue ;
2. conserver le reçu live redacted de moins de 24 heures ;
3. relancer `npm run verify:runtime` ;
4. enregistrer l'approbation production explicite selon le runbook existant.

## Conclusion

L'implémentation et les contrats de release sont complets. La seule étape restante n'est pas du développement : c'est la preuve live sur la future base de production Z2 et la décision opérateur qui suit cette preuve.
