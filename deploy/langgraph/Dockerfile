# LangGraph.js Agent Server — production container for Aigent (graph: agent_builder)
#
# We run the FREE `langgraphjs dev` server in a container (not the licensed
# langchain/langgraphjs-api image, which requires a paid LangSmith license +
# Redis + Postgres). The dev server is in-memory, but with a persistent Docker
# volume mounted over its checkpoint dir (.langgraph_api), interrupted runs
# awaiting human approval SURVIVE a container restart — which is the production
# requirement here.
#
# Auth: the server reads langgraph.json's "auth" key → src/langgraph/auth.mjs,
# a fail-closed shared-secret gate (header x-agent-key, env LANGGRAPH_SERVER_SECRET).
# Without the secret the server 503s every request, so a public deployment is
# never unauthenticated.
#
# Build context MUST be the repo root (langgraph.json + src/langgraph live there).
# The server listens on 2024 inside the container; published as 8098 on the host.

FROM node:22-slim

# git is sometimes needed by transitive installs; keep the image lean otherwise.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (better layer caching). The langgraph CLI + graph
# deps come from package.json / package-lock.json.
COPY package.json package-lock.json ./
RUN npm ci

# Copy the app (langgraph.json, the graph, everything the graph imports).
COPY . .

# The checkpoint/thread state lives here — mount a volume over it (compose) so
# it persists across restarts.
VOLUME ["/app/.langgraph_api"]

# The dev server binds inside the container. 0.0.0.0 so the published port works;
# it is NOT publicly exposed directly — only via the tunnel, and gated by auth.
EXPOSE 2024

# Run the free dev server with the repo's langgraph.json (which wires the graph
# + the auth gate). --host 0.0.0.0 to be reachable on the published port.
CMD ["npx", "langgraphjs", "dev", "--no-browser", "--host", "0.0.0.0", "--port", "2024"]
