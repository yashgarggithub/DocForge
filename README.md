# 🛠️ DocForge

**Turn a source-code repository into documentation people can actually use.**

DocForge is a local-first documentation workbench. It discovers how a product works from source code, lets you review the findings, and exports documentation for both people and developer tools:

```text
Local or GitHub source → Framework adapters → Product and API documentation
```

## Before you begin

- **Node.js 18 or newer** is required.
- **Git** is required when analyzing a public GitHub repository.
- **Ollama** is optional and only needed for local AI suggestions.
- A **Gemini API key** is optional and only needed when Gemini is selected.

DocForge reads source files without executing the analyzed project. Secrets and environment variable values are excluded from analysis.

## Run locally

Requires Node.js 18 or newer.

```bash
npm start
open http://127.0.0.1:5050
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

Enrichment uses Ollama locally by default. Analyzed source metadata is sent only to the local Ollama process. If Ollama is unavailable, DocForge automatically falls back to deterministic suggestions.

### Choose an enrichment provider

- **Local deterministic** — always available; requires no model or API key.
- **Ollama** — runs a local model; requires Ollama and a downloaded model.
- **Gemini** — uses Google’s hosted API; requires `GEMINI_API_KEY`.
- **OpenAI** — uses the OpenAI Responses API; requires `OPENAI_API_KEY` and separate API project access.

Install Ollama separately, then download a local instruction-following model:

```bash
ollama pull llama3.2
```

Start Ollama, then run DocForge. To force fallback mode:

```bash
DOCFORGE_AI_PROVIDER=local npm start
```

To opt into Gemini hosted enrichment, set a Gemini API key in your environment:

```bash
export DOCFORGE_AI_PROVIDER=gemini
export GEMINI_API_KEY=your_api_key
export GEMINI_MODEL=gemini-3.6-flash
npm start
```

You can verify the configured Gemini model directly (the response should be JSON):

```bash
curl -sS -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=$GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Reply with JSON: {\"ok\":true}"}]}],"generationConfig":{"responseMimeType":"application/json"}}'
```

Gemini sends source-derived route metadata to Google's hosted API and may have quotas or usage charges. Keep the key out of source control. If the key is missing or Gemini fails, DocForge falls back to deterministic local suggestions.

OpenAI API access is separate from a ChatGPT or Codex subscription. Configure an API-enabled project before selecting OpenAI:

```bash
export DOCFORGE_AI_PROVIDER=openai
export OPENAI_API_KEY=your_api_key
export OPENAI_MODEL=gpt-5-codex
npm start
```

Verify OpenAI API access with a minimal structured response:

```bash
curl -sS https://api.openai.com/v1/responses \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5-codex","store":false,"input":"Reply with JSON: {\"ok\":true}","text":{"format":{"type":"json_schema","name":"health_check","strict":true,"schema":{"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"],"additionalProperties":false}}}}'
```

Click **Generate suggestions** after analyzing a project. Approved suggestions are included when downloading OpenAPI or Markdown exports.

## 📖 Beginner's guide

### What problem does DocForge solve?

Most repositories contain useful information, but it is spread across route handlers, frontend calls, configuration, dependencies, and README files. DocForge brings those clues together into one reviewable documentation workspace. 🧭

### The complete workflow

1. 🔍 **Analyze** a local folder or public GitHub URL.
2. 🧩 **Discover** frameworks, languages, routes, request fields, responses, and integrations.
3. 🧠 **Suggest** endpoint descriptions with optional local Ollama enrichment.
4. ✅ **Review** suggestions and approve, edit, or reject them.
5. ✍️ **Edit docs** for overview, use cases, workflow, architecture, and troubleshooting.
6. 📝 **Edit Markdown** directly when you need complete control over the exported document.
7. 👀 **Preview** the product documentation site or raw Markdown.
8. 📦 **Export** Markdown, OpenAPI JSON, HTML, or the complete documentation bundle.

### What should a new user click?

- **Analyze project** starts a repository scan.
- **Generate suggestions** creates optional endpoint explanations using the selected provider.
- **Approve** includes a suggestion in API documentation and OpenAPI output.
- **Edit** changes a suggestion before it is approved.
- **Reject** excludes a suggestion from generated API exports.
- **Product docs** opens a reader-friendly documentation site.
- **Edit docs** changes structured product sections.
- **Edit Markdown** changes the Markdown export itself.
- **Preview Markdown** switches the documentation frame to raw Markdown.
- **Download Markdown** downloads the current Markdown document.
- **Preview OpenAPI** opens an interactive API contract view.
- **OpenAPI JSON** downloads the machine-readable contract.
- **Bundle** downloads all documentation artifacts as one ZIP file.

### Product documentation vs API documentation

📚 **Product documentation** explains what the application is, who uses it, how it works, its architecture, configuration, and troubleshooting guidance.

🔗 **API documentation** explains individual HTTP operations, request fields, response fields, status codes, integrations, and source locations.

DocForge generates both from the same normalized analysis, so the product overview is more than a list of endpoints.

### Evidence and confidence

Every generated statement has an origin:

- 🟢 **Source** — directly visible in code or README content.
- 🔵 **Inferred** — derived from multiple source signals.
- 🟣 **Edited** — changed or written by you.
- 🟠 **Fallback** — created when there was not enough evidence.

Click **View evidence** to see the source file, line number, relevant snippet, and confidence percentage. Confidence is a review signal, not a guarantee. Always check low-confidence statements before publishing.

### Local paths, GitHub clones, and privacy

Local analysis reads the folder you provide. GitHub analysis performs a shallow temporary clone, scans it without executing the repository, and cleans up the clone through session lifecycle management. Temporary clone names and local filesystem paths are redacted from exported documentation.

DocForge excludes `.env` files, `node_modules`, build output, and Git metadata. It may document environment variable **names**, but never their values. 🔒

### Which output should I choose?

- 👩‍💻 Choose **Markdown** for editing, reviews, README content, and version control.
- 🧰 Choose **OpenAPI JSON** for Swagger, Postman, SDK generation, and API tooling.
- 🌐 Choose **HTML** for a polished standalone documentation page.
- 📦 Choose **Bundle** when you want every format and metadata file together.

### CLI quick reference

Link the local CLI once from the DocForge repository:

```bash
cd /Users/you/DocForge
npm link
```

Then analyze or generate documentation for another project:

```bash
cd /Users/you/projects/my-api
docforge analyze .
docforge generate . --format markdown --output .docforge
docforge generate . --format openapi --output .docforge
docforge generate . --format html --output .docforge
docforge generate . --format bundle --output .docforge
docforge check .
```

`docforge check` returns exit code `0` when quality gates pass and `1` when they fail. Codes `2`, `3`, and `4` indicate invalid usage/configuration, analysis failure, and generation failure respectively.

### Common first-run issues

- ❓ **Command not found:** run `npm link` from DocForge and check npm's global bin directory is on your `PATH`.
- 🌍 **GitHub clone failure:** check VPN, firewall, network access, and Git credentials.
- 🤖 **Ollama unavailable:** deterministic analysis still works; suggestions fall back to local mode.
- 🛣️ **No routes detected:** verify the project uses a supported route pattern; dynamic routes may not be inferable.
- ✅ **Quality check failed:** run `docforge check . --json` to see the exact failing metric and route.

### Supported frameworks

| Framework | Language | Typical patterns |
|---|---|---|
| Express | JavaScript / TypeScript | `app.get()`, `app.post()`, routers |
| NestJS | TypeScript | `@Controller()`, `@Get()`, `@Post()` |
| Fastify | JavaScript / TypeScript | `.get()`, `.post()`, `.route()` |
| FastAPI | Python | route decorators, typed parameters, `response_model` |
| Flask | Python | `@app.route()`, `methods=[...]`, request helpers |

React and Vite frontend API calls are also detected when present. Multiple frameworks can be retained in one analysis.

### Important limitations

DocForge v1 uses deterministic source scanning and regular expressions rather than a full AST parser. Dynamic routes, runtime-generated schemas, and complex middleware behavior may require manual review. Confidence scores are estimates, not guarantees. ⚠️


## ⚙️ CI configuration

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
