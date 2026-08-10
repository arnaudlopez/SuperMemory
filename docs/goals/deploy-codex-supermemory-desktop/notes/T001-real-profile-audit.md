# T001 — Audit du profil Codex Desktop réel

Date : 2026-07-25
Mode : lecture seule, repli PM après timeout du Scout dédié

## Résultat

Le code SuperMemory fournit déjà le plugin, les hooks, le MCP, le daemon, le
registre projet, la gouvernance et un canari isolé. En revanche, le vrai profil
Codex Desktop n'est pas déployé :

- l'application active est `/Applications/ChatGPT.app` version
  `26.721.41059` ;
- son runtime embarqué est `codex-cli 0.146.0-alpha.3.1`, tandis que la CLI du
  `PATH` est `0.125.0` ;
- le projet est approuvé par Codex, mais `identity-vault` le considère encore
  `unbound` ;
- le marketplace local expose `supermemory`, mais `plugin/list` le retourne
  `installed: false`, `enabled: false` ;
- le daemon SuperMemory n'écoute pas sur `127.0.0.1:8765` et aucun LaunchAgent
  SuperMemory n'est chargé ;
- Hindsight et Ollama sont déjà locaux et sains ;
- les fichiers runtime du hook, du MCP et de l'App Server n'existent pas dans
  le projet réel.

## Hooks concurrents

`hooks/list`, exécuté avec le binaire embarqué du Desktop, retourne exactement
deux hooks utilisateur actifs et approuvés : `SessionStart` et `Stop`. Leur
source est `~/.codex/config.toml` et leurs commandes pointent vers l'ancien
`claude-memory-compiler`.

Le même fichier active les hooks via l'alias déprécié `codex_hooks`. Les blocs
legacy et leurs deux entrées de confiance occupent une tranche structurée
distincte du TOML. Ils doivent être retirés par transformation ciblée et
réversible, après vérification du hash complet du fichier. Une recherche brute
du mot `supermemory` n'est pas valide : le chemin du projet lui-même contient
ce mot et produit déjà un faux positif.

`~/.claude/settings.json` contient aussi des hooks de l'ancien compiler. Ils
appartiennent à Claude et ne sont pas exécutés par Codex Desktop. Ils doivent
être signalés, mais ne doivent pas être édités silencieusement dans ce package
Desktop. Le canari Codex doit néanmoins prouver qu'aucun ancien hook Codex
concurrent n'est chargé.

## Compatibilité officielle vérifiée

Le manuel Codex courant confirme :

- Desktop, CLI et IDE partagent la configuration MCP du même hôte ;
- les plugins sont pris en charge par Desktop et la CLI, mais pas par
  l'extension IDE ;
- un plugin installé peut fournir ses MCP et ses hooks ;
- installer ou activer un plugin ne fait pas automatiquement confiance à ses
  hooks : l'utilisateur doit examiner et approuver la définition courante ;
- les hooks locaux ne couvrent pas les outils hébergés et le format des
  transcripts n'est pas une interface stable ;
- un projet SSH/Remote utilise le runtime, les services MCP et les outils de
  l'hôte distant, donc le déploiement local ne s'y propage pas.

Le schéma JSON généré par le binaire Desktop confirme la présence de
`plugin/list`, `plugin/install`, `plugin/uninstall` et `hooks/list`, y compris
les états de confiance `untrusted`, `trusted` et `modified`.

## Écarts d'implémentation

1. `codex-installer` ne sauvegarde ni ne modifie `config.toml`, ne coupe pas
   l'ancien hook, ne crée pas les secrets, ne lie pas le projet, ne gère pas
   LaunchAgent et ne vérifie pas l'installation effective par le runtime.
2. Sa détection de doublons compte toutes les occurrences du mot
   `supermemory`; elle bloque donc à tort le vrai profil.
3. Le doctor considère l'App Server disponible uniquement en `0.125` et ne
   distingue pas la CLI du runtime Desktop embarqué.
4. Aucun autostart macOS, aucun diagnostic de LaunchAgent et aucun rollback
   global du déploiement Desktop n'existent.
5. Le canari actuel prouve un profil sacrificiel CLI, pas l'UI Desktop ni un
   redémarrage du vrai client.

## Cibles exactes à protéger

- `~/.codex/config.toml` : copie complète, mode et SHA-256 avant toute
  transformation ;
- `~/.codex/plugins/supermemory` et
  `~/.codex/plugin-data/supermemory` ;
- les répertoires projet `.codex/supermemory`,
  `plugins/supermemory` et `.agents/plugins/marketplace.json` ;
- le registre de projet sous `identity-vault`, avec sauvegarde hors du vault ;
- `~/Library/LaunchAgents/com.supermemory.codex-daemon.plist` ;
- le runtime privé `~/.supermemory/runtime/codex` et les journaux associés ;
- l'état `plugin/list` avant et après installation.

Le vault canonique ne doit jamais être supprimé par le rollback.

## Package Worker proposé

Implémenter un orchestrateur macOS réversible qui :

1. produit un plan sans écriture avec les fingerprints, versions, état plugin,
   hooks legacy structurés, binding, services et cibles ;
2. génère des secrets 0600 dans un runtime privé sans jamais les journaliser ;
3. lie explicitement le projet, avec option nommée pour adopter le workspace
   legacy ;
4. applique l'installer existant après correction de la détection de conflit ;
5. retire uniquement les blocs Codex de l'ancien compiler sous garde du hash et
   archive la copie complète ;
6. écrit et valide un LaunchAgent loopback-only pour `supermemoryd`, puis
   permet au PM de le charger ;
7. installe le plugin via l'App Server du Desktop, vérifie `plugin/list` et
   expose `hooks/list` sans contourner le trust ;
8. étend le doctor avec les versions PATH/embarquée, binding, daemon,
   installation/activation, confiance des hooks, MCP et ancien hook ;
9. restaure exactement le profil, le plugin, le LaunchAgent et les répertoires
   runtime lors du rollback, tout en conservant le vault.

Tests requis : transformation TOML conservatrice, refus sur hash divergent,
secret/modes, plist/loopback, plan sans écriture, apply/rollback isolé,
protocoles App Server simulés, doctor et vérification de non-régression Codex.

## Conditions d'arrêt

- besoin d'éditer un fichier non prévu par le Judge ;
- impossibilité de distinguer structurellement l'ancien hook ;
- secret dans le repo ou les sorties ;
- trust de hook automatisé ou contourné ;
- rollback qui touche le contenu canonique du vault ;
- incompatibilité du runtime Desktop non représentée explicitement.
