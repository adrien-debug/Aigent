/**
 * AIG-TRADE-001 — precise tool descriptions for the model.
 *
 * The runner exposes tools to the model with an EMPTY JSON-Schema (permissive
 * object args), so the ONLY signal the model has for how to call a tool is its
 * description. These strings therefore carry the exact argument shape + enums,
 * so the model calls the Zod-validated handlers correctly instead of guessing
 * (and getting rejected). Kept beside the tools they describe.
 */

export const TRADING_TOOL_DESCRIPTIONS: Readonly<Record<string, string>> = {
  read_market_snapshot:
    'Read a full normalized market snapshot (ticker, candles, structure, volatility) for a pair. ' +
    'Args JSON: {"pair": <one of "ETHUSDT"|"ETHUSDC"|"BTCUSDT"|"BTCUSDC">, "intervals"?: array of ("1m"|"5m"|"15m"|"1h"|"4h"|"1d"), "candleLimit"?: 2..500}. ' +
    'Example: {"pair":"ETHUSDT","intervals":["1h","4h"]}. Read-only; returns truth=UNAVAILABLE (never fake data) if no source.',
  read_multi_timeframe_candles:
    'Read OHLCV candles across several timeframes for a pair. ' +
    'Args JSON: {"pair": "ETHUSDT"|"ETHUSDC"|"BTCUSDT"|"BTCUSDC", "intervals": array of ("1m"|"5m"|"15m"|"1h"|"4h"|"1d"), "limit"?: 2..500}. ' +
    'Example: {"pair":"ETHUSDT","intervals":["1h","4h"],"limit":100}.',
  read_volatility_state:
    'Read ATR/stdev/annualized volatility + regime for a pair. ' +
    'Args JSON: {"pair": "ETHUSDT"|"ETHUSDC"|"BTCUSDT"|"BTCUSDC", "interval"?: "1m"|"5m"|"15m"|"1h"|"4h"|"1d", "limit"?: 15..500}. ' +
    'Example: {"pair":"ETHUSDT","interval":"1h"}. UNAVAILABLE if the series is too short.',
  read_market_structure:
    'Read trend + support/resistance pivots for a pair. ' +
    'Args JSON: {"pair": "ETHUSDT"|"ETHUSDC"|"BTCUSDT"|"BTCUSDC", "interval"?: "1m"|"5m"|"15m"|"1h"|"4h"|"1d", "limit"?: 15..500}. ' +
    'Example: {"pair":"ETHUSDT","interval":"4h"}.',
  read_liquidity_snapshot:
    'Read order-book-derived liquidity (spread, depth, quality) for a pair. ' +
    'Args JSON: {"pair": "ETHUSDT"|"ETHUSDC"|"BTCUSDT"|"BTCUSDC", "depth"?: 1..100}. ' +
    'Example: {"pair":"ETHUSDT"}. Usually UNAVAILABLE (no order-book source) — then abstain, do not invent.',
  read_funding_open_interest:
    'Read perp funding rate + open interest for a pair. ' +
    'Args JSON: {"pair": "ETHUSDT"|"ETHUSDC"|"BTCUSDT"|"BTCUSDC"}. ' +
    'Example: {"pair":"ETHUSDT"}. Usually UNAVAILABLE (no perp source) — then abstain.',
  read_account_risk_snapshot:
    'Read the account exposure/capital snapshot. ' +
    'Args JSON: {"pair"?: "ETHUSDT"|"ETHUSDC"|"BTCUSDT"|"BTCUSDC"}. ' +
    'ALWAYS returns UNAVAILABLE — no account source is wired; capital is never fabricated. Size only when real capital is known.',
  read_macro_context:
    'Read coarse macro context (BTC context leg + ETH executable leg). ' +
    'Args JSON: {} (no required args). ' +
    'BTC legs are correlation context only — never an executable recommendation.',
}
