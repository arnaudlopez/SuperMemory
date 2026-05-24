# Roadmap d'implementation vers le Golden Case

Ce document decoupe le chemin entre l'etat actuel de SuperMemory V2 et le Golden Case `enterprise-living-memory-complete`.

Le principe de decoupage est volontairement vertical :

```text
preuve locale -> promotion gouvernee -> recall filtre -> reponse sourcee -> changement -> revue -> Golden Case
```

Chaque tranche doit avoir un oracle executable. Une tranche est terminee seulement si une commande, une fixture ou une reponse attendue prouve le comportement vise.

## Cible finale

Le Golden Case est atteint quand SuperMemory sait traiter ce scenario complet :

- sources entreprise mutables ;
- snapshots immuables t0/t1 ;
- observations extraites ;
- memoires candidates puis validees ;
- relations explicites ;
- promotion Hindsight gouvernee ;
- recall filtre par agent, workspace, sensibilite et statut ;
- reponses citees avec snapshots ;
- changement de source et re-promotion ;
- conflit support/API ;
- source indisponible ;
- type metier cree a la demande ;
- secret redacte ;
- `do_not_use` exclu ;
- legal hold et retention ;
- action externe confirmee ;
- Graphiti/Memoria non actives sauf eval rouge.

Le contrat conceptuel de reference est :

```text
Source -> SourceSnapshot -> Observation -> InterpretationCandidate -> MemoryCandidate -> ValidatedMemory
-> Relation -> HindsightDocument / Retrieval -> Answer -> Feedback / Change
```

## Tranche 0 - Baseline de conception verrouillee

Statut : fait.

Objectif :

- avoir les specs V2 ;
- adopter Hindsight comme moteur ;
- definir le modele vivant ;
- definir le Golden Case enterprise ;
- definir le contrat sequentiel relationnel.

Oracle :

```bash
node scripts/verify-supermemory-specs.mjs
```

Livrables existants :

- `docs/prd-memoire-agentique-v2.md`
- `identity-vault/75_governance/sequential_relational_model.md`
- `identity-vault/90_evals/cases/enterprise-living-memory-complete/expected/`

## Tranche 1 - Contrats techniques minimaux

Objectif :

Transformer le contrat conceptuel en objets techniques minimaux, sans integrer encore Hindsight.

Objets a definir :

- `Source`
- `SourceSnapshot`
- `Observation`
- `InterpretationCandidate`
- `MemoryCandidate`
- `ValidatedMemory`
- `Relation`
- `HindsightPromotionPayload`
- `RecallPolicy`
- `AnswerEvidence`

Livrables :

- schemas ou types minimaux ;
- fixture courte lisible ;
- verificateur qui refuse un objet sans provenance, status, freshness ou access policy.
- verificateur qui refuse une interpretation sans evidence, confidence, uncertainty, use pattern connu, review state sur, ou provenance de promotion.

Oracle :

```text
Une commande locale valide qu'une memoire active ne peut pas exister sans snapshot,
status, freshness, workspace, access_policy et relation de preuve.
```

Non-objectifs :

- pas de moteur Hindsight ;
- pas de connecteur ;
- pas de UI.

## Tranche 2 - Fixture M1 Acme gouvernee

Objectif :

Construire une fixture plus petite que le Golden Case, mais complete sur le chemin heureux.

Scenario minimal :

- une source externe Acme ;
- une snapshot ;
- une observation ;
- une interpretation candidate approuvee ;
- une memoire validee ;
- des relations `interprets_observation` et `derives_from` ;
- une promotion attendue ;
- une question de rappel ;
- une reponse avec `snapshot_id`.

Livrables :

- fichiers `identity-vault/90_evals/cases/m1-hindsight-promotion-recall/`;
- expected final state ;
- script de verification dedie.

Oracle :

```text
La fixture prouve qu'une memoire gouvernee peut passer de snapshot a interpretation sourcee, puis a reponse sourcee.
```

## Tranche 3 - Adaptateur Hindsight local minimal

Objectif :

Prouver le passage SuperMemory -> Hindsight au niveau contrat avec le plus petit adaptateur utile, sans dependre encore d'un runtime Hindsight reel.

Fonctions minimales :

- `retain` ou upsert avec `document_id` stable ;
- `recall` fail-closed avec tags restrictifs ;
- suppression ou exclusion forte de `do_not_use` ;
- metadata de provenance ;
- traces utiles sur retain, delete et recall.

Livrables :

- adaptateur Hindsight minimal fake/local ;
- payload de promotion ;
- test actif vs `do_not_use` ;
- test anti auto-retain global ;
- evidence de reponse liee au recall trace.

Oracle :

```text
Un item actif est rappelable avec metadata.
Un item do_not_use est absent du recall actif.
Le recall echoue ferme si les filtres minimaux sont absents.
Un meme document_id upserte une seule entree active.
Un item non explicitement promu n'est jamais retenu automatiquement.
```

Point de vigilance :

- ne pas activer auto-retain global ;
- ne pas scanner tout le vault.
- ne pas presenter le fake/local contract comme une integration runtime Hindsight.

## Tranche 4 - Reponse gouvernee avec evidence

Objectif :

Ne pas seulement rappeler une memoire : produire une reponse qui prouve pourquoi elle est utilisable.

Comportements :

- construire `AnswerEvidence` ;
- citer `source_id`, `snapshot_id`, `document_id` ;
- citer `adapter_trace_ids` quand la reponse depend d'un recall ;
- relier chaque memoire utilisee par `supports_answer` ;
- exposer `answer_state`;
- refuser ou degrader la reponse si la memoire est stale, changed, needs_review, restricted, unavailable, conflicting ou forbidden.

Oracle :

```text
Une question retourne une reponse actuelle avec snapshot cite.
La meme question avec memoire stale retourne "derniere snapshot connue" ou demande revue.
Une reponse recall-backed sans trace adapter est rejetee.
Une memoire do_not_use n'apparait jamais comme preuve utilisee.
```

## Tranche 5 - Cycle source mutable t0/t1

Objectif :

Introduire le changement de source sans versionnement explicite.

Scenario :

- meme URL ou meme record externe ;
- snapshot t0 ;
- snapshot t1 avec hash different ;
- relation `previous_snapshot_id` / `supersedes_snapshot` ;
- ancienne memoire derivee marquee `stale` ou `needs_review` ;
- re-promotion apres revue avec le meme `document_id`.
- source indisponible traitee comme `unavailable`, jamais comme preuve de fraicheur.

Oracle :

```text
Quand une source change, une nouvelle snapshot est creee,
la memoire derivee devient needs_review,
puis la version revue est re-promue avec le meme document_id.
Quand une source est indisponible, aucun nouveau snapshot frais n'est invente.
```

Contrat executable :

```bash
node scripts/verify-source-change-t0-t1.mjs
```

## Tranche 5a - Local manual source capture

Objectif :

Prouver le premier flux concret de capture source sans connecteur externe.

Scenario :

- une source locale/manuelle explicite est fournie par le proprietaire ;
- la capture declare `requested_by`, `capture_reason`, `owner_confirmed`, workspace, source kind, sensibilite et scope ;
- une seule entree de source registry et une seule snapshot immuable sont creees ;
- le scope interdit les fichiers voisins et les scans de dossier ;
- le texte source reste une preuve, jamais une instruction agent executable ;
- les secrets ne sortent pas vers les surfaces derivees ou promues ;
- une source `do_not_use` ne cree aucune preuve active.

Contrat executable :

```bash
node scripts/verify-local-manual-source-capture.mjs
```

Ce contrat reste local et deterministe. Il ne lit pas le disque, ne scanne aucun dossier, n'appelle aucun connecteur reel et ne promeut rien dans Hindsight.

## Tranche 5a.1 - Local manual capture dry-run

Objectif :

Transformer le contrat local/manual en commande operateur dry-run.

Scenario :

- l'operateur fournit explicitement un fichier et un scope ;
- la commande lit uniquement ce fichier ;
- elle calcule `content_hash` et emet un plan `manual_captures`, `source_registry_entries`, `snapshots` ;
- elle refuse les dossiers, les refs hors scope et l'intent owner incomplet ;
- elle ne sort pas le contenu brut du fichier, les instructions source ou les secrets ;
- elle peut persister le plan avec `--write-plan <file>` hors vault ;
- elle ne modifie pas le vault et n'appelle aucun service externe.

Contrat executable :

```bash
node --test tests/local-manual-capture-cli.test.mjs
```

## Tranche 5a.2 - Local manual capture staging apply

Objectif :

Permettre a l'operateur de rejouer un plan dry-run deja revu vers un dossier de staging, sans ingestion finale.

Scenario :

- l'operateur fournit `--apply-plan <file>` et `--out-dir <staging-dir>` ;
- la commande relit le plan sauvegarde sans relire la source locale ;
- elle refuse les plans invalides, les plans avec erreurs de validation, les payloads de promotion et les champs de contenu brut ;
- elle ecrit uniquement des artefacts JSON reviewables dans le staging ;
- elle refuse toute ecriture directe sous `identity-vault` ;
- elle ne modifie pas le vault et n'appelle aucun service externe.

Contrat executable :

```bash
node --test tests/local-manual-capture-cli.test.mjs
```

## Tranche 5a.3 - Local manual capture vault review gate

Objectif :

Permettre a l'operateur de valider un staging deja relu et de l'inscrire dans les registres finaux du vault, sans compilation memoire ni promotion Hindsight.

Scenario :

- l'operateur fournit `--commit-staging <staging-dir>`, `--vault-root <identity-vault>` et `--owner-confirmed` ;
- la commande relit `manifest.json`, `capture-plan.json`, `source-registry.json` et `snapshots.json` depuis le staging ;
- elle verifie que le staging provient d'un `apply-plan`, reste coherent avec le plan et ne contient pas de payload de promotion ;
- elle refuse le commit sans confirmation owner explicite ;
- elle ecrit uniquement dans `00_inbox/source_registry.md` et `00_inbox/snapshot_registry.md` ;
- elle refuse les doublons de source ou de snapshot avant toute ecriture ;
- elle ne compile pas de note active et n'appelle aucun service externe.

Contrat executable :

```bash
node --test tests/local-manual-capture-cli.test.mjs
```

## Tranche 5a.4 - Local manual capture operator workflow smoke

Objectif :

Prouver la chaine operateur complete sans toucher au vault reel.

Scenario :

- le smoke cree une source locale temporaire, un scope explicite, un staging et un vault temporaire ;
- il execute `dry-run`, `--write-plan`, `--apply-plan` et `--commit-staging` via la CLI operateur ;
- il verifie que le commit sans `--owner-confirmed` echoue ;
- il verifie que le commit confirme ecrit uniquement les registres source/snapshot du vault temporaire ;
- il verifie que les secrets, instructions source et fichiers voisins ne sortent pas dans les sorties ou registres ;
- il verifie que le deuxieme commit du meme staging est refuse comme doublon.

Contrat executable :

```bash
node scripts/verify-local-manual-capture-workflow.mjs
```

## Tranche 5b - Source snapshot refresh preflight

Objectif :

Prouver localement la decision de refresh avant connecteur reel.

Scenario :

- source unchanged : aucun nouveau snapshot ;
- source changed : plan de nouveau snapshot immuable avec `previous_snapshot_id` ;
- source unavailable : last-known/unverified, jamais fresh ;
- source `do_not_use` : skip, sans promotion active ;
- memoire derivee d'un snapshot change routee vers revue.

Contrat executable :

```bash
node scripts/verify-source-snapshot-refresh-preflight.mjs
```

Ce contrat reste local et deterministe. Il ne fetch aucune source externe, ne scanne pas tout le vault, et ne lance pas de promotion Hindsight live.

## Tranche 5c - Source refresh connector boundary

Objectif :

Prouver la frontiere connecteur avant tout vrai connecteur externe.

Scenario :

- un connecteur local `fixture_connector` est autorise, scope et configure ;
- ses resultats produisent des `refresh_candidates` auditables ;
- un resultat changed conserve `previous_snapshot_id` jusque dans le plan de snapshot ;
- un resultat unavailable ne cree aucune preuve fraiche ;
- une source `do_not_use` est bloquee avant refresh ou promotion active ;
- les secrets de connecteur restent redactes.

Contrat executable :

```bash
node scripts/verify-source-refresh-connector-boundary.mjs
```

Ce contrat reste local et deterministe. Il ne remplace pas un connecteur Gmail, Drive, Web ou CRM reel : il fixe l'interface que ces connecteurs devront respecter.

## Tranche 5c.1 - Local file source refresh CLI

Objectif :

Transformer la frontiere connecteur en premier refresh concret pour une source `local_file` enregistree, sans scan large ni mutation du vault.

Scenario :

- l'operateur fournit un registre JSON explicite et un `source_id` ;
- la commande utilise uniquement un connecteur `local_file` active et configure ;
- elle valide `workspace_id`, `source_kind`, `connector_scope` et `allowed_scopes` par chemins reels ;
- elle lit exactement `original_ref` si la source est active et disponible ;
- source unchanged : aucun nouveau snapshot ;
- source changed : plan de snapshot immuable avec `previous_snapshot_id` et item de revue pour les memoires derivees ;
- source unavailable : last-known/unverified, jamais fresh ;
- source `do_not_use` : bloque avant lecture de contenu ;
- elle ne sort jamais le contenu brut, les instructions source ou les secrets ;
- elle ne modifie pas le vault et ne promeut rien dans Hindsight.

Contrat executable :

```bash
node --test tests/local-file-source-refresh-cli.test.mjs
```

## Tranche 5c.2 - Local file source refresh workflow smoke

Objectif :

Prouver la chaine operateur locale pour un refresh `local_file` avec plan persistable, sans mutation du vault.

Scenario :

- le smoke cree un registre, une source locale, une source manquante, une source `do_not_use` et un scope voisin ;
- il execute la CLI sur une source changed avec `--write-plan` ;
- il verifie le snapshot planifie, le `previous_snapshot_id` et la route `needs_review` ;
- il verifie que le plan persiste ne contient ni contenu brut, ni instruction source, ni secret ;
- il applique le plan vers un dossier de staging reviewable, hors vault ;
- il verifie les artefacts de staging et le manifest sans fuite de contenu brut ;
- il verifie unavailable, `do_not_use` et scope escape ;
- il ne modifie pas le vault et ne promeut rien dans Hindsight.

Contrat executable :

```bash
node scripts/verify-local-file-source-refresh-workflow.mjs
```

## Tranche 5c.3 - Local file source refresh staging gate

Objectif :

Permettre a l'operateur de rejouer un plan de refresh `local_file` deja revu vers un dossier de staging, sans ingestion finale.

Scenario :

- l'operateur fournit `--apply-plan <file>` et `--out-dir <staging-dir>` ;
- la commande accepte uniquement un plan dry-run `generated_from: local_file_source_refresh` ;
- elle refuse les plans invalides, les erreurs de validation, les champs de contenu brut, les payloads de promotion et les lineage changed-source incomplets ;
- elle bloque les dossiers non vides et les destinations sous `identity-vault` ;
- elle ecrit uniquement `refresh-plan.json`, `connector-runs.json`, `connector-results.json`, `refresh-candidates.json`, `refresh-plans.json`, `snapshot-candidates.json`, `review-items.json` et `manifest.json` ;
- source changed : le staging conserve `previous_snapshot_id`, `connector_result_id`, `created_snapshot_id` et la route `needs_review` ;
- source unavailable ou `do_not_use` : aucun nouveau snapshot candidat et aucune promotion active ;
- elle ne compile pas la memoire active et ne promeut rien dans Hindsight.

Contrat executable :

```bash
node --test tests/local-file-source-refresh-cli.test.mjs
node scripts/verify-local-file-source-refresh-workflow.mjs
```

## Tranche 5d - Local manual source capture

Objectif :

Prouver le premier workflow concret de capture source sans connecteur externe.

Scenario :

- une source locale/manuelle explicite est demandee par le owner ;
- la capture est bornee a un seul fichier/ref, sans scan voisin ;
- une entree de source registry et une snapshot immuable sont produites ;
- la snapshot cite `source_id`, `connector_id`, `connector_scope`, `original_ref`, `content_hash` et `captured_at` ;
- le texte source reste une preuve, jamais une instruction agent ;
- les secrets sont redactes avant memoire derivee ou promotion ;
- une source `do_not_use` ne cree aucune preuve active.

Contrat executable :

```bash
node scripts/verify-local-manual-source-capture.mjs
```

Ce contrat ne lit pas le filesystem reel. Il fixe le comportement attendu avant d'ajouter une commande dry-run operateur ou un vrai connecteur automatise.

## Tranche 6 - Conflit, indisponibilite et arbitrage

Objectif :

Prouver que SuperMemory ne ment pas quand les sources ne sont pas nettes.

Scenario :

- API t1 dit `trust_score` ;
- note support dit encore `risk_score` ;
- connecteur contrat indisponible ;
- source reliability arbitre seulement ce qui est explicite.

Oracle :

```text
Le systeme expose le conflit support/API,
prefere la doc API pour la guidance technique si la regle le permet,
et traite l'indisponibilite comme "non verifie", jamais comme "inchange".
```

Contrat executable :

```bash
node scripts/verify-conflict-unavailable-arbitration.mjs
```

Le contrat T6 reste local et deterministe : il exige `conflicts_with`, interdit le choix silencieux sans regle explicite, cite la regle et le conflit quand l'arbitrage est permis, et route les conflits non resolus vers `conflict_queue`.

## Tranche 7 - Types metier adaptatifs

Objectif :

Prouver que les notions metier naissent a la demande.

Scenario :

- a t0, `marketing_strategy` n'est pas actif ;
- a t1, une source introduit une strategie ;
- creation d'une proposition ;
- passage a `experimental` ;
- recall borne avec `schema_status:experimental`.

Oracle :

```text
marketing_strategy n'existe pas comme type actif a t0.
Il existe a t1 uniquement parce qu'une source reelle le justifie.
Il est experimental et ne peut pas etre traite comme stable.
```

Contrat executable :

```bash
node scripts/verify-adaptive-business-types.mjs
```

Le contrat T7 reste local et deterministe : il prouve l'absence active a t0, la proposition source-backed a t1, le blocage des types `candidate`, le recall borne des types `experimental`, et le rejet d'un passage `stable` sans preuve source/eval.

## Tranche 8 - Acces entreprise, secrets et legal hold

Objectif :

Prouver que la memoire entreprise ne fuit pas.

Comportements :

- `workspace_id`, `data_owner`, `access_policy` obligatoires ;
- redaction de secret avant promotion ;
- champs restreints exclus des drafts ;
- legal hold conserve la preuve meme si l'usage actif est limite.

Oracle :

```text
Un agent marketing ne lit pas le texte contractuel restreint.
Un secret present dans une source n'apparait ni dans Hindsight actif ni dans un draft.
Une source sous legal hold reste conservee comme preuve.
```

Contrat executable :

```bash
node scripts/verify-enterprise-access-secrets-retention.mjs
```

Ce contrat verifie que les payloads de promotion et les drafts respectent `workspace_id`, `access_policy`, `data_owner`, `allowed_consumers`, redaction de secrets, `withheld_fields`, et retention legal hold.

## Tranche 9 - Review queues et actions externes

Objectif :

Prouver que les decisions humaines et les actions sensibles restent explicites.

Queues a exercer :

- `staleness_queue.md`
- `conflict_queue.md`
- `type_queue.md`
- `permission_queue.md`
- `action_confirmation_queue.md`

Oracle :

```text
Un email client peut etre draft,
mais l'envoi cree une demande de confirmation.
Une memoire changed/conflicting ouvre une revue au lieu de produire une guidance confiante.
```

Contrat executable :

```bash
node scripts/verify-review-queues-actions.mjs
```

Le contrat T9 reste local et deterministe : il prouve que staleness, conflit, type candidat, permission floue et action externe creent une queue explicite avec owner/blocker au lieu d'une decision silencieuse.

## Tranche 10 - Agents specialises et use patterns

Objectif :

Valider la flexibilite sans tomber dans une architecture trop programmatique.

Patterns a exercer :

- `external_draft`
- `internal_draft`
- `decision_support`
- `strategic_analysis`
- `audit_and_proof`
- `external_system_update`

Oracle :

```text
Chaque demande entreprise du Golden Case se rattache a un use pattern existant.
Aucun workflow bespoke n'est cree pour un seul cas.
```

Contrat executable :

```bash
node scripts/verify-agent-use-patterns.mjs
```

Le contrat T10 reste local et deterministe : il prouve que les agents choisissent un pattern connu avec evidence, filtres, snapshots et gates de revue/confirmation, au lieu de creer un workflow bespoke par demande.

## Tranche 11 - Evals de ports moteurs

Objectif :

Prouver que Graphiti et Memoria restent des ports, pas des dependances implicites.

Comportements :

- enregistrer `engine_port_evals.jsonl` ;
- marquer Graphiti `not_activated` si Hindsight passe les evals temporelles actuelles ;
- marquer Memoria `not_activated` si snapshots/logs suffisent pour rollback et audit.

Oracle :

```text
Le Golden Case explique pourquoi Graphiti et Memoria ne sont pas actives.
Un port ne peut etre active que par eval rouge ou douleur operationnelle prouvee.
```

Contrat executable :

```bash
node scripts/verify-engine-port-evals.mjs
```

Le contrat T11 reste local et deterministe : il enregistre des preuves JSONL-shaped, garde Graphiti et Memoria en `not_activated` quand les evals natives passent, cree seulement un `candidate_port` sur eval rouge, et rejette tout moteur qui veut posseder la gouvernance interne.

## Tranche 12 - Golden Case partiel executable

Objectif :

Construire une premiere version executable du cas entreprise, sans couvrir encore tous les details.

Scope minimum :

- API t0/t1 ;
- contrat t0/t1 ;
- PRD stale puis revue ;
- Hindsight re-promotion ;
- question `risk_score` vs `trust_score` ;
- exclusion `do_not_use`.

Oracle :

```text
Le cas enterprise-living-memory-complete passe pour le noyau source/snapshot/change/recall/answer.
Les parties non implementees restent marquees pending, pas ignorees.
```

Contrat executable :

```bash
node scripts/verify-enterprise-living-memory-partial.mjs
```

Le contrat T12 reste separe du target complet : il prouve le noyau Orion API/contrat/PRD/Hindsight/pricing/reponses sourcees, et conserve `marketing_strategy`, `legal_hold`, `secrets`, `engine_port_evals` et les agents specialises complets en `pending`.

## Tranche 13 - Golden Case complet

Objectif :

Faire passer tout le Golden Case.

Questions obligatoires :

- quel champ API utiliser maintenant ?
- quelle snapshot supporte la retention Orion ?
- le PRD Orion est-il courant ?
- l'email peut-il utiliser l'ancienne pricing sheet ?
- pourquoi `marketing_strategy` existe a t1 mais pas t0 ?
- l'agent marketing peut-il lire le contrat restreint ?
- un agent peut-il exposer une cle API ?
- que repondre si le connecteur contrat est indisponible ?
- quelle source gagne entre support et API docs ?
- quel workspace et quelle access policy gouvernent la memoire ?
- le contrat est-il sous legal hold ?
- Graphiti ou Memoria doivent-ils etre actives ?
- qu'est-ce qui a change entre t0 et t1 ?
- quel `document_id` Hindsight a ete re-promu ?
- que faut-il confirmer avant l'envoi email ?
- quel use pattern gouverne la demande ?
- quelle chaine relationnelle prouve que la reponse est assez actuelle ?

Oracle final :

```bash
node scripts/verify-enterprise-living-memory-complete.mjs
node scripts/verify-enterprise-living-memory-target.mjs
node scripts/verify-supermemory-specs.mjs
```

Le contrat T13 execute le scenario Orion complet dans `enterprise-living-memory-complete/actual/fixture.json` : toutes les questions finales sont sourcees, chaque reponse expose une chaine `supports_answer`, les agents respectent leur scope, les queues de revue existent, les secrets sont redacts, Graphiti/Memoria restent `not_activated`, et les demandes passent par les use patterns connus.

## Tranche 14 - Regression, CI et promptfoo optionnel

Objectif :

Stabiliser l'ensemble quand le Golden Case devient lourd.

Actions possibles :

- ajouter les verifications en CI ;
- ajouter promptfoo si les golden questions deviennent plus faciles a maintenir en evals textuelles ;
- ajouter un rapport d'eval lisible ;
- garder les scripts Node comme oracle de structure.

Oracle :

```text
Une regression sur provenance, permissions, freshness, do_not_use ou relation chain casse la CI.
```

Contrat executable :

```bash
node scripts/verify-ci-regression-suite.mjs
```

Le contrat T14 ajoute `.github/workflows/supermemory-specs.yml` et verifie localement que la CI lance les scripts critiques, que des mutations provenance/permissions/`do_not_use` cassent les checks, et que promptfoo reste optionnel plutot qu'une dependance ou gate obligatoire.

## Tranche 15 - Hindsight self-hosted local-first

Objectif :

Passer du contrat local/mock a un runtime Hindsight reel sans adopter Hindsight Cloud comme dependance implicite.

Decision :

- le premier runtime Hindsight cible doit etre self-hosted/local ;
- Docker Compose est le packaging recommande pour ce premier smoke local, via `compose.hindsight.yml` ;
- `HINDSIGHT_BASE_URL` doit pointer explicitement vers ce runtime local, par exemple `http://127.0.0.1:8888` ;
- Hindsight Cloud reste un endpoint optionnel et explicite, pas le chemin par defaut de SuperMemory ;
- aucun test CI ne doit dependre d'un service Hindsight live, local ou cloud ;
- les preuves live restent redacted et non commitees.

Comportements a prouver :

- Hindsight self-hosted demarre localement avec une bank sacrifiable ;
- le container Docker `ghcr.io/vectorize-io/hindsight:latest` peut demarrer avec `HINDSIGHT_API_LLM_PROVIDER=llamacpp` pour eviter une dependance initiale a une cle LLM externe ;
- le runner live execute retain -> recall strict, upsert -> recall strict, puis delete ;
- les metadata internes riches restent disponibles dans le plan SuperMemory, mais le transport Hindsight convertit chaque valeur metadata en string et supprime les valeurs nulles avant appel API ;
- le recall live utilise `tags_match: "all_strict"` ;
- la preuve locale confirme `live_writes_performed: true` et `secrets_redacted: true` sans exposer de secret ;
- si le runtime local n'est pas disponible, le systeme bloque ou reste en mock, sans basculer silencieusement vers le cloud.

Contrats executables deja disponibles :

```bash
node scripts/verify-hindsight-live-smoke-runner.mjs
node scripts/verify-hindsight-live-smoke-runbook.mjs
node scripts/verify-supermemory-specs.mjs
```

Prochain oracle live manuel :

```bash
export HINDSIGHT_BASE_URL="http://127.0.0.1:8888"
export HINDSIGHT_API_KEY="..."
export HINDSIGHT_BANK_ID="..."
export SUPERMEMORY_ALLOW_LIVE_HINDSIGHT=1
node scripts/hindsight-live-smoke-runner.mjs --execute-live --json
```

Point de vigilance :

- ne pas presenter `https://api.hindsight.vectorize.io` comme le chemin naturel ;
- ne pas commiter de credentials, de responses live completes, ni de preuve contenant des donnees sensibles ;
- ne pas lancer le smoke live sur une bank durable ou production.

## Ordre recommande

```text
T1 contrats techniques
  -> T2 fixture M1
  -> T3 Hindsight adapter
  -> T4 reponse avec evidence
  -> T5 source mutable t0/t1
  -> T6 conflit + indisponibilite
  -> T7 types adaptatifs
  -> T8 acces + secrets + legal hold
  -> T9 review queues + confirmations
  -> T10 use patterns agents
  -> T11 ports moteurs
  -> T12 Golden Case partiel
  -> T13 Golden Case complet
  -> T14 regression/CI
  -> T15 Hindsight self-hosted local-first runtime smoke
```

## Regle de passage

Ne pas passer a la tranche suivante si la tranche courante ne produit qu'une doc.

Chaque tranche doit ajouter au moins une preuve executable :

- fixture attendue ;
- script de verification ;
- test de recall ;
- reponse attendue ;
- assertion de non-regression ;
- ou rapport d'eval.

Le Golden Case doit rester la cible. Les tranches ne doivent pas devenir une nouvelle architecture parallele.
