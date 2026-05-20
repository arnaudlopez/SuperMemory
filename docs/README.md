# Documentation - Memoire agentique

Ce dossier contient la base de travail pour le systeme de memoire personnelle et professionnelle.

## Lecture recommandee

1. `audit-memoire-agentique-v2.md`
   - Decision d'adoption de Hindsight.
   - Repartition entre moteur memoire et gouvernance SuperMemory.
   - Features Hindsight a utiliser par phase.

2. `prd-memoire-agentique-v2.md`
   - Plan produit cible avec Hindsight.
   - Contrat de promotion vers Hindsight.
   - Evals et milestones V2.

3. `audit-memoire-agentique.md`
   - Pourquoi cette architecture existe.
   - Decisions critiques.
   - Risques, angles morts, gouvernance et recherche academique.
   - Contexte V1 conserve pour historique.

4. `prd-memoire-agentique.md`
   - Ce que le produit doit faire.
   - Structure cible du vault.
   - Protocoles d'ingestion, navigation, revue, publication, monitoring et multi-agent.
   - Contexte V1 conserve pour historique.

5. `evaluation-comparative-retrieval-rappel.md`
   - Comparaison avec les benchmarks et architectures retrieval/RAG.
   - Estimation de rappel et vitesse.
   - Trajectoire BM25, embeddings, hybrid retrieval, reranking, graph.

## Decision actuelle

Le systeme cible est maintenant :

- SuperMemory comme vault Markdown/Obsidian gouverne ;
- Hindsight comme moteur memoire adopte ;
- ports d'extension pour graphe temporel et versioning memoire si les evals l'exigent ;
- ontologie metier evolutive, creee a la demande ;
- snapshots immuables pour les sources externes ou mutables ;
- memoire vivante : fraicheur, revision, historisation, interdiction ;
- evals simples pour verifier que les deux couches respectent les permissions, la provenance et la qualite de recall.

Architecture de principe :

```text
sources brutes
  -> agent memoire
  -> snapshot immuable si source mutable
  -> notes compilees
  -> gouvernance des types metier
  -> promotion gouvernee vers Hindsight
  -> recall Hindsight filtre
  -> signaux publies
  -> agents specialises
  -> revue humaine
  -> monitoring
  -> gouvernance
```

La source de verite reste le vault Markdown. Hindsight accelere et enrichit le rappel, mais ne decide pas quelles sources sont autorisees.

Les systemes de retrieval maison ne sont plus la trajectoire par defaut. Les moteurs additionnels comme Graphiti ou Memoria sont des ports d'extension, actives seulement si les evaluations montrent un manque apres integration Hindsight.

## V1 minimale

La V1 doit rester simple mais complete sur les garde-fous.

Elle doit inclure :

- Structure du vault.
- `AGENTS.md` ou `CLAUDE.md`.
- `memory_map.md`.
- Inbox brute.
- Notes compilees professionnelles/personnelles.
- Couche `10_shared/`.
- Signaux simples.
- Files de revue.
- Contrats d'agents initiaux.
- Gouvernance documentaire.
- Contrat de promotion Hindsight.
- Log de promotions Hindsight.
- Registre des types metier et file de propositions.
- Registre de snapshots et politique de fraicheur.
- Politique de memoire vivante.
- Politique d'acces et politique de reponse sous incertitude.
- Ports moteurs optionnels.
- Monitoring avec questions de reference.

Elle ne doit pas inclure par defaut :

- RAG maison complet.
- Graphe de connaissance automatise maison.
- Service memoire custom avec API.
- Automatisation externe sans confirmation.
- Auto-retain Hindsight global sans passerelle de promotion.

## Dossiers conceptuels cibles

```text
identity-vault/
  AGENTS.md
  memory_map.md
  00_inbox/
  10_shared/
  20_professional/
  30_personal/
  40_private/
  50_review/
  60_signals/
  70_agent_contracts/
  75_governance/
  80_logs/
  90_evals/
```

## Principes non negociables

- Ne jamais remplacer les sources brutes par des syntheses.
- Ne pas transformer une hypothese en fait stable.
- Ne pas donner aux agents specialises acces a toute la memoire.
- Ne pas publier de detail prive quand un signal minimal suffit.
- Ne pas envoyer une source `do_not_use`, non capturee ou hors scope vers Hindsight.
- Ne pas traiter un pointeur externe mutable comme une preuve stable.
- Ne pas repondre comme si une memoire stale etait actuelle.
- Ne pas interroger Hindsight sans filtres de domaine, sensibilite, statut et consumer.
- Ne pas ajouter RAG, graphe ou service memoire custom sans echec mesure apres Hindsight.
- Ne pas creer de type metier sans source ou workflow reel.
- Ne pas ajouter Graphiti, Memoria ou un autre moteur sans eval rouge ou douleur operationnelle prouvee.
- Garder chaque fait important source, date, contextualise et revisable.

## Questions ouvertes prioritaires

- Quel format exact pour les signaux : Markdown, JSONL ou les deux ?
- Quel format pour les IDs d'entites et de signaux ?
- Quels agents specialises creer en premier ?
- Quel niveau d'automatisation accepter pour calendrier/email ?
- Quelles zones doivent rester locales seulement ?
- Quels seuils de recall/precision declenchent un ajout au-dessus de Hindsight ?
- Quelles evals declenchent le port Graphiti ou le port Memoria ?
- Quels types metier doivent rester experimentaux avant stabilisation ?
- Quelle cadence de refresh appliquer aux sources mutables critiques ?
- Quelle cadence de revue sera realiste au quotidien ?

## Prochaine etape recommandee

Creer un squelette de vault minimal avec :

- `AGENTS.md`
- `memory_map.md`
- `00_inbox/`
- `10_shared/`
- `20_professional/`
- `30_personal/`
- `50_review/`
- `60_signals/`
- `70_agent_contracts/`
- `75_governance/`
- `80_logs/`
- `90_evals/`

Puis prototyper Hindsight sur le scenario Acme existant avant d'automatiser davantage.

## Verification

```bash
node scripts/verify-supermemory-specs.mjs
```
