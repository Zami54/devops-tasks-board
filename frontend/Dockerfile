# syntax=docker/dockerfile:1
# =============================================================
#  Image du frontend — construite en deux étapes
#
#  Étape 1 : Node compile l'application React en fichiers statiques.
#  Étape 2 : nginx « unprivileged » sert ces fichiers. L'image finale
#            ne contient ni Node, ni node_modules, ni le code source,
#            et nginx n'y tourne PAS en root.
# =============================================================

# ---------- Étape 1 : compilation ----------
FROM node:25-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
# Vide en local et sur Kubernetes (le navigateur appelle /api, relayé par
# nginx) ; renseignée sur Render, où l'API a sa propre adresse.
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ---------- Étape 2 : service ----------
# Variante officielle de nginx qui tourne avec l'utilisateur « nginx »
# (uid 101) et écoute sur 8080 : un port < 1024 exigerait root.
FROM nginxinc/nginx-unprivileged:1.27-alpine

# Au démarrage, l'image remplace ${BACKEND_URL} dans ce modèle : la MÊME
# image pointe vers « backend:3000 » (Compose) ou « backend-service:3000 » (K8s).
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

ENV BACKEND_URL=http://backend:3000

# Explicite (l'image de base le fait déjà) : nginx tourne avec l'uid 101.
USER 101

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
