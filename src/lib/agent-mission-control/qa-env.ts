/**
 * Résolution de l'environnement QA — et le refus structurel de la production.
 *
 * POURQUOI CE MODULE EXISTE
 * -------------------------
 * `aigent_qa` est une base PHYSIQUEMENT distincte de la base produit `aigent`
 * (rôle propre, droits limités, `CONNECT` refusé sur la produit — vérifié le
 * 2026-07-31). Ce module est la seule porte d'entrée vers elle, et sa raison
 * d'être est d'interdire la faute qui rendrait tout ce cloisonnement inutile :
 * un test QA qui, faute de variable QA, retomberait silencieusement sur
 * `AMC_SUPABASE_URL` et écrirait dans la base qui porte les 14 copilots.
 *
 * DEUX GARANTIES, TENUES PAR CONSTRUCTION
 * ---------------------------------------
 * 1. **Aucun repli.** Les noms de variables produit ne sont pas lus par ce
 *    module — ils n'y apparaissent que dans ce commentaire et dans le message
 *    d'erreur. Il n'existe donc aucun chemin de code, même en dernier recours,
 *    qui puisse résoudre une valeur produit. Ce n'est pas une convention qu'on
 *    respecte : c'est une absence.
 * 2. **Échec immédiat et bruyant.** Une variable manquante lève à l'appel, avec
 *    le nom exact de ce qui manque. Pas de `?? ''`, pas de valeur par défaut,
 *    pas de « on verra bien » — un harnais QA qui démarre à moitié configuré
 *    est plus dangereux qu'un harnais qui ne démarre pas.
 *
 * GARDE-FOU SUPPLÉMENTAIRE : si une variable QA pointe malgré tout sur l'hôte
 * de la base produit, on lève aussi. Une faute de copier-coller dans un
 * `.env.local` ne doit pas suffire à faire écrire un test dans la production.
 */

/** Les quatre variables qui définissent l'environnement QA. Aucune autre. */
export const QA_ENV_KEYS = [
  'AIGENT_QA_DATABASE_URL',
  'AIGENT_QA_SUPABASE_URL',
  'AIGENT_QA_SUPABASE_SERVICE_ROLE_KEY',
  'AIGENT_QA_CONSUMER_TELEMETRY_TOKEN',
] as const

export type QaEnvKey = (typeof QA_ENV_KEYS)[number]

export interface QaEnv {
  databaseUrl: string
  supabaseUrl: string
  serviceRoleKey: string
  consumerTelemetryToken: string
}

/**
 * L'hôte de la base PRODUIT. Présent ici pour être REFUSÉ, jamais pour être
 * utilisé — c'est la seule mention d'une valeur produit dans ce module, et elle
 * sert exclusivement à faire échouer une configuration qui y pointerait.
 */
const PRODUCTION_HOSTS = ['aigent-db.hearst.app']

/** Le nom de base produit, refusé pour la même raison. */
const PRODUCTION_DATABASE = 'aigent'

function missing(keys: readonly string[]): never {
  throw new Error(
    `Environnement QA incomplet — variable(s) manquante(s) : ${keys.join(', ')}.\n` +
      `Ces tests écrivent en base : ils s'arrêtent plutôt que de deviner une cible.\n` +
      `Il n'existe AUCUN repli vers AMC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — ` +
      `retomber sur la production écrirait dans la base qui porte les copilots réels.`,
  )
}

function refuseProduction(key: QaEnvKey, value: string): void {
  for (const host of PRODUCTION_HOSTS) {
    if (value.includes(host)) {
      throw new Error(
        `${key} pointe sur l'hôte de PRODUCTION (${host}). Refusé.\n` +
          `La base QA est \`aigent_qa\`, distincte de \`aigent\`. Corrigez .env.local.`,
      )
    }
  }
  // Une URL Postgres dont le chemin est exactement `/aigent` vise la produit.
  if (key === 'AIGENT_QA_DATABASE_URL' && /\/aigent(\?|$)/.test(value)) {
    throw new Error(
      `AIGENT_QA_DATABASE_URL vise la base \`${PRODUCTION_DATABASE}\` (production). Refusé.\n` +
        `La base QA est \`aigent_qa\`.`,
    )
  }
}

/**
 * Résout l'environnement QA, ou lève.
 *
 * À appeler en tête de tout harnais qui touche la base QA. Il n'y a
 * délibérément pas de variante « tolérante » : un appelant qui voudrait
 * continuer sans base QA n'a rien à faire dans un test qui écrit.
 */
export function requireQaEnv(): QaEnv {
  const absent = QA_ENV_KEYS.filter((k) => {
    const v = process.env[k]
    return typeof v !== 'string' || v.trim() === ''
  })
  if (absent.length > 0) missing(absent)

  for (const k of QA_ENV_KEYS) refuseProduction(k, process.env[k] as string)

  return {
    databaseUrl: process.env.AIGENT_QA_DATABASE_URL as string,
    supabaseUrl: process.env.AIGENT_QA_SUPABASE_URL as string,
    serviceRoleKey: process.env.AIGENT_QA_SUPABASE_SERVICE_ROLE_KEY as string,
    consumerTelemetryToken: process.env.AIGENT_QA_CONSUMER_TELEMETRY_TOKEN as string,
  }
}

/**
 * `true` si l'environnement QA est complet — pour qu'une suite puisse se
 * SKIPPER proprement plutôt que d'échouer sur une machine non équipée.
 *
 * Ne l'utilisez jamais pour choisir une cible de repli : le seul choix légitime
 * est « je tourne contre QA » ou « je ne tourne pas ».
 */
export function qaEnvAvailable(): boolean {
  return QA_ENV_KEYS.every((k) => {
    const v = process.env[k]
    return typeof v === 'string' && v.trim() !== ''
  })
}
