# Matrice TDD vers le Golden Case

Cette matrice transforme la roadmap en tests rouges precis.

Elle sert a driver le developpement : avant chaque tranche, on cree d'abord la fixture et le script de verification qui echouent, puis on implemente le plus petit code ou document executable qui les fait passer.

## Regle TDD

Pour chaque test :

```text
red -> implementation minimale -> green -> refactor si utile
```

Un test est acceptable seulement s'il precise :

- l'entree ;
- le comportement attendu ;
- l'etat final attendu ;
- la commande de verification ;
- le risque qu'il couvre.

Les commandes ciblees ci-dessous sont intentionnelles. Si un script n'existe pas encore, la premiere sous-tache de la tranche est de le creer en rouge.

## Niveau de precision attendu

Cette matrice doit etre assez precise pour qu'un Worker puisse demarrer une tranche sans reinventer le test.

Chaque tranche doit donc converger vers trois artefacts :

```text
1. Une fixture d'entree invalide qui echoue pour une raison nommee.
2. Une fixture d'entree valide qui passe.
3. Un script de verification deterministe qui imprime PASS ou FAIL.
```

Format standard recommande pour les fixtures JSON :

```json
{
  "case_id": "memory-contracts",
  "valid": {
    "sources": [],
    "snapshots": [],
    "observations": [],
    "memory_candidates": [],
    "validated_memories": [],
    "relations": [],
    "promotion_payloads": [],
    "recall_policies": [],
    "answer_evidence": []
  },
  "invalid_cases": [
    {
      "id": "T1.1",
      "description": "ValidatedMemory without snapshot proof is rejected.",
      "input": {},
      "expected_error": "missing_snapshot_proof"
    }
  ]
}
```

Format standard recommande pour les scripts de verification :

```text
1. charger la fixture ;
2. executer tous les cas invalides ;
3. verifier que chaque cas invalide echoue avec l'erreur attendue ;
4. executer le cas valide ;
5. verifier que le cas valide passe ;
6. imprimer PASS <case_id> si tout est vert ;
7. imprimer FAIL <reason> et sortir non-zero sinon.
```

Definition minimale d'un test rouge :

```text
Le script existe, la fixture invalide existe, et la commande echoue parce que
le comportement attendu n'est pas encore implemente.
```

Definition minimale d'un test vert :

```text
La meme commande passe sans affaiblir la fixture invalide ni supprimer
l'assertion qui etait rouge.
```

## Tranche 0 - Baseline de conception verrouillee

Statut : fait.

Commande existante :

```bash
node scripts/verify-supermemory-specs.mjs
```

Tests de non-regression :

| ID | Test | Entree | Attendu | Commande |
|---|---|---|---|---|
| T0.1 | Specs globales valides | Docs V2 + fixtures existantes | Acme et enterprise target passent | `node scripts/verify-supermemory-specs.mjs` |
| T0.2 | Golden Case structurel valide | `enterprise-living-memory-complete/expected` | Concepts et relations requis presents | `node scripts/verify-enterprise-living-memory-target.mjs` |
| T0.3 | Pas de regression whitespace | Diff courant | Aucun trailing whitespace | `git diff --check` |

## Tranche 1 - Contrats techniques minimaux

Commande cible :

```bash
node scripts/verify-memory-contracts.mjs
```

Fixture cible :

```text
identity-vault/90_evals/cases/memory-contracts/
  input/contracts.fixture.json
  expected/assertions.json
```

Implementation cible probable :

```text
scripts/verify-memory-contracts.mjs
identity-vault/75_governance/sequential_relational_model.md
```

La premiere implementation peut rester un validateur de fixture dans `scripts/`.
Elle ne doit pas encore creer un moteur, une API ou une integration Hindsight.

Tests rouges :

| ID | Test | Entree | Attendu | Risque couvert |
|---|---|---|---|---|
| T1.1 | `ValidatedMemory` exige une preuve snapshot | ValidatedMemory sans `derived_from` ni `snapshot_id` | Rejet avec erreur `missing_snapshot_proof` | Memoire active sans preuve |
| T1.2 | `SourceSnapshot` est immuable | Deux snapshots avec meme `snapshot_id` mais hash different | Rejet `snapshot_id_collision` | Ecrasement silencieux |
| T1.3 | `MemoryCandidate` ne devient pas actif sans validation | Candidate avec `review_status: pending` | Rejet promotion active | Bypass de revue |
| T1.4 | Type `candidate` non promouvable | MemoryCandidate `schema_status: candidate` | Rejet `candidate_type_not_promotable` | Ontologie speculative |
| T1.5 | `do_not_use` non promouvable | ValidatedMemory `status: do_not_use` | Aucun `HindsightPromotionPayload` | Memoire interdite dans recall |
| T1.6 | `RecallPolicy` doit etre fail-closed | RecallPolicy sans `workspace_id` ou `access_policy` | Rejet `unsafe_recall_policy` | Recall large |
| T1.7 | `AnswerEvidence` cite ses preuves | AnswerEvidence sans `used_memory_ids` ou `cited_snapshot_ids` | Rejet `missing_answer_evidence` | Reponse non sourcee |
| T1.8 | `Relation supports_answer` est typee | Relation sans source `ValidatedMemory` ni target `Answer` | Rejet `invalid_relation_endpoints` | Graphe semantique flou |

Cas valide minimum attendu :

```json
{
  "source": {
    "source_id": "src-acme-api",
    "source_kind": "api_doc",
    "mutability": "mutable_external",
    "workspace_id": "ws-acme",
    "data_owner": "product",
    "access_policy": "professional-default",
    "sensitivity": "medium",
    "status": "active",
    "active_snapshot_id": "snap-acme-api-2026-05-20"
  },
  "snapshot": {
    "snapshot_id": "snap-acme-api-2026-05-20",
    "source_id": "src-acme-api",
    "content_hash": "sha256:example",
    "change_status": "initial_capture"
  },
  "validated_memory": {
    "memory_id": "mem-acme-api-field",
    "document_id": "doc-acme-api-field",
    "derived_from": ["snap-acme-api-2026-05-20"],
    "status": "active",
    "freshness": "fresh",
    "workspace_id": "ws-acme",
    "access_policy": "professional-default",
    "entity_type": "fact",
    "schema_status": "stable"
  },
  "relation": {
    "relation_type": "supports_answer",
    "from": "mem-acme-api-field",
    "to": "ans-acme-api-field"
  },
  "answer_evidence": {
    "answer_id": "ans-acme-api-field",
    "used_memory_ids": ["mem-acme-api-field"],
    "cited_snapshot_ids": ["snap-acme-api-2026-05-20"],
    "answer_state": "current"
  }
}
```

Ordre TDD recommande :

```text
1. Creer le script et une fixture invalide T1.1.
2. Voir `missing_snapshot_proof` echouer rouge.
3. Ajouter la validation minimale pour T1.1.
4. Ajouter T1.5, T1.6, T1.7.
5. Ajouter le cas valide minimum.
6. Ajouter T1.2, T1.3, T1.4, T1.8.
```

Critere de passage :

```text
Tous les objets minimaux existent.
La commande refuse les fixtures invalides et accepte la fixture valide.
```

## Tranche 2 - Fixture M1 Acme gouvernee

Commande cible :

```bash
node scripts/verify-m1-hindsight-promotion-recall-fixture.mjs
```

Fixture cible :

```text
identity-vault/90_evals/cases/m1-hindsight-promotion-recall/
  input/
  expected/
  actual/
```

Structure minimale recommandee :

```text
input/source.md
input/snapshot.md
expected/final-state.json
expected/answer-evidence.json
expected/promotion-payload.json
expected/assertions.json
actual/README.md
```

Tests rouges :

| ID | Test | Entree | Attendu | Risque couvert |
|---|---|---|---|---|
| T2.1 | Source Acme capturee | Source externe Acme sans snapshot | Rejet final state | Pointeur pris pour preuve |
| T2.2 | Snapshot supporte l'observation | Observation Acme sans `snapshot_id` | Rejet | Extraction non sourcee |
| T2.3 | Memoire derivee declare `derives_from` | Note compilee sans relation | Rejet | Perte de lineage |
| T2.4 | Payload de promotion attendu | ValidatedMemory active Acme | Payload contient `document_id`, tags, metadata | Handoff Hindsight incomplet |
| T2.5 | Reponse attendue cite snapshot | Question Acme | Reponse contient `snapshot_id` actif | Reponse non auditable |
| T2.6 | Source interdite exclue | Fixture contient un item `do_not_use` | Aucun payload actif | Contamination recall |

Critere de passage :

```text
Le cas M1 prouve Source -> Snapshot -> Observation -> ValidatedMemory -> Promotion -> AnswerEvidence.
```

## Tranche 3 - Adaptateur Hindsight local minimal

Commande cible :

```bash
node scripts/verify-hindsight-adapter-minimal.mjs
```

Precondition :

```text
Tranche 1 et Tranche 2 vertes.
L'adaptateur doit consommer les contrats valides, pas inventer son propre shape.
```

Decision ouverte a resoudre au demarrage :

```text
Tester contre Hindsight reel local ou contre un fake adapter contractuel.
Par defaut, commencer avec un fake adapter contractuel si Hindsight local n'est pas disponible,
puis ajouter un mode reel separe.
```

Tests rouges :

| ID | Test | Entree | Attendu | Risque couvert |
|---|---|---|---|---|
| T3.1 | Upsert conserve `document_id` | Deux promotions meme memoire | Un seul document actif avec meme `document_id` | Doublons Hindsight |
| T3.2 | Tags restrictifs obligatoires | Recall sans `status:active` ou `workspace` | Echec fail-closed | Recall trop large |
| T3.3 | Metadata de provenance obligatoire | Promotion sans `source_id` ou `snapshot_id` | Rejet | Recall non auditable |
| T3.4 | `do_not_use` supprime ou exclu | Promotion puis revocation `do_not_use` | Recall actif ne retourne rien | Memoire interdite |
| T3.5 | Pas d'auto-retain global | Input vault entier | Seuls items explicitement promus sont envoyes | Aspiration globale |
| T3.6 | Trace utile sur echec recall | Query sans resultat | Trace ou diagnostic conserve | Debug impossible |

Critere de passage :

```text
L'adaptateur peut retenir, rappeler et exclure sans violer les gates SuperMemory.
```

## Tranche 4 - Reponse gouvernee avec evidence

Commande cible :

```bash
node scripts/verify-governed-answer-evidence.mjs
```

Tests rouges :

| ID | Test | Entree | Attendu | Risque couvert |
|---|---|---|---|---|
| T4.1 | Reponse current | Memoire active fresh | `answer_state: current` + snapshot cite | Reponse sourcee |
| T4.2 | Reponse stale | Memoire `freshness: stale` | Mention "last known snapshot" ou revue | Certitude abusive |
| T4.3 | Reponse changed | Memoire `changed`/`needs_review` | Refus guidance operationnelle | Usage avant revue |
| T4.4 | Reponse restricted | Memoire restricted | Resume autorise + withheld_fields | Fuite de donnees |
| T4.5 | Reponse forbidden | Memoire `do_not_use` | Aucun usage actif | Source interdite |
| T4.6 | Evidence chain complete | Answer sans `supports_answer` | Rejet | Reponse non reliee |

Critere de passage :

```text
Une reponse ne peut pas etre "current" sans chaine relationnelle et snapshot cite.
```

## Tranche 5 - Cycle source mutable t0/t1

Commande cible :

```bash
node scripts/verify-source-change-t0-t1.mjs
```

Tests rouges :

| ID | Test | Entree | Attendu | Risque couvert |
|---|---|---|---|---|
| T5.1 | Nouveau hash cree nouvelle snapshot | Meme URL, hash different | Snapshot t1 creee avec `previous_snapshot_id` | Ecrasement |
| T5.2 | Ancienne snapshot preservee | Snapshot t0 existe apres t1 | t0 toujours lisible | Perte audit |
| T5.3 | Memoire derivee devient `needs_review` | PRD derivee de t0 | PRD marquee `needs_review` | Memoire stale active |
| T5.4 | Revue recompile contre t1 | PRD revue | `derived_from` pointe t1 | Revue fictive |
| T5.5 | Re-promotion garde `document_id` | PRD t0 puis t1 | Meme `document_id` | Historique casse |
| T5.6 | Source unavailable ne confirme rien | Check connecteur echoue | Etat `unavailable`, pas `fresh` | Faux positif de fraicheur |

Critere de passage :

```text
Le changement d'une source mutable propage l'impact avant tout recall confiant.
```

## Tranche 6 - Conflit, indisponibilite et arbitrage

Commande cible :

```bash
node scripts/verify-conflict-unavailable-arbitration.mjs
```

Tests rouges :

| ID | Test | Entree | Attendu | Risque couvert |
|---|---|---|---|---|
| T6.1 | Conflit conserve les deux faits | API dit `trust_score`, support dit `risk_score` | Relation `conflicts_with` | Perte du fait minoritaire |
| T6.2 | Arbitrage explicite seulement | Pas de regle source reliability | Reponse expose conflit sans choisir | Choix silencieux |
| T6.3 | API gagne si regle existe | Regle API > support pour integration | Guidance `trust_score` + conflit cite | Arbitrage opaque |
| T6.4 | Indisponible = non verifie | Connecteur contrat down | Reponse "last known snapshot" | Indisponibilite ignoree |
| T6.5 | Queue de conflit creee | Conflit non resolu | `conflict_queue` attendue | Pas de suivi |

Critere de passage :

```text
Les conflits et indisponibilites changent l'etat de reponse au lieu d'etre caches.
```

## Tranche 7 - Types metier adaptatifs

Commande cible :

```bash
node scripts/verify-adaptive-business-types.mjs
```

Tests rouges :

| ID | Test | Entree | Attendu | Risque couvert |
|---|---|---|---|---|
| T7.1 | Type absent a t0 | Query registry t0 | `marketing_strategy` non actif | Ontologie prechargee |
| T7.2 | Source t1 propose type | Strategie marketing t1 | Entree `type_queue` | Type sans source |
| T7.3 | Candidate non promouvable | Type `candidate` | Rejet promotion active | Promotion prematuree |
| T7.4 | Experimental bornable | Type `experimental` | Recall possible avec `schema_status:experimental` | Type inutilisable |
| T7.5 | Stable exige eval/source | Passage stable sans eval | Rejet | Stabilisation arbitraire |

Critere de passage :

```text
Les types naissent a la demande et restent gouvernes par leur statut.
```

## Tranche 8 - Acces entreprise, secrets et legal hold

Commande cible :

```bash
node scripts/verify-enterprise-access-secrets-retention.mjs
```

Tests rouges :

| ID | Test | Entree | Attendu | Risque couvert |
|---|---|---|---|---|
| T8.1 | Workspace obligatoire | Memoire enterprise sans `workspace_id` | Rejet | Fuite cross-client |
| T8.2 | Access policy obligatoire | Memoire sans `access_policy` | Rejet | Recall non borne |
| T8.3 | Secret redacte avant promotion | Source contient token/API key | Payload ne contient pas secret | Fuite secret |
| T8.4 | Champs restreints exclus draft | Email agent demande contrat | Resume autorise seulement | Fuite contractuelle |
| T8.5 | Legal hold conserve preuve | Source sous legal hold + revocation active | Vault conserve preuve, Hindsight actif exclu si requis | Destruction illegale |
| T8.6 | Data owner conserve | Promotion sans `data_owner` | Rejet | Gouvernance floue |

Critere de passage :

```text
L'isolation enterprise est prouvee avant les agents specialises.
```

## Tranche 9 - Review queues et actions externes

Commande cible :

```bash
node scripts/verify-review-queues-actions.mjs
```

Tests rouges :

| ID | Test | Entree | Attendu | Risque couvert |
|---|---|---|---|---|
| T9.1 | Staleness ouvre queue | Source change PRD | `staleness_queue` avec owner/blocker | Revue invisible |
| T9.2 | Conflit ouvre queue | API/support conflit | `conflict_queue` | Conflit oublie |
| T9.3 | Type proposal ouvre queue | Nouveau type | `type_queue` | Type sauvage |
| T9.4 | Permission floue ouvre queue | Agent veut champ restricted | `permission_queue` | Deny/allow implicite |
| T9.5 | Email send exige confirmation | Draft email client | `action_confirmation_queue` | Action externe non confirmee |

Critere de passage :

```text
Toute ambiguite critique devient un item de revue ou de confirmation.
```

## Tranche 10 - Agents specialises et use patterns

Commande cible :

```bash
node scripts/verify-agent-use-patterns.mjs
```

Tests rouges :

| ID | Test | Entree | Attendu | Risque couvert |
|---|---|---|---|---|
| T10.1 | Email = `external_draft` | Demande launch-readiness | Pattern assigne, filtres email | Workflow bespoke |
| T10.2 | PRD refresh = `internal_draft` | PRD stale | Pattern assigne, revue requise | Process flou |
| T10.3 | API field = `decision_support` | risk/trust question | Pattern assigne, snapshot cite | Decision non sourcee |
| T10.4 | Strategy = `strategic_analysis` | Demande marketing | Pattern assigne, type experimental cite | Surete exageree |
| T10.5 | Audit = `audit_and_proof` | "what changed?" | Relation chain + snapshots | Audit faible |
| T10.6 | Email send = `external_system_update` | Envoi email | Confirmation obligatoire | Action automatique |

Critere de passage :

```text
Les agents utilisent peu de patterns robustes au lieu de workflows preprogrammes.
```

## Tranche 11 - Evals de ports moteurs

Commande cible :

```bash
node scripts/verify-engine-port-evals.mjs
```

Tests rouges :

| ID | Test | Entree | Attendu | Risque couvert |
|---|---|---|---|---|
| T11.1 | Graphiti non active si Hindsight passe | Evals temporelles vertes | `Graphiti not_activated` | Dependances inutiles |
| T11.2 | Memoria non active si snapshots suffisent | Rollback/audit couverts vault | `Memoria not_activated` | Versioning premature |
| T11.3 | Eval rouge cree candidat port | Temporal eval rouge | Port candidate + justification | Pas de voie d'extension |
| T11.4 | Port ne devient pas source de verite | Port exige permissions internes | Rejet integration | Gouvernance cedee |

Critere de passage :

```text
Les ports sont gouvernes par evals, jamais par attrait technique.
```

## Tranche 12 - Golden Case partiel executable

Commande cible :

```bash
node scripts/verify-enterprise-living-memory-partial.mjs
```

Scope explicitement hors tranche :

```text
marketing_strategy, legal_hold, secrets, engine_port_evals et tous les agents specialises complets
peuvent rester pending dans cette tranche.
```

Tests rouges :

| ID | Test | Entree | Attendu | Risque couvert |
|---|---|---|---|---|
| T12.1 | API t0/t1 executable | API risk -> trust | t1 active, t0 historique | Golden Case trop theorique |
| T12.2 | Contrat t0/t1 executable | Retention 30 -> 90 | t1 active, legal metadata present | Contrat mutable faible |
| T12.3 | PRD stale puis revue | PRD derive t0 | needs_review puis active t1 | Derivation non suivie |
| T12.4 | Re-promotion Hindsight | PRD t1 revue | meme `document_id` | Doublons |
| T12.5 | Pricing `do_not_use` exclu | Pricing obsolete | aucun recall actif | Interdiction faible |
| T12.6 | Questions noyau repondues | Golden questions noyau | Reponses sourcees | End-to-end absent |

Critere de passage :

```text
Le noyau source/snapshot/change/recall/answer du Golden Case est executable.
```

## Tranche 13 - Golden Case complet

Commande cible :

```bash
node scripts/verify-enterprise-living-memory-complete.mjs
```

Tests rouges :

| ID | Test | Entree | Attendu | Risque couvert |
|---|---|---|---|---|
| T13.1 | Toutes les golden questions passent | Questions finales | Reponses attendues sourcees | Couverture incomplete |
| T13.2 | Relation chain complete | Chaque reponse | Chaine `supports_answer` + snapshots | Reponse magique |
| T13.3 | Tous les agents respectent scope | Email/marketing/product/memory | Filtres et refus corrects | Fuite agent |
| T13.4 | Toutes les queues attendues existent | Scenario complet | staleness/conflict/type/permission/action queues | Gouvernance incomplete |
| T13.5 | Secrets absents partout | Source avec secret | Aucun secret dans recall/draft | Fuite critique |
| T13.6 | Ports motives | Evals ports | Graphiti/Memoria not_activated | Overengineering |
| T13.7 | Flexibilite preservee | Demandes diverses | Use patterns, pas workflows bespoke | Trop programmatique |

Critere de passage :

```text
SuperMemory est enterprise-ready pour le scenario Orion.
```

## Tranche 14 - Regression, CI et promptfoo optionnel

Commande cible :

```bash
node scripts/verify-ci-regression-suite.mjs
```

Tests rouges :

| ID | Test | Entree | Attendu | Risque couvert |
|---|---|---|---|---|
| T14.1 | CI lance les scripts critiques | Push/PR | Specs + Golden Case + diff check | Regression non detectee |
| T14.2 | Regression provenance casse CI | Fixture sans snapshot | CI rouge | Preuve affaiblie |
| T14.3 | Regression permission casse CI | Recall sans filtre | CI rouge | Fuite |
| T14.4 | Regression `do_not_use` casse CI | Source interdite rappelable | CI rouge | Memoire interdite |
| T14.5 | promptfoo reste optionnel | Golden questions textuelles | Rapport utile si active, scripts Node restent source | Tool sprawl |

Critere de passage :

```text
Les invariants Golden Case deviennent des regressions automatiques.
```

## Definition of Done par tranche

Une tranche est done seulement si :

- au moins un test rouge a ete cree avant l'implementation ;
- la fixture invalide echoue pour la bonne raison ;
- la fixture valide passe ;
- la commande cible est documentee ;
- `node scripts/verify-supermemory-specs.mjs` reste vert ;
- `git diff --check` reste vert ;
- les non-objectifs de la tranche sont respectes.

## Precision restante a ajouter plus tard

La matrice est assez precise pour lancer les tranches 1 et 2.

Les tranches 3 a 14 sont assez precises pour preparer des GoalBuddy boards, mais devront etre durcies au moment de leur execution avec :

- fixtures exactes ;
- expected JSON/Markdown ;
- erreurs nommees ;
- mode reel versus fake quand un outil externe intervient ;
- liste des fichiers autorises ;
- commandes rouges puis vertes.

Ne pas durcir toutes les tranches maintenant evite de figer trop tot des details qui dependront des choix techniques des tranches 1 et 2.

## Ordre de creation des prochains tests

Pour la prochaine tranche, creer d'abord :

```text
scripts/verify-memory-contracts.mjs
identity-vault/90_evals/cases/memory-contracts/input/contracts.fixture.json
identity-vault/90_evals/cases/memory-contracts/expected/assertions.json
```

Puis faire echouer au minimum :

- T1.1 ;
- T1.5 ;
- T1.6 ;
- T1.7.

Ces quatre tests prouvent le noyau : preuve, interdiction, fail-closed recall, reponse sourcee.
