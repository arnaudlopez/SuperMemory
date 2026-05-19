# Documentation - Memoire agentique

Ce dossier contient la premiere base de travail pour le systeme de memoire personnelle et professionnelle.

## Lecture recommandee

1. `audit-memoire-agentique.md`
   - Pourquoi cette architecture existe.
   - Decisions critiques.
   - Risques, angles morts, gouvernance et recherche academique.

2. `prd-memoire-agentique.md`
   - Ce que le produit doit faire.
   - Structure cible du vault.
   - Protocoles d'ingestion, navigation, revue, publication, monitoring et multi-agent.

3. `evaluation-comparative-retrieval-rappel.md`
   - Comparaison avec les benchmarks et architectures retrieval/RAG.
   - Estimation de rappel et vitesse.
   - Trajectoire BM25, embeddings, hybrid retrieval, reranking, graph.

## Decision actuelle

Le systeme doit commencer comme une memoire Markdown/Obsidian gouvernee, pas comme un RAG from scratch.

Architecture de principe :

```text
sources brutes
  -> agent memoire
  -> notes compilees
  -> signaux publies
  -> agents specialises
  -> revue humaine
  -> monitoring
  -> gouvernance
```

La source de verite reste le vault Markdown.
Les systemes de retrieval avances sont des couches futures, declenchees par evaluation.

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
- Monitoring avec questions de reference.

Elle ne doit pas inclure par defaut :

- RAG complet.
- Graphe de connaissance automatise.
- Service memoire avec API.
- Automatisation externe sans confirmation.

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
- Ne pas ajouter RAG, graphe ou service memoire sans echec mesure.
- Garder chaque fait important source, date, contextualise et revisable.

## Questions ouvertes prioritaires

- Quel format exact pour les signaux : Markdown, JSONL ou les deux ?
- Quel format pour les IDs d'entites et de signaux ?
- Quels agents specialises creer en premier ?
- Quel niveau d'automatisation accepter pour calendrier/email ?
- Quelles zones doivent rester locales seulement ?
- Quels seuils de recall/precision declenchent le passage a BM25, RAG ou graph ?
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
- `75_governance/`
- `90_evals/`

Puis tester le systeme sur 5 a 10 notes reelles avant d'automatiser davantage.
