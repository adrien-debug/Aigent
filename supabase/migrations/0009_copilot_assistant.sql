-- Agent Mission Control — assistant LangGraph dédié par COPILOT (base dédiée `aigent` sur gpu1).
-- Évolution de 0008 (un assistant par PROJET) : chaque COPILOT possède désormais SON assistant
-- sur le graphe partagé `agent_builder`, dont la `config.configurable` porte son COMPORTEMENT
-- complet (systemPrompt composé + model + maxSteps + confirmationPolicy + outils réels scopés),
-- dérivé du manifest+tools du copilot et généré à l'origine par l'Architecte IA
-- (voir src/lib/agent-mission-control/copilot-behavior.ts + langgraph-assistants.ensureCopilotAssistant).
-- La colonne stocke l'assistant_id (uuid v5 déterministe du copilotId renvoyé par POST /assistants).
-- Nullable : un copilot legacy (créé avant ce câblage) reste sans assistant et retombe au run sur
-- l'assistant du projet (0008) puis sur le graph_id partagé (double fallback dans runner/test-runner/
-- resume). Colonne snake_case ; la data layer camelise assistant_id→assistantId automatiquement.

alter table copilots add column if not exists assistant_id text;
