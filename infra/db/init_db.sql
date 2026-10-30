-- =============================================================
--  DevOps Tasks Board — schéma et données de démonstration
--
--  Source UNIQUE du schéma, jouée :
--   - par PostgreSQL au premier démarrage (Docker Compose, Kubernetes)
--   - par l'API au démarrage sur Render (INIT_DB_ON_START=true)
--   - à la main par ./bootstrap_db.sh (restauration)
--
--  Idempotent (IF NOT EXISTS, ON CONFLICT DO NOTHING) : le rejouer
--  ne détruit rien et ne provoque aucune erreur.
-- =============================================================

CREATE TABLE IF NOT EXISTS projects (
  id          SERIAL PRIMARY KEY,
  name        TEXT        NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 1 AND 60),
  color       TEXT        NOT NULL DEFAULT '#3B6E8F' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Les contraintes CHECK doublent la validation de l'API : même si une
-- valeur interdite passait le code, la base la refuserait (défense en
-- profondeur).
CREATE TABLE IF NOT EXISTS tasks (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER     NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title       TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  description TEXT        NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  status      TEXT        NOT NULL DEFAULT 'todo'   CHECK (status IN ('todo', 'doing', 'done')),
  priority    TEXT        NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks (project_id);

-- -------------------------------------------------------------
--  Données de démonstration
-- -------------------------------------------------------------
INSERT INTO projects (id, name, color) VALUES
  (1, 'Infrastructure', '#3B6E8F'),
  (2, 'Application',    '#2F7D5B'),
  (3, 'Sécurité',       '#A4472F')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tasks (id, project_id, title, description, status, priority) VALUES
  (1, 1, 'Dockeriser le backend',         'Image multi-étapes, utilisateur non-root',          'done',  'high'),
  (2, 1, 'Écrire les manifests Kubernetes','Deployments, Services, ConfigMap, Secret, probes',  'done',  'high'),
  (3, 1, 'Déployer sur Render',           'Backend, frontend et base managée',                 'doing', 'high'),
  (4, 2, 'Afficher le tableau Kanban',     'Trois colonnes : à faire, en cours, terminé',       'done',  'medium'),
  (5, 2, 'Filtrer et trier les tâches',    'Par projet, priorité et texte',                     'doing', 'low'),
  (6, 3, 'Réduire la surface d''attaque',  'Routes, ports et dépendances strictement utiles',   'doing', 'high'),
  (7, 3, 'Ajouter un scan de dépendances', 'npm audit dans le pipeline',                        'todo',  'medium'),
  (8, 3, 'Lancer un scan OWASP ZAP',       'Scan dynamique de l''application en ligne',         'todo',  'medium')
ON CONFLICT (id) DO NOTHING;

-- Les INSERT ci-dessus fixent les id : on recale les séquences pour que
-- la prochaine tâche créée par l'application ne tombe pas en doublon.
SELECT setval('projects_id_seq', COALESCE((SELECT MAX(id) FROM projects), 1), true);
SELECT setval('tasks_id_seq',    COALESCE((SELECT MAX(id) FROM tasks),    1), true);
