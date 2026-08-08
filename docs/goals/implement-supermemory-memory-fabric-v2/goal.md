# Implement SuperMemory Memory Fabric v2

## Objective

Implémenter le blueprint Memory Fabric v2 de bout en bout par lots sûrs et vérifiés : admission automatique, working memory 100K, evidence ledger, knowledge graph temporel first-class, ontologie évolutive, enrichissement continu, rappel hybride et déploiement serveur Docker/Portainer.

## Original Request

« ok go implent » à partir de `docs/supermemory-working-memory-100k-blueprint.md`.

## Intake Summary

- Input shape: `existing_plan`
- Audience: propriétaire et utilisateurs de SuperMemory
- Authority: `requested`
- Proof type: `test`
- Completion proof: les critères WM, KG, AD, RT et IM du blueprint sont couverts par des tests verts, les vérificateurs de release passent et le stack serveur peut être validé sans déploiement local du modèle ou du graphe.
- Goal oracle: matrice traçable des 45 critères d’acceptation vers des tests et démonstration automatisée du recall hybride avec provenance.
- Likely misfire: ajouter un graphe décoratif ou quelques contrats sans remplacer le parcours manuel `approve/reject`, sans intégration runtime, ou en saturant la machine locale.
- Blind spots considered: worktree déjà très sale, compatibilité avec les flux actuels, migration des données existantes, précision de l’admission automatique, sécurité des requêtes multi-hop, dépendance Graphiti/Neo4j, absence de service distant pendant les tests.
- Existing plan facts: blueprint v2 en 10 lots numérotés 0 à 9 ; graphe first-class mais reconstruit depuis le vault canonique ; Graphiti + Neo4j évalué en premier avec repli Neo4j direct ; revue humaine exceptionnelle et non nominale ; déploiement serveur via Docker/Portainer ; raisonnement borné à 3 hops par défaut et 5 maximum.

## Goal Oracle

The oracle for this goal is:

`Une matrice automatisée prouve la couverture des 45 critères du blueprint, npm test et les vérificateurs pertinents passent, et un scénario d’intégration démontre ingestion -> admission automatique -> graphe temporel -> recall hybride cité sans revue humaine nominale.`

The PM must keep comparing task receipts to this oracle. Planning, discovery, a passing tiny slice, or a clean-looking board is not enough. The goal finishes only when a final Judge/PM audit maps receipts and verification back to this oracle and records `full_outcome_complete: true`.

## Goal Kind

`existing_plan`

## Current Tranche

Exécution continue du blueprint v2. Le premier paquet réversible valide le plan contre la codebase puis migre les contrats de gouvernance vers une admission automatique compatible avec l’existant. Les lots suivants ajoutent le working store et l’evidence ledger, le graphe temporel, l’enrichissement et l’ontologie, le routeur de rappel/MCP, puis le packaging Portainer et les évaluations de release.

## Non-Negotiable Constraints

- Préserver les modifications utilisateur existantes et ne jamais réinitialiser le worktree.
- Le vault reste la source canonique ; les projections de travail et de graphe doivent être reconstructibles.
- Le LLM ne prend jamais seul une décision d’admission ; une politique déterministe et versionnée tranche à partir de signaux vérifiés.
- La revue humaine n’est pas le parcours normal et reste réservée aux exceptions définies dans le blueprint.
- Chaque fait ou arête rappelé doit exposer sa provenance et sa décision d’admission.
- Les requêtes multi-hop sont bornées et n’exécutent jamais de Cypher brut produit par le modèle.
- Aucun déploiement local de Qwen, Graphiti ou Neo4j ; le packaging cible le serveur Docker/Portainer.
- Les tests doivent fonctionner sans dépendre d’un service distant réel grâce à des adaptateurs et fixtures déterministes.
- Les changements de documentation normative font partie du lot 0 et doivent rester cohérents avec le code.

## Stop Rule

Stop only when a final audit proves the full original outcome is complete.

Do not stop after planning, discovery, or Judge selection if the user asked for working software or automation and a safe Worker task can be activated.

Do not stop after a single verified Worker package when the broader owner outcome still has safe local follow-up work. Advance the board to the next highest-leverage safe Worker package and continue unless a phase, risk, rejected-verification, ambiguity, or final-completion review is due.

Do not create one Worker/Judge pair per repeated file, table, route, or helper. Put repeated same-shape work into one Worker package and review the package as a whole.

## Slice Sizing

Safe means bounded, explicit, verified, and reversible. It does not mean tiny.

A good task is the largest safe useful slice. Workers complete vertical slices with their tests; Judges intervene at contract, risk, phase and completion boundaries.

## Board Health

```bash
node /Users/arnaud/.codex/plugins/cache/goalbuddy/goalbuddy/0.4.2/skills/goal-prep/scripts/check-goal-state.mjs docs/goals/implement-supermemory-memory-fabric-v2
```

## Canonical Board

Machine truth lives at:

`docs/goals/implement-supermemory-memory-fabric-v2/state.yaml`

## Run Command

```text
/goal Follow docs/goals/implement-supermemory-memory-fabric-v2/goal.md.
```

## PM Loop

À chaque continuation, lire le charter et `state.yaml`, exécuter uniquement la tâche active, produire un reçu, vérifier le paquet, puis avancer vers le prochain lot sûr jusqu’à preuve complète de l’oracle.
