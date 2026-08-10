# Concevoir l’intégration technique Codex ↔ SuperMemory

## Objective

Produire une conception technique implémentable qui relie durablement les projets et dossiers Codex aux workspaces SuperMemory, capture et versionne les activités visibles des sessions Codex, puis expose à Codex une mémoire gouvernée et interrogeable à la demande.

## Original Request

« Maintenant, passe à la conception technique. »

## Intake Summary

- Input shape: `existing_plan`
- Audience: mainteneur et futurs implémenteurs de SuperMemory
- Authority: `approved`
- Proof type: `artifact`
- Completion proof: un document de conception versionné, sourcé et revu couvre les contrats, modèles, flux, risques, migrations, observabilité et critères d’acceptation sans ambiguïté bloquante pour l’implémentation.
- Goal oracle: revue finale de la conception contre le code SuperMemory actuel, les contrats Codex officiels et l’objectif produit approuvé.
- Likely misfire: produire une architecture séduisante mais non compatible avec le store mono-workspace actuel, les limites des hooks, la gouvernance du vault ou le recall fail-closed.
- Blind spots considered: identité stable après déplacement ou renommage, collisions multi-projets, worktrees et projets multi-dossiers, capture incomplète des outils hébergés, secrets dans les transcripts, double source de vérité avec les Memories natives de Codex, disponibilité du daemon local et migration de l’ancien memory compiler.
- Existing plan facts: project resolver stable, journal détaillé distinct de la mémoire active, snapshots de fichiers et de tours Codex, hooks de capture, MCP de recall, injection SessionStart bornée, Hindsight comme projection remplaçable, validation avant activation.

## Goal Oracle

The oracle for this goal is:

`Un Judge peut mapper chaque exigence produit approuvée à un contrat technique, un flux, un schéma, une stratégie d’échec et au moins un critère d’acceptation dans docs/codex-supermemory-technical-design.md, puis enregistrer full_outcome_complete: true.`

The PM must keep comparing task receipts to this oracle. Planning, discovery, a passing tiny slice, or a clean-looking board is not enough. The goal finishes only when a final Judge/PM audit maps receipts and verification back to this oracle and records `full_outcome_complete: true`.

## Goal Kind

`existing_plan`

## Current Tranche

Cette tranche est volontairement limitée à la conception technique et à sa revue. Elle doit livrer un artefact suffisamment précis pour découper ensuite l’implémentation en vertical slices vérifiables. Elle n’installe pas encore le plugin Codex, ne modifie pas les hooks globaux et ne migre aucune donnée.

## Non-Negotiable Constraints

- Le vault SuperMemory reste la source de vérité ; Hindsight reste une projection reconstruisible.
- Les chemins absolus sont des alias, jamais l’identité primaire d’un projet.
- Les conversations détaillées sont historisées séparément des mémoires autorisées pour le recall.
- Aucune conclusion LLM brute ne devient mémoire active sans gouvernance explicite.
- La conception doit couvrir Desktop, CLI et extension IDE avec dégradation explicite.
- La capture ne doit jamais promettre le raisonnement interne caché du modèle.
- Les secrets, données sensibles et sorties volumineuses doivent avoir une politique de redaction, chiffrement, rétention et suppression.
- Utiliser la documentation OpenAI officielle comme source de vérité pour hooks, MCP et App Server.
- Ne modifier aucun code produit ni configuration utilisateur pendant cette tranche.

## Stop Rule

Stop only when a final audit proves the full original outcome is complete.

Pour cette tranche de conception uniquement, `full original outcome` signifie l’artefact technique complet et revu décrit par l’oracle, pas l’implémentation du système.

## Slice Sizing

Safe means bounded, explicit, verified, and reversible. It does not mean tiny.

A good task is the largest safe useful slice.

Small is not the goal. Useful is the goal.

## Board Health

```bash
node /Users/arnaud/.codex/plugins/cache/goalbuddy/goalbuddy/0.4.1/skills/goal-prep/scripts/check-goal-state.mjs docs/goals/design-codex-supermemory-integration
```

## Canonical Board

Machine truth lives at:

`docs/goals/design-codex-supermemory-integration/state.yaml`

## Run Command

```text
/goal Follow docs/goals/design-codex-supermemory-integration/goal.md.
```

## PM Loop

1. Lire ce charter et le contrat d’exécution GoalBuddy.
2. Lire `state.yaml` et travailler uniquement sur la tâche active.
3. Préserver le périmètre conception-only.
4. Vérifier les décisions contre le code actuel et la documentation OpenAI officielle.
5. Écrire un receipt compact après chaque tâche.
6. Terminer uniquement après l’audit final de l’oracle.
