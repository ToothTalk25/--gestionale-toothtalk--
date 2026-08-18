#!/bin/bash
# Deploy dell'edge function esporta-drive su Supabase.
# Uso:   bash scripts/deploy-drive.sh
# Prerequisito: aver fatto login una volta (vedi istruzioni).

set -e
cd "$(dirname "$0")/.."

echo "=== 1/2 Link al progetto Supabase ==="
npx supabase link --project-ref tzveitawihargerrbkqd

echo "=== 2/2 Deploy esporta-drive ==="
npx supabase functions deploy esporta-drive

echo ""
echo "✅ Fatto! L'edge function esporta-drive è aggiornata."
