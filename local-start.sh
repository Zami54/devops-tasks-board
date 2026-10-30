#!/usr/bin/env bash
# =============================================================
#  local-start.sh — lance la pile complète avec Docker Compose
#  (PostgreSQL + API + frontend). Sous Windows : depuis Git Bash.
#
#  Usage :
#    ./local-start.sh            démarre (construit les images si besoin)
#    ./local-start.sh --rebuild  force la reconstruction des images
#    ./local-start.sh --logs     démarre puis affiche les journaux
#    ./local-start.sh --down     arrête (les données sont conservées)
#    ./local-start.sh --reset    arrête ET efface la base
# =============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$ROOT/infra/docker/docker-compose.yml"
ENV_FILE="$ROOT/.env"
APP_URL="http://localhost:8080"

info() { printf '\033[0;36m==>\033[0m %s\n' "$1"; }
ok()   { printf '\033[0;32m OK\033[0m %s\n' "$1"; }
fail() { printf '\033[0;31mERR\033[0m %s\n' "$1" >&2; exit 1; }

compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

# Mot de passe aléatoire de 32 caractères hexadécimaux (sûr dans une URL).
random_secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 16
  else node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"; fi
}

command -v docker >/dev/null 2>&1 || fail "Docker n'est pas installé."
docker info >/dev/null 2>&1 || fail "Docker ne répond pas. Docker Desktop est-il démarré ?"

# Premier lancement : on crée .env avec des mots de passe aléatoires.
if [ ! -f "$ENV_FILE" ]; then
  info "Création de .env avec des mots de passe aléatoires (fichier non versionné)..."
  sed -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(random_secret)/" \
      -e "s/^APP_DB_PASSWORD=.*/APP_DB_PASSWORD=$(random_secret)/" \
      "$ROOT/.env.example" > "$ENV_FILE"
  ok ".env créé."
fi

BUILD_ARGS=(--build)
case "${1:-}" in
  --down)  info "Arrêt de la pile (données conservées)..."; compose down; ok "Arrêtée."; exit 0 ;;
  --reset) info "Arrêt et suppression de la base..."; compose down -v; ok "Base effacée : init_db.sql sera rejoué au prochain démarrage."; exit 0 ;;
  --rebuild) BUILD_ARGS=(--build --force-recreate) ;;
  --logs|"") ;;
  *) fail "Option inconnue : $1 (voir l'en-tête du script)" ;;
esac

info "Construction des images et démarrage des conteneurs..."
compose up -d "${BUILD_ARGS[@]}"

info "Attente de l'API (via le proxy nginx)..."
for i in $(seq 1 45); do
  if curl -fsS -m 2 "$APP_URL/api/ready" >/dev/null 2>&1; then ok "API prête (tentative $i)."; break; fi
  if [ "$i" -eq 45 ]; then
    compose ps; compose logs --tail 40 backend
    fail "L'API n'a pas répondu après 90 secondes."
  fi
  sleep 2
done

printf '\n'; compose ps; printf '\n'
ok "Pile locale démarrée."
cat <<EOF

  Application       $APP_URL
  API (via nginx)   $APP_URL/api/health
  Base de données   non exposée — pour l'interroger :
                    docker compose --env-file .env -f infra/docker/docker-compose.yml exec db psql -U devops -d tasksdb

  Journaux : ./local-start.sh --logs      Arrêt : ./local-start.sh --down

EOF

if [ "${1:-}" = "--logs" ]; then compose logs -f; fi
