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
node scripts/verify-enterprise-living-memory-target.mjs
node scripts/verify-supermemory-specs.mjs
```

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
