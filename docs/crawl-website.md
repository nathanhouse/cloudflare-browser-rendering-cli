# Crawl Website - Cloudflare Browser Rendering

Crawl entire websites via Cloudflare's /crawl REST API. Returns content as Markdown, HTML, or JSON.

## Prerequisites

Token must be created at https://dash.cloudflare.com/profile/api-tokens
- Permission: **Account > Browser Rendering > Edit**
- Credentials: env vars `CLOUDFLARE_BROWSER_RENDERING_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`, or `.env` file (see README)

## Quick Start

```bash
# Single page
bun run cloudflare-crawl.ts https://example.com --limit 1

# Crawl docs section (50 pages, 3 levels deep)
bun run cloudflare-crawl.ts https://docs.example.com --limit 50 --depth 3

# Static mode (no JS rendering — faster, cheaper)
bun run cloudflare-crawl.ts https://example.com --no-render --limit 20

# Save to file
bun run cloudflare-crawl.ts https://example.com --output /tmp/site.md
```

## Parameters

| Flag | Default | Purpose |
|------|---------|---------|
| `<url>` | required | Starting URL |
| `--limit <n>` | 10 | Max pages to crawl |
| `--depth <n>` | 3 | Max link depth |
| `--format <type>` | markdown | `html`, `markdown`, `json` |
| `--include <pattern>` | — | URL include glob (repeatable) |
| `--exclude <pattern>` | — | URL exclude glob (repeatable) |
| `--no-render` | false | Skip JS rendering |
| `--output <path>` | stdout | Save to file |
| `--async` | false | Submit only, print job ID |
| `--status <jobId>` | — | Check existing job status |
| `--cancel <jobId>` | — | Cancel running job |
| `--timeout <secs>` | 600 | Max poll wait |
| `--source <type>` | all | URL source: `all`, `sitemaps`, `links` |
| `--max-age <secs>` | — | Cache max age (max 604800, API default: 86400) |
| `--modified-since <ts>` | — | Only pages modified after Unix timestamp |
| `--include-external` | false | Follow links to external domains |
| `--include-subdomains` | false | Follow links to subdomains |
| `--reject-resource <type>` | — | Block resource type (repeatable: image, media, font, stylesheet) |
| `--user-agent <string>` | — | Custom User-Agent string |
| `--auth <user:pass>` | — | HTTP Basic authentication |
| `--header <Name: Value>` | — | Extra HTTP header (repeatable) |
| `--json-options <json>` | — | JSON extraction config (requires `--format json`) |
| `--goto-options <json>` | — | Page load options JSON |
| `--wait-selector <json>` | — | Wait for selector JSON |

## Examples

```bash
# Docs section only
bun run cloudflare-crawl.ts https://example.com --include "/docs/**"

# Exclude admin pages
bun run cloudflare-crawl.ts https://example.com --exclude "/admin/**"

# Large async crawl
bun run cloudflare-crawl.ts https://example.com --limit 100 --async
# Check later:
bun run cloudflare-crawl.ts --status <jobId>

# Cancel a running job
bun run cloudflare-crawl.ts --cancel <jobId>

# JSON output for structured data (--json-options required)
bun run cloudflare-crawl.ts https://example.com --format json --json-options '{"prompt":"Extract title"}' --limit 5

# Crawl sitemaps only
bun run cloudflare-crawl.ts https://example.com --source sitemaps --limit 100

# Block images and fonts for speed
bun run cloudflare-crawl.ts https://example.com --reject-resource image --reject-resource font

# Crawl with HTTP auth
bun run cloudflare-crawl.ts https://secure.example.com --auth admin:secret123

# Custom headers
bun run cloudflare-crawl.ts https://api.example.com/docs --header "X-API-Key: abc123"

# Wait for dynamic content
bun run cloudflare-crawl.ts https://app.example.com --wait-selector '{"selector":"[data-loaded]","timeout":30000}'

# Extract structured JSON with AI
bun run cloudflare-crawl.ts https://shop.example.com --format json --json-options '{"prompt":"Extract product name and price"}'
```

## Limits

| Plan | Jobs/Day | Max Pages | Rate Limit |
|------|----------|-----------|------------|
| Free | 5 | 100 | 6 req/min |
| Paid | Unlimited | 100,000 | 600 req/min |

Jobs available for 14 days after completion. Max runtime: 7 days.

## Expected Output

Sync mode prints crawled content to stdout (or file with `--output`). Stderr shows progress:
```
Crawling https://example.com (limit: 10, depth: 3)...
Status: running (3/10 pages)...
Status: completed (10/10 pages)
```

Async mode (`--async`) prints job ID JSON:
```json
{"job_id": "abc123-..."}
```

## Error Handling

### API 400: missing jsonOptions
`--format json` requires `--json-options`. Add `--json-options '{"prompt":"..."}'`.

### Job status 404
Free tier jobs are short-lived. Check status promptly after async submission.

### Rate limit (429)
Free: 6 req/min. Paid: 600 req/min. Reduce `--limit` or wait.
