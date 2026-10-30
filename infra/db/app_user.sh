#!/bin/sh
# =============================================================
#  Crée le compte de base de données utilisé par l'API.
#
#  Principe du moindre privilège : l'API ne se connecte PAS avec le
#  compte propriétaire de la base. Son compte « app_user » peut lire et
#  écrire des tâches, mais ne peut ni créer, ni modifier, ni supprimer
#  une table. Même en cas de faille dans l'API, un attaquant ne pourrait
#  pas faire « DROP TABLE tasks ».
#
#  Exécuté automatiquement par l'image officielle PostgreSQL au premier
#  démarrage, APRÈS init_db.sql (Docker Compose et Kubernetes).
# =============================================================
set -eu

: "${APP_DB_PASSWORD:?APP_DB_PASSWORD doit être défini}"

# Le mot de passe passe par une variable psql (:'pwd'), jamais collé dans
# la requête : pas d'injection possible, même avec un caractère spécial.
psql -v ON_ERROR_STOP=1 -v pwd="$APP_DB_PASSWORD" \
     --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'EOSQL'
CREATE ROLE app_user LOGIN PASSWORD :'pwd';
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT ON projects TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON tasks TO app_user;
GRANT USAGE, SELECT ON SEQUENCE tasks_id_seq TO app_user;
EOSQL

echo "Compte app_user créé (lecture des projets, lecture/écriture des tâches)."
