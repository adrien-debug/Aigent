/**
 * Agent Mission Control — shared LangGraph Agent Server client factory (server only).
 *
 * Single source for the @langchain/langgraph-sdk `Client` used across the app:
 * the run/resume path (langgraph-server.ts) and the per-project assistant
 * lifecycle (langgraph-assistants.ts) both build their client HERE so the
 * auth/URL logic exists exactly once — never copy-pasted.
 *
 * The Agent Server is fail-closed via langgraph.json's "auth" key, so when LANGGRAPH_SERVER_SECRET
 * is set the app sends it as the `x-agent-key` header on every request via the
 * SDK's `defaultHeaders`. Absent, the client is created bare and every request
 * 503s — the secret is required in BOTH environments, not just production.
 *
 * The secret is trimmed before use: an empty or whitespace-only value (e.g. a
 * stray " " from a misconfigured env var) is treated as absent rather than sent
 * as a bogus header that would just get a 401 from the server.
 *
 * Endpoint resolution is centralized in agent-server-endpoint.mjs: local
 * development is pinned to the supervised loopback server, while production
 * requires an explicit LANGGRAPH_API_URL.
 *
 * Never import this module from a client component: it reads the server secret.
 */
import 'server-only'

import { Client } from '@langchain/langgraph-sdk'

import { resolveAgentServerUrl } from '@/langgraph/agent-server-endpoint.mjs'

/** Base URL of the Agent Server, resolved fail-closed for the current environment. */
export function agentServerUrl(): string {
  return resolveAgentServerUrl(process.env)
}

/**
 * Build the Agent Server client (server only). See the module header for the
 * fail-closed auth contract. Returns a bare client when the secret is absent so
 * the caller gets an honest 503 from the server rather than a silent no-op.
 */
export function agentServerClient(): Client {
  const secret = process.env.LANGGRAPH_SERVER_SECRET?.trim()
  return secret
    ? new Client({ apiUrl: agentServerUrl(), defaultHeaders: { 'x-agent-key': secret } })
    : new Client({ apiUrl: agentServerUrl() })
}

/** Graph id declared in langgraph.json — the single shared graph all assistants run on. */
export const AGENT_BUILDER_GRAPH_ID = 'agent_builder'
