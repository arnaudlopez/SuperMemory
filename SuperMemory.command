#!/bin/zsh
cd "$(dirname "$0")"
npm run launch
launch_status=$?
if [ "$launch_status" -ne 0 ]; then
  echo
  echo "SuperMemory n’a pas démarré. Corrigez le prérequis indiqué ci-dessus, puis relancez ce fichier."
  echo "Appuyez sur une touche pour fermer."
  read -k 1
fi
exit "$launch_status"
