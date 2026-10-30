#!/usr/bin/env bash
# =============================================================
#  bootstrap_db.sh — crée ou restaure le schéma et les données de
#  démonstration dans une base PostgreSQL existante.
#
#  Usage :
#    ./bootstrap_db.sh "postgres://user:motdepasse@hote:5432/base"
#    DATABASE_URL="postgres://..." ./bootstrap_db.sh
#
#  Procédure si la base Render gratuite expire (30 jours) :
#    1. créer une nouvelle base Render (ou resynchroniser le Blueprint)
#    2. redéployer l'API : elle rejoue init_db.sql toute seule au démarrage
#       (INIT_DB_ON_START=true) — ce script n'est alors même pas nécessaire
#    3. vérifier https://<api>.onrender.com/tasks
#
#  Utiliser ce script depuis son poste suppose d'autoriser TEMPORAIREMENT
#  son adresse IP dans Render (base > Networking > Access Control), puis de
#  la retirer : par défaut, la base n'accepte aucune connexion d'Internet.
#
#  Rejouable sans risque : init_db.sql est idempotent.
# =============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="$ROOT/infra/db/init_db.sql"

info() { printf '\033[0;36m==>\033[0m %s\n' "$1"; }
ok()   { printf '\033[0;32m OK\033[0m %s\n' "$1"; }
fail() { printf '\033[0;31mERR\033[0m %s\n' "$1" >&2; exit 1; }

DB_URL="${1:-${DATABASE_URL:-}}"
[ -n "$DB_URL" ] || fail "Aucune URL de connexion. Usage : ./bootstrap_db.sh \"postgres://user:motdepasse@hote:5432/base\""
[ -f "$SQL_FILE" ] || fail "Fichier introuvable : $SQL_FILE"

# Le mot de passe est masqué avant tout affichage (les journaux d'un
# pipeline peuvent être lus par d'autres personnes).
SAFE_URL="$(printf '%s' "$DB_URL" | sed -E 's#(//[^:]+):[^@]*@#\1:***@#')"
info "Cible : $SAFE_URL"

run_psql() {
  if command -v psql >/dev/null 2>&1; then
    psql "$DB_URL" -v ON_ERROR_STOP=1 --quiet "$@"
  elif command -v docker >/dev/null 2>&1; then
    # Pas de psql (fréquent sous Windows) : client de l'image officielle.
    docker run --rm -i postgres:16-alpine psql "$DB_URL" -v ON_ERROR_STOP=1 --quiet "$@"
  else
    fail "Ni psql ni docker ne sont disponibles."
  fi
}

info "Exécution de init_db.sql..."
run_psql < "$SQL_FILE"
ok "Schéma et données de démonstration en place."

info "Vérification..."
run_psql -c "SELECT (SELECT COUNT(*) FROM projects) AS projets, (SELECT COUNT(*) FROM tasks) AS taches;"
ok "Restauration terminée."
