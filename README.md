# DevOps Tasks Board

Application web trois tiers de gestion de tâches DevOps (mini-Kanban), développée,
conteneurisée, orchestrée et déployée de bout en bout — du poste de développement
au cloud — avec la sécurité intégrée à chaque étape (DevSecOps).

| Couche | Technologie | Rôle |
|---|---|---|
| Présentation | React 19 + Vite, servi par nginx (non-root) | Tableau Kanban, ajout, déplacement, suppression, filtres, tri |
| Logique | Node.js 22 + Express 5 | API REST, validation stricte, rate limiting, journalisation |
| Données | PostgreSQL 16 | Projets et tâches, contraintes d'intégrité, compte à droits limités |

**Exécution** : Docker Compose (local) · Kubernetes / Minikube (test) · Render (production)
**Intégration continue** : GitHub Actions (qualité + sécurité), déploiement Render conditionné aux contrôles

| Environnement | Adresse |
|---|---|
| Application en ligne | `https://<tasks-frontend>.onrender.com` |
| API en ligne | `https://<tasks-backend>.onrender.com/health` |

---

## Sommaire

1. [Architecture](#architecture)
2. [Arborescence](#arborescence)
3. [Prérequis](#prérequis)
4. [Lancement local (Docker Compose)](#lancement-local-docker-compose)
5. [Lancement Kubernetes (Minikube)](#lancement-kubernetes-minikube)
6. [Déploiement Render](#déploiement-render)
7. [Restauration de la base](#restauration-de-la-base)
8. [API REST](#api-rest)
9. [Pipeline CI/CD](#pipeline-cicd)
10. [Sécurité et surface d'attaque](#sécurité-et-surface-dattaque)
11. [Dépannage](#dépannage)

---

## Architecture

![Architecture](docs/architecture.png)

Le même code tourne dans les trois environnements ; seules quatre variables changent
(`DATABASE_URL`, `DATABASE_SSL`, `BACKEND_URL`, `VITE_API_URL`).

- **En local et sur Kubernetes**, le navigateur ne connaît que le frontend : il appelle
  `/api` sur la même adresse, et nginx relaie vers le backend depuis l'intérieur du
  réseau Docker ou du cluster. L'API et la base ne sont jamais exposées.
- **Sur Render**, le frontend est un site statique ; le navigateur appelle l'API sur son
  propre domaine, d'où une règle CORS limitée à l'adresse du frontend.

## Arborescence

```
devops-tasks-board
├── backend                  API Express
│   ├── src
│   │   ├── app.js           routes (7), sécurité HTTP, gestion d'erreurs
│   │   ├── validation.js    validation par liste blanche
│   │   ├── db.js            pool PostgreSQL, attente de la base, init Render
│   │   ├── logger.js        journaux JSON, IP tronquée
│   │   └── server.js        démarrage et arrêt propre
│   ├── test                 tests unitaires et d'intégration
│   └── Dockerfile           image multi-étapes, non-root, sans npm
├── frontend                 interface React
│   ├── src                  App.jsx, api.js, tasks.js (+ tests), styles.css
│   ├── nginx.conf.template  proxy /api, en-têtes de sécurité
│   └── Dockerfile           build Node → nginx unprivileged
├── infra
│   ├── db                   init_db.sql (schéma + démo), app_user.sh (compte limité)
│   ├── docker               docker-compose.yml
│   └── k8s                  manifests Kubernetes + NetworkPolicies
├── docs                     schémas, audit de sécurité (securite.md)
├── .github                  pipeline CI, Dependabot
├── render.yaml              Blueprint Render
├── local-start.sh           lancement Docker Compose
├── K8S-start.sh             déploiement Minikube
└── bootstrap_db.sh          restauration de la base
```

## Prérequis

Git, Node.js 22, Docker Desktop, kubectl, Minikube. Sous Windows, lancer les scripts
depuis **Git Bash**.

```bash
git --version && node -v && docker --version && kubectl version --client && minikube version
```

## Lancement local (Docker Compose)

```bash
./local-start.sh            # démarre ; crée .env avec des mots de passe aléatoires au 1er lancement
./local-start.sh --logs     # démarre puis affiche les journaux
./local-start.sh --down     # arrête (données conservées)
./local-start.sh --reset    # arrête et efface la base
```

Application : <http://localhost:8080> — déjà remplie de données de démonstration.

Ce que fait Docker Compose :

- `init_db.sql` puis `app_user.sh` sont joués par PostgreSQL **au premier démarrage** :
  tables, données de démo, puis compte `app_user` à droits limités utilisé par l'API.
- Le volume `pgdata` conserve les données entre deux arrêts.
- **Seul le port 8080 est publié.** Pour interroger la base :

```bash
docker compose --env-file .env -f infra/docker/docker-compose.yml exec db \
  psql -U devops -d tasksdb -c "SELECT id, title, status FROM tasks ORDER BY id DESC LIMIT 5;"
```

Développement sans Docker (rechargement à chaud) : `cd backend && npm install && npm run dev`
(avec un `backend/.env`) et `cd frontend && npm install && npm run dev`.

## Lancement Kubernetes (Minikube)

```bash
./K8S-start.sh              # cluster + images + secret + déploiement + ouverture du navigateur
./K8S-start.sh --no-build   # redéploie sans reconstruire
./K8S-start.sh --down       # supprime les ressources, garde la base
./K8S-start.sh --reset      # supprime tout
```

Le script crée un cluster dédié (`minikube -p tasks-board`) avec **Calico**, le plugin
réseau qui applique les NetworkPolicies, et crée le Secret à partir de `.env` : aucun
mot de passe n'est versionné.

| Ressource | Rôle |
|---|---|
| `namespace.yaml` | Espace `tasks-board`, Pod Security « baseline » imposée |
| `configmap.yaml` | Configuration non sensible |
| Secret `app-secrets` | Créé par le script depuis `.env` (exemple : `secret.yaml.example`) |
| ConfigMap `db-init` | Créé par le script depuis `infra/db` |
| `postgres-*.yaml` | 1 réplique, stratégie Recreate, PVC 1 Gi, Service ClusterIP |
| `backend-*.yaml` | 2 répliques, 3 sondes, non-root, lecture seule, Service ClusterIP |
| `frontend-*.yaml` | 2 répliques nginx non-root, Service **NodePort 30080 (seul point d'entrée)** |
| `network-policies.yaml` | Tout refuser, puis frontend → backend → base uniquement |

Les trois sondes du backend :

| Sonde | Route | Teste la base | En cas d'échec |
|---|---|---|---|
| startup | `/health` | non | laisse jusqu'à 2 min au démarrage |
| liveness | `/health` | non | redémarre le conteneur |
| readiness | `/ready` | oui | retire le pod du trafic, sans le tuer |

Vérifications utiles :

```bash
kubectl --context tasks-board -n tasks-board get pods,svc,networkpolicy
kubectl --context tasks-board -n tasks-board logs -l app=backend --tail=20
kubectl --context tasks-board -n tasks-board exec deploy/frontend -- id      # uid=101, pas root
# Cloisonnement : un pod quelconque ne peut PAS joindre la base
kubectl --context tasks-board -n tasks-board run test --rm -it --restart=Never \
  --image=postgres:16-alpine -- pg_isready -h postgres-service -t 3        # → no response
```

## Déploiement Render

1. Pousser le dépôt sur GitHub, avec un pipeline vert.
2. Render → **New** → **Blueprint** → choisir le dépôt. Render crée la base `tasks-db`,
   l'API `tasks-backend` et le site `tasks-frontend` décrits dans `render.yaml`.
3. Quand Render les demande, laisser `CORS_ORIGIN` et `VITE_API_URL` vides au premier passage.
4. Une fois les services créés :
   - `tasks-backend` → Environment → `CORS_ORIGIN` = URL du frontend ;
   - `tasks-frontend` → Environment → `VITE_API_URL` = URL de l'API ;
   - relancer un déploiement des deux services.
5. Vérifier `https://<api>.onrender.com/health` puis ouvrir le frontend.

Ensuite, **chaque push sur `main` est déployé automatiquement, uniquement si tous les
contrôles GitHub Actions sont verts** (`autoDeployTrigger: checksPass`). Render surveille
`/health` et redémarre l'API si elle ne répond plus.

La base n'accepte **aucune connexion depuis Internet** (`ipAllowList: []`). Pour une
vérification en SQL depuis son poste : Render → base → Networking → ajouter
temporairement son adresse IP, se connecter avec l'*External Database URL*, puis retirer
l'adresse.

## Restauration de la base

La base gratuite de Render expire au bout de 30 jours. Procédure :

1. Créer une nouvelle base (ou resynchroniser le Blueprint).
2. Redéployer l'API : au démarrage, elle rejoue `init_db.sql` (`INIT_DB_ON_START=true`)
   et recrée le schéma et les données de démonstration.
3. Vérifier `https://<api>.onrender.com/tasks`.

Restauration manuelle sur n'importe quelle base :

```bash
./bootstrap_db.sh "postgres://user:motdepasse@hote:5432/base"
```

Le script utilise `psql`, ou à défaut le client de l'image `postgres:16-alpine`, masque
le mot de passe dans ses sorties et affiche le nombre de lignes restaurées.

## API REST

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/health` | Sonde de vie — `{"status":"ok"}`, ne touche pas la base |
| `GET` | `/ready` | Sonde de disponibilité — teste la base |
| `GET` | `/projects` | Projets, avec nombre de tâches et de tâches terminées |
| `GET` | `/tasks` | Toutes les tâches |
| `POST` | `/tasks` | Crée une tâche — `{ title, project_id, description?, status?, priority? }` |
| `PATCH` | `/tasks/:id` | Modifie `status`, `priority`, `title` ou `description` |
| `DELETE` | `/tasks/:id` | Supprime une tâche |

Toute autre route renvoie 404. Limites : titre ≤ 120 caractères, description ≤ 500,
corps ≤ 10 Ko, 120 requêtes/min et 30 écritures/min par adresse IP.

```bash
curl http://localhost:8080/api/tasks
curl -X POST http://localhost:8080/api/tasks -H "Content-Type: application/json" \
  -d '{"title":"Nouvelle tâche","project_id":1,"priority":"high"}'
```

## Pipeline CI/CD

`.github/workflows/ci.yml`, déclenché à chaque push et pull request sur `main`.

| Job | Contenu |
|---|---|
| `backend` | lint (oxlint), 15 tests unitaires, `npm audit` (dépendances de production) |
| `backend-integration` | PostgreSQL en conteneur, schéma + compte limité, 10 tests d'intégration |
| `frontend` | lint, 8 tests (vitest), build Vite, `npm audit`, artefact `dist` |
| `secrets` | recherche de secrets dans tout l'historique Git (gitleaks) |
| `docker` | build des deux images, scan Trivy des images et de la configuration |

Les quatre premiers jobs tournent en parallèle ; `docker` attend leur succès. Render ne
déploie qu'une fois **tous** les contrôles verts. Le jeton du pipeline est en lecture
seule et chaque action tierce est épinglée par son empreinte SHA. Dependabot propose
chaque semaine les mises à jour de dépendances, d'images et d'actions.

## Sécurité et surface d'attaque

Audit complet, constats, priorisation et preuves : **[docs/securite.md](docs/securite.md)**.

![Surface d'attaque](docs/surface-attaque.png)

En résumé :

- **Moins de points d'entrée** : 7 routes utiles, 1 seul port publié, base injoignable
  depuis l'extérieur dans les trois environnements.
- **Moins de privilèges** : conteneurs non-root en lecture seule, compte SQL limité,
  jeton CI en lecture seule, aucune clé Render dans GitHub.
- **Moins de composants** : image API sans npm, image frontend sans Node, aucune
  ressource tierce chargée par le navigateur, aucune dépendance inutilisée.
- **Contrôles à chaque étape** : validation, rate limiting, en-têtes de sécurité, tests,
  audit des dépendances, scan des images, recherche de secrets.

## Dépannage

| Symptôme | Cause | Solution |
|---|---|---|
| `Docker ne répond pas` | Docker Desktop arrêté | Démarrer Docker Desktop, attendre « Engine running » |
| `$'\r': command not found` | Scripts convertis en CRLF par Windows | `git config --global core.autocrlf input` puis recloner (`.gitattributes` l'évite) |
| `port is already allocated` | 8080 déjà utilisé | Changer le port hôte dans `docker-compose.yml` (`"8081:8080"`) |
| Base vide après `--reset` | Normal | `init_db.sql` est rejoué au démarrage suivant |
| Pods en `ErrImageNeverPull` | Images construites hors de Minikube | Relancer `./K8S-start.sh` (il fait la bascule) |
| `CrashLoopBackOff` sur le backend | Base pas prête ou secret absent | `kubectl … logs -l app=backend` ; relancer le script |
| Le NodePort ne répond pas (Windows) | IP de Minikube non routable avec le driver Docker | Utiliser le tunnel ouvert par le script, ou `port-forward` |
| Render : première requête lente | Service gratuit endormi après 15 min | Normal ; ouvrir les liens avant une démonstration |
| Render : erreurs CORS dans la console | `CORS_ORIGIN` absente ou différente de l'URL du frontend | Corriger la variable, redéployer l'API |
| Render : déploiement qui ne part pas | Un contrôle CI est rouge | Corriger le pipeline : c'est le comportement voulu |
