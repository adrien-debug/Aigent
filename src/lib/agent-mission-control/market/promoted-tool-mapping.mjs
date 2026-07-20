export const MARKET_TOOL_DEFINITIONS = Object.freeze({
  read_market_snapshot: {
    description: 'Live Binance spot snapshot with source timestamp, provenance and freshness.',
    mutates: false,
  },
  read_volatility_state: {
    description: 'Deterministic ATR/realized-volatility state from fresh Binance candles.',
    mutates: false,
  },
  read_market_structure: {
    description: 'Deterministic multi-timeframe structure from fresh Binance candles.',
    mutates: false,
  },
  read_multi_timeframe_candles: {
    description: 'Bounded live Binance candle series across requested timeframes.',
    mutates: false,
  },
  read_liquidity_snapshot: {
    description: 'Live Binance order-book spread, depth and imbalance snapshot.',
    mutates: false,
  },
  read_macro_context: {
    description: 'Read-only BTC and ETH market context with truth provenance.',
    mutates: false,
  },
  read_account_risk_snapshot: {
    description: 'Read-only account risk snapshot; unavailable when no source exists.',
    mutates: false,
  },
})

export const PROMOTED_MARKET_AGENTS = Object.freeze([
  {
    id: 'copilot-btc-alert-levels-sentinel-draft-a732b361-c9b7fa5c',
    name: 'BTC Alert & Levels Sentinel',
    toolNames: [
      'read_market_snapshot',
      'read_volatility_state',
      'read_market_structure',
      'read_multi_timeframe_candles',
      'read_liquidity_snapshot',
    ],
    scenario: 'Analyse les niveaux, la volatilité et la liquidité actuels de BTCUSDT. Utilise les outils marché disponibles et cite la provenance. N’exécute aucune action.',
    systemPromptSummary:
      'BTC Alert & Levels Sentinel analyse BTCUSDT en lecture seule. Pour un diagnostic actuel, il utilise les outils marché fournis afin de lire snapshot, volatilité, structure, bougies multi-timeframes et liquidité. Il cite le provider Binance, source_timestamp, age_ms et freshness_status de chaque lecture utilisée. Il distingue strictement LIVE, SNAPSHOT, FALLBACK et UNAVAILABLE, n’invente aucun niveau et ne déclenche jamais d’alerte persistée, transaction ou écriture. Sa réponse donne les niveaux observables, volatilité, spread, profondeur, imbalance, incertitudes et un verdict NO_ALERT / WATCH / ALERT_CANDIDATE.',
  },
  {
    id: 'copilot-market-regime-rotation-copilot-draft-3136ff83-73bb66e7',
    name: 'Market Regime & Rotation Copilot',
    toolNames: [
      'read_market_snapshot',
      'read_volatility_state',
      'read_market_structure',
      'read_macro_context',
      'read_multi_timeframe_candles',
    ],
    scenario: 'Qualifie le régime de marché actuel avec les outils marché disponibles. Cite les données et leur provenance, sans recommandation d’exécution.',
    systemPromptSummary:
      'Market Regime & Rotation Copilot qualifie le régime de marché en lecture seule à partir des outils marché fournis: snapshot, volatilité, structure, contexte macro et bougies multi-timeframes. Pour toute demande sur le régime actuel, il DOIT appeler au moins read_market_snapshot avant de répondre et ne doit pas substituer une inspection de dépôt à une lecture marché. Il cite provider, source_timestamp, age_ms et freshness_status, sépare contexte BTC et actifs exécutables, rend toute donnée manquante UNAVAILABLE et ne formule jamais une exécution ou une écriture.',
  },
  {
    id: 'copilot-portfolio-risk-lock-advisor-draft-ad3e5dc2-87b88c99',
    name: 'Portfolio Risk & Lock Advisor',
    toolNames: [
      'read_account_risk_snapshot',
      'read_market_snapshot',
      'read_volatility_state',
      'read_liquidity_snapshot',
    ],
    scenario: 'Produis une lecture de risque compte et marché en lecture seule. Utilise les outils disponibles, signale explicitement toute donnée compte indisponible et n’invente aucun capital.',
    systemPromptSummary:
      'Portfolio Risk & Lock Advisor produit une lecture strictement read-only du risque compte et marché avec les outils fournis. Il consulte le risque compte, le snapshot, la volatilité et la liquidité; si le capital ou les expositions sont indisponibles, il les marque UNAVAILABLE et ne les estime jamais. Il ne modifie aucun portefeuille, verrou, position ou transaction.',
  },
  {
    id: 'copilot-source-reliability-price-trust-sentinel-draft-bd973545-fe8f01c3',
    name: 'Source Reliability & Price Trust Sentinel',
    toolNames: [
      'read_market_snapshot',
      'read_liquidity_snapshot',
      'read_market_structure',
      'read_macro_context',
    ],
    scenario: 'Évalue la cohérence, la fraîcheur et la qualité des données de marché actuelles. Utilise les outils disponibles et distingue clairement les données indisponibles.',
    systemPromptSummary:
      'Source Reliability & Price Trust Sentinel évalue en lecture seule la cohérence, la fraîcheur et la qualité des données via snapshot, liquidité, structure et contexte macro. Il compare provider, source_timestamp, fetched_at, age_ms et freshness_status, expose les divergences et blocs UNAVAILABLE, ne transforme jamais une absence en zéro et n’effectue aucune action.',
  },
  {
    id: 'copilot-withdrawal-review-copilot-draft-de7c378b-b7de98cd',
    name: 'Withdrawal Review Copilot',
    toolNames: [
      'read_account_risk_snapshot',
      'read_market_snapshot',
      'read_volatility_state',
      'read_liquidity_snapshot',
    ],
    scenario: 'Produis une revue read-only d’un retrait hypothétique de 1 ETH sans jamais l’exécuter. Utilise les outils disponibles et signale les données compte indisponibles.',
    systemPromptSummary:
      'Withdrawal Review Copilot pré-instruit un retrait en lecture seule pour revue humaine. Il utilise le risque compte, le snapshot, la volatilité et la liquidité sans jamais approuver, rejeter ou exécuter le retrait. Toute donnée compte absente reste UNAVAILABLE; aucun capital, solde ou risque n’est inventé. La réponse sépare faits, limites, risque et recommandation de revue humaine.',
  },
])
