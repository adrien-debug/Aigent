const DEFAULT_LOCAL_LANGGRAPH_PORT = 2024

function normalizedUrl(value, label) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${label} must be a valid HTTP(S) URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${label} must use HTTP(S)`)
  }
  return url.toString().replace(/\/$/, '')
}

/** @param {Record<string, string | undefined>} env */
export function localAgentServerUrl(env = process.env) {
  const configuredPort = Number(env.AIGENT_LANGGRAPH_PORT)
  const port =
    Number.isInteger(configuredPort) && configuredPort > 0
      ? configuredPort
      : DEFAULT_LOCAL_LANGGRAPH_PORT
  return `http://127.0.0.1:${port}`
}

/** @param {Record<string, string | undefined>} env */
export function resolveAgentServerUrl(env = process.env) {
  const mode = env.NODE_ENV || 'development'
  const configured = env.LANGGRAPH_API_URL?.trim()

  if (mode === 'production') {
    if (!configured) {
      throw new Error('LANGGRAPH_API_URL is required in production')
    }
    const resolved = normalizedUrl(configured, 'LANGGRAPH_API_URL')
    const hostname = new URL(resolved).hostname
    if (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1') {
      throw new Error('Refusing local LangGraph endpoint in production')
    }
    return resolved
  }

  const local = localAgentServerUrl(env)
  if (configured && normalizedUrl(configured, 'LANGGRAPH_API_URL') !== local) {
    throw new Error('Refusing remote LangGraph endpoint in local development')
  }
  return local
}
