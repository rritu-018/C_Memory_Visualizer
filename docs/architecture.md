# Architecture and growth plan

## Current application

The app is served as static pages from GitHub Pages. The root `index.html` collects a workspace slug, while `404.html` acts as the path fallback for `/<slug>` and loads the matching visualizer. Workspace source is stored in Supabase Postgres and synced through its browser REST API. The simulator still parses and runs the supported C subset in the browser; it is not yet a standards-compliant C compiler.

The public publishable API key is used in the browser with row-level security. The table is open to unauthenticated reads and writes so people can share a slug without account registration. Anyone with the slug can edit it, so workspaces are public and not private.

## Suggested production shape

Keep the visualizer as a client-side application and add separate services only when product features need them:

```text
index.html / visualizer.html    Public GitHub Pages entry points (current)
assets/                         Browser code, styles, images
docs/                           Architecture, product, and operations notes
server/                         Future HTTP API and background jobs
database/                       Future schema, migrations, and seed data
```

For saved programs, accounts, sharing, and live collaboration, a practical next architecture is:

```text
Browser app → Supabase REST API → PostgreSQL
                  └──── periodic polling for shared workspace updates
```

The initial shared-workspace feature uses Supabase directly. Keep C parsing and simulation in the browser for now. Never execute submitted C on the API server; if a real compiler is added later, isolate it in a locked-down worker/container with strict CPU, memory, and time limits.

## Suggested milestones

1. **Make the browser code easier to extend:** split tokenizer, parser, interpreter, renderer, and editor/highlighting into modules with clear inputs and outputs.
2. **Add quality gates:** format/lint checks, unit tests for parsing and memory snapshots, and an automated deployment preview for changes.
3. **Define user features and data:** decide what needs persistence (for example, accounts, saved programs, and share links) before settling the schema.
4. **Add persistence and identity:** add authentication, API validation, database migrations, ownership checks, and rate limits. Keep public share links read-only by default.
5. **Add collaboration only if needed:** choose WebSockets or a managed realtime service after defining edit conflict and presence behavior.
6. **Operate the service:** add error reporting, backups, health checks, secrets management, and restore procedures before inviting live users.

## Data and security principles

- Treat browser-submitted source code and all API fields as untrusted input.
- Keep database credentials and privileged service keys on the server, never in browser assets.
- Put an explicit size limit on programs and saved documents; apply per-user and per-IP request limits.
- Store ownership and permissions in the database and enforce them in every API operation.
- Version database changes with migrations and test restore procedures before production use.
- Do not store passwords directly; use a trusted authentication provider or a vetted authentication library.

## Decisions to make before backend implementation

- Which features need accounts: saving, private projects, sharing, or collaboration?
- Should programs be private, unlisted, or public by default?
- Is managed infrastructure preferred, or should the API and database be self-hosted?
- What user and traffic limits should the first production release support?

Supabase must be provisioned and configured before cross-device sync works. See the setup steps in the README and SQL in `database/`.
