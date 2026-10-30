// =============================================================
//  Journalisation structurée (une ligne JSON par événement)
//
//  - Lisible par une machine : Render, kubectl logs ou un SIEM
//    peuvent filtrer sur "event" ou "level".
//  - Aucune donnée sensible : jamais de corps de requête, de mot
//    de passe ni d'URL de connexion.
//  - L'adresse IP est tronquée (dernier octet masqué) : c'est une
//    donnée personnelle au sens du RGPD, on n'en garde que ce qui
//    sert à repérer un abus.
// =============================================================

function maskIp(ip) {
  if (!ip) return undefined;
  const v4 = ip.replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return v4.replace(/\.\d+$/, '.0');
  // IPv6 : on ne garde que les 3 premiers groupes
  return `${ip.split(':').slice(0, 3).join(':')}::`;
}

function write(level, event, details = {}) {
  if (process.env.NODE_ENV === 'test' && !process.env.LOG_IN_TESTS) return;
  const line = { time: new Date().toISOString(), level, event, ...details };
  const output = level === 'error' ? process.stderr : process.stdout;
  output.write(`${JSON.stringify(line)}\n`);
}

module.exports = {
  maskIp,
  info: (event, details) => write('info', event, details),
  warn: (event, details) => write('warn', event, details),
  error: (event, details) => write('error', event, details),
};
