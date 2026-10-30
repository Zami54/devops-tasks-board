#!/usr/bin/env bash
# =============================================================
#  K8S-start.sh — déploie la pile sur Kubernetes (Minikube, en local)
#  Sous Windows : depuis Git Bash.
#
#  Ce que fait le script, dans l'ordre :
#    1. démarre un cluster Minikube dédié (profil « tasks-board ») avec le
#       plugin réseau Calico, indispensable pour appliquer les NetworkPolicies
#    2. construit les images DANS le Docker interne de Minikube
#    3. crée le Secret depuis .env (aucun mot de passe dans Git)
#    4. crée le ConfigMap d'initialisation de la base depuis infra/db
#    5. applique les manifests et attend que tout soit prêt
#    6. ouvre l'application
#
#  Usage :
#    ./K8S-start.sh              déploie (reconstruit les images)
#    ./K8S-start.sh --no-build   redéploie sans reconstruire
#    ./K8S-start.sh --down       supprime les ressources (garde la base)
#    ./K8S-start.sh --reset      supprime tout, base comprise
# =============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="$ROOT/infra/k8s"
DB_DIR="$ROOT/infra/db"
ENV_FILE="$ROOT/.env"
PROFILE="tasks-board"
NS="tasks-board"
VERSION="1.0.0"

info() { printf '\033[0;36m==>\033[0m %s\n' "$1"; }
ok()   { printf '\033[0;32m OK\033[0m %s\n' "$1"; }
fail() { printf '\033[0;31mERR\033[0m %s\n' "$1" >&2; exit 1; }
kc()   { kubectl --context "$PROFILE" "$@"; }

for tool in docker kubectl minikube; do
  command -v "$tool" >/dev/null 2>&1 || fail "$tool n'est pas installé ou pas dans le PATH."
done
docker info >/dev/null 2>&1 || fail "Docker ne répond pas. Docker Desktop est-il démarré ?"

BUILD=true
case "${1:-}" in
  --down)
    info "Suppression des ressources (le volume de la base est conservé)..."
    # On ne supprime PAS le namespace : il contient le volume de la base.
    kc -n "$NS" delete deployment,service,networkpolicy,configmap,secret --all --ignore-not-found || true
    ok "Ressources supprimées."; exit 0 ;;
  --reset)
    info "Suppression du namespace complet, base comprise..."
    kc delete namespace "$NS" --ignore-not-found
    ok "Tout est supprimé."; exit 0 ;;
  --no-build) BUILD=false ;;
  "") ;;
  *) fail "Option inconnue : $1 (voir l'en-tête du script)" ;;
esac

[ -f "$ENV_FILE" ] || fail "Fichier .env absent : lancez d'abord ./local-start.sh (il le crée), ou copiez .env.example."
set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a

# --- 1. Cluster ------------------------------------------------
if ! minikube -p "$PROFILE" status --format '{{.Host}}' 2>/dev/null | grep -q Running; then
  info "Démarrage du cluster Minikube « $PROFILE » avec Calico (2 à 4 minutes la première fois)..."
  minikube start -p "$PROFILE" --cni=calico --memory=4096 --cpus=2
else
  ok "Cluster « $PROFILE » déjà démarré."
fi

# --- 2. Images ---------------------------------------------------
if [ "$BUILD" = true ]; then
  info "Bascule du client Docker vers le Docker interne de Minikube..."
  # Sans cette bascule, les images seraient construites sur la machine hôte
  # et resteraient invisibles pour le cluster (imagePullPolicy: Never).
  eval "$(minikube -p "$PROFILE" docker-env --shell bash)"
  info "Construction de tasks/backend:$VERSION..."
  docker build -q -t "tasks/backend:$VERSION" "$ROOT/backend" >/dev/null
  info "Construction de tasks/frontend:$VERSION..."
  docker build -q -t "tasks/frontend:$VERSION" "$ROOT/frontend" >/dev/null
  ok "Images construites."
fi

# --- 3 & 4. Namespace, Secret, ConfigMap d'initialisation -------
kc apply -f "$K8S_DIR/namespace.yaml" >/dev/null

info "Création du Secret depuis .env..."
kc -n "$NS" create secret generic app-secrets \
  --from-literal=POSTGRES_USER="$POSTGRES_USER" \
  --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  --from-literal=APP_DB_PASSWORD="$APP_DB_PASSWORD" \
  --from-literal=DATABASE_URL="postgres://app_user:${APP_DB_PASSWORD}@postgres-service:5432/${POSTGRES_DB}" \
  --dry-run=client -o yaml | kc apply -f - >/dev/null

info "Création du ConfigMap d'initialisation de la base depuis infra/db..."
kc -n "$NS" create configmap db-init \
  --from-file=01-init_db.sql="$DB_DIR/init_db.sql" \
  --from-file=02-app_user.sh="$DB_DIR/app_user.sh" \
  --dry-run=client -o yaml | kc apply -f - >/dev/null
ok "Secret et ConfigMap à jour."

# --- 5. Déploiement --------------------------------------------
info "Application des manifests..."
kc apply -f "$K8S_DIR"
# Images reconstruites avec le même tag : on force le remplacement des pods.
if [ "$BUILD" = true ]; then kc -n "$NS" rollout restart deployment/backend deployment/frontend >/dev/null; fi

info "Attente du démarrage des pods..."
for d in postgres backend frontend; do
  kc -n "$NS" rollout status "deployment/$d" --timeout=300s \
    || { kc -n "$NS" get pods; kc -n "$NS" describe "deployment/$d" | tail -25; fail "Le déploiement $d n'a pas abouti."; }
done

printf '\n'; kc -n "$NS" get pods -o wide; printf '\n'; kc -n "$NS" get svc,networkpolicy; printf '\n'
ok "Pile déployée sur Kubernetes."

# --- 6. Accès ----------------------------------------------------
cat <<EOF

  Le tunnel ci-dessous doit rester ouvert pendant la démonstration
  (Ctrl+C le ferme ; les pods, eux, continuent de tourner).
  Équivalent : kubectl --context $PROFILE -n $NS port-forward service/frontend-service 8081:80

EOF
minikube -p "$PROFILE" service frontend-service -n "$NS"
