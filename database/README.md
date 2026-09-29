# Shared workspace database

`supabase-workspaces.sql` creates the slug-addressed table and row-level security rules used by the browser client. Run it in the SQL Editor of your Supabase project. The table is intentionally open to unauthenticated reads and writes so collaborators can share a slug without account registration. Anyone who knows a slug can read and edit its code; do not use it for private source.

The browser needs a Supabase project URL and publishable key. Keep secret/service-role keys out of this repository and all browser assets.
