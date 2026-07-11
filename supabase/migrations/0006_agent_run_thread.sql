-- LangGraph human-in-the-loop: persist the Agent Server thread id on each run
-- so an interrupted run (status 'needs-confirmation') can be RESUMED from a
-- later request with a human decision. Nullable — only langgraph runs set it.

alter table agent_runs add column if not exists thread_id text;
