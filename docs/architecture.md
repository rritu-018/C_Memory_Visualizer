# Architecture and growth plan

## Current application

This repository is a static GitHub Pages app. `index.html` is the public landing page, and `visualizer.html` loads the interactive simulator. The simulator is currently implemented in one browser script at `assets/js/app.js`; it parses and runs the supported C subset locally. There is no API, account system, or database, so user programs are not shared or stored online.

The root HTML files are intentional: GitHub Pages serves `index.html` as the project site's entry page. Shared browser code and styles live under `assets/`.

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
Browser app → HTTPS API → PostgreSQL
                  ├──── authentication provider
                  └──── realtime channel (only for collaboration features)
```

Use a managed PostgreSQL service with managed authentication for the first production version, or a separately deployed TypeScript/Node API with PostgreSQL if the project needs custom execution controls. Keep C parsing and simulation in the browser for now. Never execute submitted C on the API server; if server-side execution is added later, isolate it in a locked-down worker/container with strict CPU, memory, and time limits.

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

The current `server/` and `database/` directories are placeholders for these future components. No backend or database is provisioned by this repository yet.
