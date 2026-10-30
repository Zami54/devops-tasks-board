# syntax=docker/dockerfile:1
# =============================================================
#  Image de l'API — construite en deux étapes
#
#  Étape 1 : installe UNIQUEMENT les dépendances de production.
#  Étape 2 : image finale minimale, sans npm, sans outils de build,
#            exécutée par un utilisateur sans droits.
# =============================================================

# ---------- Étape 1 : dépendances ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --omit=dev        : ni linter ni outils de test dans l'image
# --ignore-scripts  : aucune dépendance ne peut exécuter de script à
#                     l'installation (attaque de la chaîne d'approvisionnement)
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ---------- Étape 2 : image d'exécution ----------
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

# Réduction de la surface d'attaque : npm, npx, yarn et corepack ne servent
# à rien pour EXÉCUTER l'API. Les retirer supprime des centaines de fichiers
# (et les failles éventuelles qu'ils contiennent) de l'image finale.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
           /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn*

# Le code appartient à root et n'est que LISIBLE par l'utilisateur « node » :
# même compromise, l'API ne peut pas modifier son propre code.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# Utilisateur non privilégié fourni par l'image officielle.
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1

# node directement (pas « npm start ») : le processus reçoit bien le signal
# d'arrêt SIGTERM, et npm n'existe plus dans l'image de toute façon.
CMD ["node", "src/server.js"]
