# DocForge AI

Source-aware API documentation for JavaScript projects. The first vertical slice is optimized for analyzing the local TokenWise repository:

```text
local source → Express route extraction → React fetch tracing → analysis dashboard
```

## Run locally

Requires Node.js 18 or newer.

```bash
npm start
open http://127.0.0.1:5050
```

Or run the first analysis directly:

```bash
npm run analyze:tokenwise
```

## Run with Docker

Build and start DocForge with:

```bash
docker compose up --build
```

Open `http://127.0.0.1:5050`. The Compose setup defaults to deterministic local enrichment. To connect to Ollama running on the host, create a `.env` file with `DOCFORGE_AI_PROVIDER=ollama`; the configured `host.docker.internal` URL is used by the container.

The scanner is read-only and excludes `.env` files, `node_modules`, build output, and Git metadata. No API key is needed for this first deterministic slice.

## Current capabilities

- Detects Node, Express, React, Vite, and AWS SDK dependencies.
- Extracts Express `app.get`, `app.post`, `app.put`, `app.patch`, and `app.delete` routes.
- Infers request fields from `req.body`, `req.query`, and `req.params` destructuring.
- Infers JSON response status codes and top-level fields.
- Traces frontend `fetch()` calls back to API paths.
- Lists environment variable names without exposing values.
- Provides warnings for unmatched frontend calls and incomplete contracts.
- Generates deterministic OpenAPI 3.0 JSON and Markdown from the extracted analysis.
- Generates source-grounded local enrichment suggestions with confidence and warnings.
- Accepts local project paths or public GitHub repository URLs.
- Persists analysis sessions and enrichment review state in local JSON files under `data/sessions/`.
- Automatically expires sessions and cleans up stale temporary GitHub clones.

## GitHub repositories

Paste a public repository URL into the project field, for example:

```text
https://github.com/owner/repository
```

DocForge validates that the URL is hosted on GitHub, performs a shallow clone into a temporary directory, and runs the same read-only scanner used for local projects. The clone is not executed. Private repositories require GitHub credentials configured for the local `git` command.

Session URLs include a stable identifier (`?session=sess_...`) so analysis and approval decisions can be restored after a browser refresh or server restart. Session files are local-only and ignored by Git.

## Enrichment mode

Enrichment uses Ollama locally by default. TokenWise source metadata is sent only to the local Ollama process. If Ollama is unavailable, DocForge automatically falls back to deterministic local suggestions.

Install Ollama separately, then download a local instruction-following model:

```bash
ollama pull llama3.2
```

Start Ollama, then run DocForge. To force fallback mode:

```bash
DOCFORGE_AI_PROVIDER=local npm start
```

Click **Generate local suggestions** after analyzing a project. Approved suggestions are included when downloading OpenAPI or Markdown exports.

The next layer will generate validated OpenAPI and Markdown documentation, followed by optional structured AI enrichment.

## CLI and CI

DocForge can run locally without starting the web server. Node.js 18 or newer is required:

```bash
npm link
docforge analyze . --output .docforge
docforge generate . --format markdown --output .docforge
docforge generate . --format openapi --output .docforge
docforge generate . --format html --output .docforge
docforge generate . --format bundle --output .docforge
docforge check . --config docforge.config.json
```

The optional `docforge.config.json` file controls deterministic CI gates:

```json
{
  "outputDir": ".docforge",
  "minRouteCoverage": 0.8,
  "minRouteConfidence": 0.7,
  "minAverageConfidence": 0.75,
  "includeWarnings": true
}
```

`docforge check` exits `0` when quality gates pass, `1` when they fail, `2` for invalid usage/configuration, `3` for analysis failures, and `4` for export failures. A ready-to-copy GitHub Actions workflow is included at `.github/workflows/docforge.yml`; it uploads generated Markdown as a build artifact.
