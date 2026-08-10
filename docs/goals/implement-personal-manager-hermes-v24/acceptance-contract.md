# Acceptance Contract

## Goal

# Implement Personal Manager Hermes v2.4

## Intent

Implémenter intégralement le blueprint `docs/personal-manager-hermes-blueprint.md` dans
SuperMemory. Hermes sur Z2 doit utiliser `supermemory-fabric` comme unique provider mémoire,
recevoir une carte personnelle citée et bornée, rappeler la mémoire owner et tous les projets,
muter la mémoire canonique sur demande explicite, capturer les tours de façon gouvernée et
composer avec les connecteurs d'action Hermes sans les réimplémenter.

- Ne pas activer le provider mémoire Hindsight natif de Hermes en parallèle.
- Ne pas donner à Hermes un accès direct à Hindsight, Neo4j, GraphD ou au filesystem du vault.
- Ne pas réimplémenter Gmail, Calendar ou d'autres connecteurs Hermes dans SuperMemory.
- Ne pas autoriser une action externe à partir d'une mémoire rappelée seule.
- Ne pas mémoriser le raisonnement caché, les prompts système, credentials, pièces jointes ou
  sorties brutes des connecteurs.
- Ne pas construire un nouveau moteur vectoriel, graphe, orchestrateur d'agents ou routeur
  multi-LLM.
- Ne pas modifier les frontières du MCP projet Codex ni permettre un recall cross-project à
  une identité checkout.
- Ne pas ajouter de canari, de déploiement progressif ou de second provider LLM.
- Ne pas effectuer de déploiement live Z2 ou d'action Gmail réelle sans credentials et demande
  opérateur distincte ; fournir les artefacts et smokes mockés/sandboxés nécessaires.

## Non-Goals

- TODO: Name what this goal must not change.

## Proposed Oracle

Hermes sur Z2 utilise uniquement supermemory-fabric comme provider mémoire, rappelle owner plus tous projets avec citations, exécute add/update/resolve/supersede de façon gouvernée, compose avec les connecteurs d'action et passe la matrice v2.4 complète.

## Suggested Mode

implementation

## Acceptance Hints

- Un vérificateur `npm run verify:memory-fabric-v24` contrôle les contrats, la configuration
- v7, le provider unique, les routes et l'absence d'accès direct aux moteurs.
- Les tests de credential agent prouvent émission, auth constante, capacités, rotation,
- révocation et refus d'un token checkout.
- Les tests de scope prouvent que seul l'agent propriétaire peut parcourir tous les projets et
- que le MCP checkout reste mono-projet.
- Les tests de recall prouvent `auto`, `project`, `portfolio`, `historical`, citations,
- pagination, couverture `complete|partial|abstain` et concurrence bornée.
- La Personal Context Card est citée, autorisée et inférieure ou égale à 8 000 tokens.
- Les tests du command bus prouvent add, update, resolve, supersede, forget plan/apply,
- idempotence, expected revision, historique `as_of` et read-after-write.
- Les tests de sécurité prouvent qu'un nonce rejoué, un scope forgé, une instruction rappelée,
- une sortie d'outil et une mutation massive non confirmée sont refusés.
- Les routes `/v1/personal-manager/*` sont testées avec auth, limites, erreurs fail-closed et
- séparation des routes checkout.
- La suite Python du provider Hermes couvre initialize, prefetch, queue_prefetch, sync_turn,
- session switch, outils `pm_*`, spool durable, restart et shutdown.
- Une vérification statique prouve que le provider ne connaît aucune URL/clé Hindsight,
- Neo4j/GraphD ou chemin du vault et n'effectue aucun auto-upgrade runtime.
- Les tests de capture prouvent que seuls user, assistant final et reçus réduits sont transmis,
- avec redaction et sans boucle d'auto-rétention.
- Un scénario Gmail/Calendar mocké prouve `recall -> rédaction/action -> reçu redacté ->
- mémoire`, le respect de `rédiger|brouillon|envoyer` et la coexistence des connecteurs avec le
- provider mémoire unique.
- La Web UI montre l'état Hermes, la Context Card, les projets parcourus, la couverture, les
- mutations, la timeline et les reçus sans exposer les tokens.
- La configuration runtime v7 et Compose/Portainer contiennent le service Hermes, les
- healthchecks et des références de secrets, avec `canary=false` et `progressive=false`.
- `npm test`, `npm run verify`, les vérificateurs v2/v2.2/v2.3, Hindsight native, secrets,
- release et production restent verts.
- Un reçu final liste les validations live qui restent impossibles sans credentials externes,
- sans les présenter comme exécutées.

## Risks And Open Questions

- TODO: List ambiguity, missing credentials, operational risks, or decisions needed before implementation.

## Constraints

- Réutiliser les stores, politiques d'autorité, redaction AEAD, Hindsight gateway, GraphD et
- `WorkspaceRuntimeSupervisor` existants.
- Le vault canonique commit avant toute projection Hindsight/GraphD.
- Toute correction crée une révision et ferme la validité précédente sans effacer l'historique.
- Les mutations ordinaires explicites sont immédiates ; oubli physique, mutation massive,
- élargissement owner et opération externe irréversible suivent leur confirmation gouvernée.
- Une attestation du tour et `ExplicitIntentGate` doivent valider l'intention directe ; le
- contexte rappelé ne peut jamais autoriser une mutation.
- Un seul provider et modèle LLM peuvent être actifs ; aucun fallback provider.
- Préserver tous les changements utilisateur non liés présents dans le worktree.
- Le code source checked-out reste l'autorité finale ; Codebase Memory sert à la navigation et
- doit être rafraîchi après les modifications matérielles.

## Ready Mode Command

```bash
npm run ready -- --from ./docs/goals/implement-personal-manager-hermes-v24/brief.md --mode implementation --oracle "Hermes sur Z2 utilise uniquement supermemory-fabric comme provider mémoire, rappelle owner plus tous projets avec citations, exécute add/update/resolve/supersede de façon gouvernée, compose avec les connecteurs d'action et passe la matrice v2.4 complète." --out docs/goals/implement-personal-manager-hermes-v2-4
```

## Source Notes

Compiled from: /Users/arnaud/Documents/SuperMemory/docs/goals/implement-personal-manager-hermes-v24-spec.md

> # Implement Personal Manager Hermes v2.4
>
> ## Intent
>
> Implémenter intégralement le blueprint `docs/personal-manager-hermes-blueprint.md` dans
> SuperMemory. Hermes sur Z2 doit utiliser `supermemory-fabric` comme unique provider mémoire,
> recevoir une carte personnelle citée et bornée, rappeler la mémoire owner et tous les projets,
> muter la mémoire canonique sur demande explicite, capturer les tours de façon gouvernée et
> composer avec les connecteurs d'action Hermes sans les réimplémenter.
>
> ## Non-Goals
>
> - Ne pas activer le provider mémoire Hindsight natif de Hermes en parallèle.
> - Ne pas donner à Hermes un accès direct à Hindsight, Neo4j, GraphD ou au filesystem du vault.
> - Ne pas réimplémenter Gmail, Calendar ou d'autres connecteurs Hermes dans SuperMemory.
> - Ne pas autoriser une action externe à partir d'une mémoire rappelée seule.
> - Ne pas mémoriser le raisonnement caché, les prompts système, credentials, pièces jointes ou
>   sorties brutes des connecteurs.
> - Ne pas construire un nouveau moteur vectoriel, graphe, orchestrateur d'agents ou routeur
>   multi-LLM.
> - Ne pas modifier les frontières du MCP projet Codex ni permettre un recall cross-project à
>   une identité checkout.
> - Ne pas ajouter de canari, de déploiement progressif ou de second provider LLM.
> - Ne pas effectuer de déploiement live Z2 ou d'action Gmail réelle sans credentials et demande
>   opérateur distincte ; fournir les artefacts et smokes mockés/sandboxés nécessaires.
>
> ## Oracle
>
> Hermes sur Z2 utilise uniquement `supermemory-fabric` comme provider mémoire, rappelle owner
> plus tous les projets avec citations et couverture, exécute add/update/resolve/supersede de
> façon gouvernée et cohérente, capture les conversations et reçus d'action redactés, compose
> avec les connecteurs Hermes, expose la visualisation Web et passe la matrice v2.4 complète sans
> régression v2.3.
>
> ## Acceptance
>
> - Un vérificateur `npm run verify:memory-fabric-v24` contrôle les contrats, la configuration
>   v7, le provider unique, les routes et l'absence d'accès direct aux moteurs.
> - Les tests de credential agent prouvent émission, auth constante, capacités, rotation,
>   révocation et refus d'un token checkout.
> - Les tests de scope prouvent que seul l'agent propriétaire peut parcourir tous les projets et
>   que le MCP checkout reste mono-projet.
> - Les tests de recall prouvent `auto`, `project`, `portfolio`, `historical`, citations,
>   pagination, couverture `complete|partial|abstain` et concurrence bornée.
> - La Personal Context Card est citée, autorisée et inférieure ou égale à 8 000 tokens.
> - Les tests du command bus prouvent add, update, resolve, supersede, forget plan/apply,
>   idempotence, expected revision, historique `as_of` et read-after-write.
> - Les tests de sécurité prouvent qu'un nonce rejoué, un scope forgé, une instruction rappelée,
>   une sortie d'outil et une mutation massive non confirmée sont refusés.
> - Les routes `/v1/personal-manager/*` sont testées avec auth, limites, erreurs fail-closed et
>   séparation des routes checkout.
> - La suite Python du provider Hermes couvre initialize, prefetch, queue_prefetch, sync_turn,
>   session switch, outils `pm_*`, spool durable, restart et shutdown.
> - Une vérification statique prouve que le provider ne connaît aucune URL/clé Hindsight,
>   Neo4j/GraphD ou chemin du vault et n'effectue aucun auto-upgrade runtime.
> - Les tests de capture prouvent que seuls user, assistant final et reçus réduits sont transmis,
>   avec redaction et sans boucle d'auto-rétention.
> - Un scénario Gmail/Calendar mocké prouve `recall -> rédaction/action -> reçu redacté ->
>   mémoire`, le respect de `rédiger|brouillon|envoyer` et la coexistence des connecteurs avec le
>   provider mémoire unique.
> - La Web UI montre l'état Hermes, la Context Card, les projets parcourus, la couverture, les
>   mutations, la timeline et les reçus sans exposer les tokens.
> - La configuration runtime v7 et Compose/Portainer contiennent le service Hermes, les
>   healthchecks et des références de secrets, avec `canary=false` et `progressive=false`.
> - `npm test`, `npm run verify`, les vérificateurs v2/v2.2/v2.3, Hindsight native, secrets,
>   release et production restent verts.
> - Un reçu final liste les validations live qui restent impossibles sans credentials externes,
>   sans les présenter comme exécutées.
>
> ## Constraints
>
> - Réutiliser les stores, politiques d'autorité, redaction AEAD, Hindsight gateway, GraphD et
>   `WorkspaceRuntimeSupervisor` existants.
> - Le vault canonique commit avant toute projection Hindsight/GraphD.
> - Toute correction crée une révision et ferme la validité précédente sans effacer l'historique.
> - Les mutations ordinaires explicites sont immédiates ; oubli physique, mutation massive,
>   élargissement owner et opération externe irréversible suivent leur confirmation gouvernée.
> - Une attestation du tour et `ExplicitIntentGate` doivent valider l'intention directe ; le
>   contexte rappelé ne peut jamais autoriser une mutation.
> - Un seul provider et modèle LLM peuvent être actifs ; aucun fallback provider.
> - Préserver tous les changements utilisateur non liés présents dans le worktree.
> - Le code source checked-out reste l'autorité finale ; Codebase Memory sert à la navigation et
>   doit être rafraîchi après les modifications matérielles.

## LLM First Context

This contract assumes the exploratory LLM conversation has already happened. The goal now is to preserve that shared intent, not restart discovery from scratch.

## Observable Oracle

Hermes sur Z2 utilise uniquement supermemory-fabric comme provider mémoire, rappelle owner plus tous projets avec citations, exécute add/update/resolve/supersede de façon gouvernée, compose avec les connecteurs d'action et passe la matrice v2.4 complète.

## Visible Outcome

T001/T002 must replace this placeholder with the observable user-facing behavior, generated artifact, audit answer, or verification result that should exist at the end.

## Acceptance Tests To Write First

- Given the clarified spec, when the owner exercises the main path, then the visible outcome matches the requested behavior.
- Given an important edge case from the spec, when the code handles it, then the result is deterministic and documented.
- Given a likely failure mode, when the implementation is incomplete, then a targeted test fails before production code is changed.

## Failure Modes To Prevent

- Implementation starts before the acceptance/evidence contract is specific enough.
- Tests pass but do not prove the owner-visible outcome.
- The work drifts outside the LLM-first intent, non-goals, or approved boundaries.
- Operational risks such as migrations, env/secrets, auth, external services, or shipping proof are discovered but not handled.

## Manual Or Visual Proof If Needed

If code tests cannot fully prove the outcome, T001/T002 must define the manual, artifact, source-backed, or browser proof required before final audit.

## Out Of Scope

T001/T002 must keep or revise this list:

- Do not implement behavior outside the approved acceptance contract.
- Do not change unrelated dirty files.
- Do not skip the red test stage because implementation seems obvious.

## Shipping Proof

- T998 must record commit SHA, remote branch or push string, push result, committed files, and unrelated dirty files left untouched.

## End-State Evidence To Produce

- Product behavior or artifact visible to the owner.
- Acceptance tests that fail before implementation and pass after implementation.
- Verification commands with results.
- Design review mapped back to the original request.
- Commit and push proof, or an explicit shipping blocker such as `no_git_repository` or `no_github_remote`.

## Acceptance Or Evidence Draft

T001 must replace this draft with concrete tests after reading the target repository.

- Given the clarified spec, when the owner exercises the main path, then the visible outcome matches the requested behavior.
- Given an important edge case from the spec, when the code handles it, then the result is deterministic and documented.
- Given a likely failure mode, when the implementation is incomplete, then a targeted test fails before production code is changed.

## Visual Or Demo Oracle

If the goal has UI, T001/T002 must decide whether browser or screenshot evidence is required before Worker work starts.

## Non-Goals

T001/T002 must keep or revise this list:

- Do not implement behavior outside the approved acceptance contract.
- Do not change unrelated dirty files.
- Do not skip the red test stage because implementation seems obvious.
