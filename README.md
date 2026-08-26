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

## Enrichment mode

The current enrichment feature is intentionally local and deterministic. It validates the same shape that a future model provider will return, but does not send TokenWise source metadata to an external AI service. This keeps the first review workflow safe while the provider boundary is evaluated.

Click **Generate local suggestions** after analyzing a project. Approved suggestions are included when downloading OpenAPI or Markdown exports.

The next layer will generate validated OpenAPI and Markdown documentation, followed by optional structured AI enrichment.
