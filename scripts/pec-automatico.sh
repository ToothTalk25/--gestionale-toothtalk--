#!/bin/bash
#
# pec-automatico.sh — svuota la coda PEC dal computer, da solo.
#
# Non prende decisioni: esegue lo stesso comando che si lancierebbe a mano
# (`node scripts/invia-pec.mjs --esegui`), e le sue regole restano quelle:
# le impronte degli allegati vengono verificate prima di spedire, le righe in
# errore NON ripartono da sole, e ogni spedizione lascia la sua riga nel
# registro.
#
# Lo chiama launchd ogni 15 minuti (it.toothtalk.pec.plist) e all'accesso.
# Se il Mac è spento o in stop, non succede niente: si riprende quando torna.
# Tutto quello che fa finisce in ~/Library/Logs/toothtalk-pec.log.
#
set -uo pipefail

PROGETTO="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$HOME/Library/Logs/toothtalk-pec.log"
NODE="$(command -v node || echo /usr/local/bin/node)"

mkdir -p "$(dirname "$LOG")"

# Il log non deve crescere senza fine: oltre 2000 righe si tiene la coda.
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 2000 ]; then
  tail -400 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
fi

cd "$PROGETTO" || exit 1
{
  echo "— $(date '+%Y-%m-%d %H:%M:%S') —"
  "$NODE" scripts/invia-pec.mjs --esegui
} >> "$LOG" 2>&1

# Sempre 0: un errore di spedizione è già scritto sulla riga di coda (e nei
# promemoria), non è un guasto dell'attività che deve riempire i log di launchd.
exit 0
