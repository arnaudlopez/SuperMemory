# Implémenter l’intégration Codex ↔ SuperMemory

## Objective

Transformer la conception validée dans
`docs/codex-supermemory-technical-design.md` en une intégration local-first
réellement utilisable : projets Codex liés à des workspaces SuperMemory,
capture visible et versionnée, mémoire gouvernée, recall MCP scopé, sécurité,
migration, diagnostic et rollback.

## Original Request

« Ok implémenter »

## Intake Summary

- Input shape: `existing_plan`
- Audience: utilisateur et mainteneur de SuperMemory
- Authority: `approved`
- Proof type: `demo`
- Completion proof: les 80 critères `AC-*` du blueprint sont couverts par des
  tests automatisés ou une preuve runtime datée ; les gates existants restent
  verts ; les canaries Desktop, CLI et IDE montrent le niveau de couverture
  réellement obtenu ; une sauvegarde et un rollback sont vérifiés.
- Goal oracle: un projet sacrificiel déplacé et utilisé depuis plusieurs
  sessions Codex conserve la même identité, journalise les événements visibles
  sans doublon, produit seulement des mémoires approuvées, les retrouve via MCP
  avec citations, puis les révoque et les purge sans fuite inter-workspace.
- Likely misfire: livrer quelques helpers, mocks ou contrats supplémentaires
  sans installation testable, sans recall Codex ou sans preuve de reprise.
- Blind spots considered: changements locaux documentaires non commités,
  compatibilité de la version Codex installée, process MCP réellement lié au
  projet, hooks préexistants de l’ancien compiler, secret stores multi-OS,
  migration de `workspace:local`, banques Hindsight par workspace, spool,
  suppression, clients non instrumentés et canaries non destructifs.
- Existing plan facts: le blueprint validé définit R01-R13, D01-D16, 80 AC et
  les slices S1-S7 ; le vault reste canonique ; Hindsight est reconstruisible ;
  App Server est primaire quand contrôlé, les hooks sont shadow ou primaires
  selon la session ; le MCP de contenu est lié au projet au lancement.

## Goal Oracle

The oracle for this goal is:

`Les 80 AC sont couverts et un canary local prouve de bout en bout identité stable -> capture/replay -> candidate inactive -> approbation -> recall MCP cité -> staleness/suppression -> rollback, sans fuite de secret ni mutation utilisateur non approuvée.`

The PM must keep comparing task receipts to this oracle. Planning, discovery, a
passing tiny slice, or a clean-looking board is not enough. The goal finishes
only when a final Judge/PM audit maps receipts and verification back to this
oracle and records `full_outcome_complete: true`.

## Goal Kind

`existing_plan`

## Current Tranche

Implémentation continue des slices S1-S7. Le premier package utile est S1 :
registre projet/workspace, resolver, identité stable et CLI `init/status`. Les
slices suivantes ajoutent journal/spool, hooks, App Server, gouvernance,
recall MCP, sécurité, migration, doctor et rollback. Le PM ne s’arrête pas
après S1 si des packages locaux sûrs restent disponibles.

## Non-Negotiable Constraints

- Préserver les modifications documentaires locales déjà présentes.
- Le vault reste la source de vérité ; Hindsight reste une projection.
- Les chemins sont des aliases, jamais l’identité primaire.
- Aucun transcript ou résultat LLM brut ne devient mémoire active.
- Ne jamais prétendre capturer le raisonnement caché ou un client non observé.
- Scope workspace obligatoire et fail-closed sur chaque accès mémoire.
- Redaction avant journal normalisé, chiffrement des archives/spools sensibles,
  rétention bornée et suppression attestée.
- Ne pas modifier `~/.codex`, un vault réel, des hooks actifs ou une
  configuration utilisateur pendant l’implémentation sans tâche dédiée,
  sauvegarde, plan explicite et autorité suffisante.
- Utiliser des répertoires temporaires et des profils Codex isolés pour les
  tests et canaries tant qu’une installation réelle n’est pas approuvée.
- Conserver Node.js 18 et 22, le mode local-first et les 55 tests existants.
- Chaque slice inclut ses tests, observabilité, migration de schéma et rollback.

## Stop Rule

Stop only when a final audit proves the full original outcome is complete.

Do not stop after planning, discovery, or Judge selection if the user asked for
working software or automation and a safe Worker task can be activated.

Do not stop after a single verified Worker package when the broader owner
outcome still has safe local follow-up work. Advance the board to the next
highest-leverage safe Worker package and continue unless a phase, risk,
rejected-verification, ambiguity, or final-completion review is due.

Do not create one Worker/Judge pair per repeated helper or fixture. Each Worker
owns a coherent vertical slice.

If a real user configuration mutation or destructive canary becomes the only
remaining proof, preserve the exact required action and ask once. Continue all
isolated, non-destructive implementation first.

## Slice Sizing

Safe means bounded, explicit, verified, and reversible. It does not mean tiny.

A good task is the largest safe useful slice.

Small is not the goal. Useful is the goal.

The seven blueprint slices are phase-sized packages. A Judge reviews after each
risk boundary and must immediately specify the next Worker package when the
goal oracle is not yet complete.

## Board Health

```bash
node /Users/arnaud/.codex/plugins/cache/goalbuddy/goalbuddy/0.4.1/skills/goal-prep/scripts/check-goal-state.mjs docs/goals/implement-codex-supermemory-integration
```

## Canonical Board

Machine truth lives at:

`docs/goals/implement-codex-supermemory-integration/state.yaml`

## Run Command

```text
/goal Follow docs/goals/implement-codex-supermemory-integration/goal.md.
```

## PM Loop

1. Lire ce charter et le contrat d’exécution GoalBuddy.
2. Lire `state.yaml` et travailler uniquement sur la tâche active.
3. Comparer chaque receipt au blueprint et à l’oracle de bout en bout.
4. Déléguer avec les rôles GoalBuddy exacts.
5. Préserver le dirty worktree initial et refuser toute régression.
6. Remplir les `allowed_files`, `verify` et `stop_if` d’un Worker avant de
   l’activer.
7. Écrire un receipt compact, vérifier et avancer immédiatement.
8. Terminer seulement après T999 avec `full_outcome_complete: true`.
