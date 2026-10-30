const { createApp } = require('./app');
const { pool, waitForDb, initSchemaIfRequested } = require('./db');
const log = require('./logger');

const PORT = Number(process.env.PORT) || 3000;

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL manquante (voir .env.example)');
  }

  // On attend PostgreSQL AVANT d'ouvrir le port : tant que l'API n'écoute
  // pas, Kubernetes ne lui envoie aucun trafic.
  await waitForDb();
  await initSchemaIfRequested();

  const server = createApp().listen(PORT, '0.0.0.0', () => {
    log.info('server_started', { port: PORT, env: process.env.NODE_ENV || 'development' });
  });

  // Arrêt propre : Kubernetes et Render envoient SIGTERM avant d'arrêter
  // le conteneur. On finit les requêtes en cours puis on ferme la base.
  const shutdown = (signal) => {
    log.info('server_stopping', { signal });
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  log.error('server_start_failed', { message: err.message });
  process.exit(1);
});
