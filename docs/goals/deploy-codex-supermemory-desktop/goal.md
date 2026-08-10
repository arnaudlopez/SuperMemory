# Déployer SuperMemory dans Codex Desktop macOS

## Objective

Transformer l’intégration Codex déjà implémentée en une installation Desktop
macOS réellement active et réversible : projet lié, plugin et hooks approuvés,
daemon local démarré automatiquement, MCP disponible, capture gouvernée et
recall cité dans une nouvelle conversation Codex.

## Original Request

« Yeah. Ok essaie d implémenter ça »

## Intake Summary

- Input shape: `existing_plan`
- Audience: propriétaire et utilisateur de SuperMemory sur macOS
- Authority: `approved`
- Proof type: `demo`
- Completion proof: une nouvelle conversation Codex Desktop dans le projet lié
  déclenche une capture visible supportée, retrouve une mémoire approuvée via
  MCP avec citation, survit à un redémarrage, puis un rollback vérifié restaure
  l’état antérieur sans perdre le vault.
- Goal oracle: le vrai profil Codex et le vrai projet passent un canari
  non-sensible après sauvegarde, sans ancien hook concurrent ni secret dans les
  logs.
- Likely misfire: améliorer encore les mocks ou le packaging sans rendre
  SuperMemory effectivement disponible dans l’application macOS.
- Blind spots considered: ancien Memory Compiler encore actif, confiance
  obligatoire des hooks, différence entre projet local et hôte Remote, version
  Codex embarquée dans l’app, démarrage LaunchAgent, Hindsight/Ollama,
  permissions macOS, secrets, rollback du profil et données réelles.
- Existing plan facts: le plugin, le daemon, le MCP, le registre projet, le
  plan/apply/rollback et le canari isolé existent déjà ; le profil réel est
  actuellement non installé, le projet est non lié et les runtime configs sont
  absentes.

## Goal Oracle

The oracle for this goal is:

`Codex Desktop macOS, sur le projet SuperMemory lié et après installation
revue, capture un marqueur non sensible via le hook, expose le MCP scopé,
rappelle une mémoire approuvée avec citation après redémarrage, et peut revenir
à l’état sauvegardé sans perte du vault.`

The PM must keep comparing task receipts to this oracle. Planning, discovery, a
passing isolated canary, or a clean-looking board is not enough. The goal
finishes only when a final Judge/PM audit maps receipts and verification back
to this oracle and records `full_outcome_complete: true`.

## Goal Kind

`existing_plan`

## Current Tranche

Auditer l’environnement macOS réel, fermer les écarts de déploiement et
d’autostart dans un package réversible, appliquer le plan explicitement revu,
puis exécuter le canari Desktop réel. Continuer jusqu’au résultat observable ou
jusqu’à l’unique action de confiance UI que Codex impose au propriétaire.

## Non-Negotiable Constraints

- Sauvegarder et fingerprint chaque cible du profil Codex avant mutation.
- Ne jamais afficher ni committer les clés, tokens ou contenus utilisateur.
- Ne jamais activer simultanément l’ancien compiler et le nouveau hook.
- Ne pas éditer silencieusement `~/.codex/config.toml`.
- L’approbation de confiance des hooks reste une décision visible de
  l’utilisateur si Codex ne l’expose pas à une API sûre.
- Le vault reste canonique ; Hindsight reste une projection reconstructible.
- Une capture devient archive puis candidate ; elle ne devient pas mémoire
  active sans approbation.
- Le daemon reste loopback-only ; un hôte Remote doit exécuter son propre
  runtime ou faire l’objet d’une conception distincte.
- Préserver les changements locaux existants et garantir un rollback vérifié.

## Stop Rule

Stop only when a final audit proves the full original outcome is complete.

Do not stop after planning, discovery, implementation, or installation if the
Desktop canary has not proved capture and recall. If Codex requires one
explicit trust click and every other safe action is complete, record the exact
instruction once and wait without weakening the trust boundary.

## Slice Sizing

Le premier package couvre ensemble le déploiement macOS, l’autostart et le
diagnostic. L’application au vrai profil est une phase de risque séparée,
précédée d’un Judge et d’un plan sauvegardé. Le canari Desktop et le rollback
forment la preuve finale.

## Board Health

```bash
node /Users/arnaud/.codex/plugins/cache/goalbuddy/goalbuddy/0.4.1/skills/goal-prep/scripts/check-goal-state.mjs docs/goals/deploy-codex-supermemory-desktop
```

## Canonical Board

Machine truth lives at:

`docs/goals/deploy-codex-supermemory-desktop/state.yaml`

## Run Command

```text
/goal Follow docs/goals/deploy-codex-supermemory-desktop/goal.md.
```

## PM Loop

1. Lire ce charter et le contrat d’exécution GoalBuddy.
2. Lire `state.yaml` et travailler uniquement sur la tâche active.
3. Préserver la sauvegarde et le dirty fingerprint.
4. Déléguer avec les rôles GoalBuddy exacts.
5. Ne jamais confondre le canari isolé avec une preuve Desktop réelle.
6. Avancer jusqu’au canari, au rollback et à l’audit final.
