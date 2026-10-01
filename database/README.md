# Shared workspace database

`supabase-workspaces.sql` creates or updates the slug-addressed table and row-level security rules used by the browser client. Run the full script in the SQL Editor of your Supabase project, including when upgrading an existing project, so the `programs` JSONB column is added. It is safe to rerun. The table is intentionally open to unauthenticated reads and writes so collaborators can share a slug without account registration. Anyone who knows a slug can read and edit its programs; do not use it for private source.

The browser needs a Supabase project URL and publishable key. Keep secret/service-role keys out of this repository and all browser assets.
