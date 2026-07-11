-- Agent Mission Control — colonnes image sur `projects` (base dédiée `aigent` sur gpu1).
-- Miroir de Project.imageUrl / Project.logoUrl dans src/lib/agent-mission-control/types.ts.
-- Colonnes snake_case ; la data layer camelise image_url→imageUrl automatiquement (data.ts intact).

alter table projects add column if not exists image_url text;
alter table projects add column if not exists logo_url text;
