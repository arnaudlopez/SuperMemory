# SuperMemory Runtime Production Approval

## Objective

Faire passer SuperMemory du niveau `contract-ready` au niveau `runtime-ready`, puis établir une décision de production explicite, traçable et fondée sur une preuve Hindsight locale réelle.

## Original Request

« Ok va y. Objectif production ready »

## Intake Summary

- Input shape: `existing_plan`
- Audience: propriétaire et opérateur de SuperMemory
- Authority: `approved`
- Proof type: `test`, `artifact`, `review`, `decision`
- Completion proof: les gates contractuel, runtime et production passent sur le périmètre local-first, avec une preuve live récente et un audit final qui enregistre `full_outcome_complete: true`.
- Goal oracle: un smoke Hindsight réellement exécuté sur une banque locale sacrificielle produit une preuve fraîche et expurgée; le gate runtime retourne `runtime_ready: true`; le gate de production exige et enregistre une approbation explicite après revue.
- Likely misfire: déclarer production-ready sur la seule base des tests mock, ou effectuer des écritures cloud/non sacrificielles.
- Blind spots considered: variables live absentes, ancien reçu live périmé, état du conteneur, caractère sacrificiel de la banque, rollback, fuite de secrets, diff non commité, distinction entre autorisation d’exécuter et approbation finale.
- Existing plan facts: le durcissement contractuel est implémenté; 33 tests passent; `verify-supermemory-release-readiness.mjs` retourne `contract-ready`; le dernier contrôle runtime a bloqué sur les variables live absentes et une preuve vieille d’environ 1291 heures.

## Goal Oracle

The oracle for this goal is:

`contract_ready=true + strict local preflight ready + fresh redacted live smoke pass on a sacrificial local bank + runtime_ready=true + explicit post-evidence production approval + final audit full_outcome_complete=true`

The PM must keep comparing task receipts to this oracle. Planning, discovery, a passing mock slice, or a healthy container alone is not enough.

## Goal Kind

`existing_plan`

## Current Tranche

Valider le plan déjà implémenté, produire la preuve live locale manquante, corriger tout défaut runtime reproductible, ajouter ou compléter la surface d’approbation production si nécessaire, puis exécuter l’audit final. Continuer tant qu’un travail local sûr peut faire avancer l’objectif.

## Non-Negotiable Constraints

- Hindsight local/self-hosted uniquement; aucun fallback cloud.
- Banque sacrificielle dédiée; aucune donnée client ou production réelle.
- Ne jamais afficher, écrire dans le repo ou commiter une clé ou un reçu live.
- Toute écriture Hindsight passe par un plan revu et une confirmation owner.
- CI reste mock-only et sans credentials.
- Préserver les changements existants et ne pas pousser vers un remote sans demande explicite.
- Ne pas confondre `runtime-ready` avec une approbation production postérieure à la preuve.

## Stop Rule

Stop only when a final audit proves the full original outcome is complete.

If fresh live credentials or an exact post-evidence approval is the only remaining blocker and no safe local work remains, record the blocker and required reply exactly once.

## Canonical Board

Machine truth lives at:

`docs/goals/supermemory-runtime-production-approval/state.yaml`

## Run Command

```text
/goal Follow docs/goals/supermemory-runtime-production-approval/goal.md.
```
