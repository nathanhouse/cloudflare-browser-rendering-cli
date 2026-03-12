# Cloudflare Browser Rendering CLI

CLI tools for [Cloudflare Browser Rendering](https://developers.cloudflare.com/browser-rendering/) — render, screenshot, scrape, crawl, and extract data from web pages via Cloudflare's REST API.

Two scripts, zero dependencies beyond [Bun](https://bun.sh):

- **`cloudflare-render.ts`** — Single page: HTML, Markdown, links, scrape, AI JSON extraction, screenshot, PDF, snapshot
- **`cloudflare-crawl.ts`** — Multi-page: crawl websites with sync/async modes, multiple output formats

## Setup

### 1. Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

### 2. Get Cloudflare API Token

1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Create a token with **Account > Browser Rendering > Edit** permission
3. Note your Account ID from the Cloudflare dashboard URL

### 3. Configure Credentials

**Option A: Environment variables (recommended)**

```bash
export CLOUDFLARE_BROWSER_RENDERING_TOKEN="your-token-here"
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
```

**Option B: `.env` file**

Create a file (default path: `~/.claude/credentials/cloudflare-browser-rendering.env`, override with `CFBR_ENV_FILE`):

```
CLOUDFLARE_BROWSER_RENDERING_TOKEN=your-token-here
CLOUDFLARE_ACCOUNT_ID=your-account-id
```

## Usage: cloudflare-render.ts

Render, screenshot, scrape, or extract data from a single page.

```bash
# Get page as Markdown
bun run cloudflare-render.ts markdown https://example.com

# Get fully rendered HTML
bun run cloudflare-render.ts content https://example.com

# Extract all links
bun run cloudflare-render.ts links https://example.com

# Screenshot (PNG by default)
bun run cloudflare-render.ts screenshot https://example.com --output page.png

# Full-page screenshot as JPEG
bun run cloudflare-render.ts screenshot https://example.com --full-page --type jpeg --quality 80

# Generate PDF (A4, landscape)
bun run cloudflare-render.ts pdf https://example.com --landscape --pdf-format a4

# Scrape elements by CSS selector
bun run cloudflare-render.ts scrape https://example.com --selector "h1" --selector "a"

# AI-powered structured data extraction
bun run cloudflare-render.ts json https://example.com --prompt "Extract the page title and description"

# Snapshot (screenshot file + HTML to stdout)
bun run cloudflare-render.ts snapshot https://example.com

# Render raw HTML (no URL needed)
bun run cloudflare-render.ts content --html "<h1>Hello World</h1>"
```

### Commands

| Command | Output | Description |
|---------|--------|-------------|
| `content` | HTML to stdout | Fully rendered HTML |
| `markdown` | Markdown to stdout | Page converted to Markdown |
| `links` | URLs to stdout | One link per line |
| `scrape` | JSON to stdout | Elements by CSS selector |
| `json` | JSON to stdout | AI-extracted structured data |
| `screenshot` | PNG/JPEG/WebP file | Page screenshot |
| `pdf` | PDF file | Page as PDF |
| `snapshot` | File + stdout | Screenshot to file, HTML to stdout |

### Options

**Shared:**

| Flag | Purpose |
|------|---------|
| `--html <string>` | Render raw HTML instead of URL |
| `--output <path>` | Save output to file |
| `--user-agent <string>` | Custom User-Agent |
| `--auth <user:pass>` | HTTP Basic authentication |
| `--header <Name: Value>` | Extra HTTP header (repeatable) |
| `--reject-resource <type>` | Block resource type (repeatable) |
| `--goto-options <json>` | Page load options |
| `--wait-selector <json>` | Wait for CSS selector |
| `--cookies <json>` | Cookies JSON array |
| `--viewport <json>` | Viewport dimensions |

**Screenshot/Snapshot:** `--full-page`, `--type <png|jpeg|webp>`, `--quality <1-100>`, `--selector <css>`, `--screenshot-options <json>`

**PDF:** `--landscape`, `--print-background`, `--pdf-format <letter|a4|a3|legal|tabloid>`, `--scale <0.1-2.0>`, `--pdf-options <json>`

**Links:** `--visible-only`, `--exclude-external`

**Scrape:** `--selector <css>` (repeatable, required)

**JSON:** `--prompt <string>`, `--schema <json-or-file>`, `--model <json-array>`

## Usage: cloudflare-crawl.ts

Crawl websites — follows links, returns content in bulk.

```bash
# Quick single-page crawl
bun run cloudflare-crawl.ts https://example.com --limit 1

# Crawl docs section (50 pages, 3 levels deep)
bun run cloudflare-crawl.ts https://docs.example.com --limit 50 --depth 3

# Static mode (no JS rendering — faster, cheaper)
bun run cloudflare-crawl.ts https://example.com --no-render --limit 20

# Save to file
bun run cloudflare-crawl.ts https://example.com --output site.md

# HTML format output
bun run cloudflare-crawl.ts https://example.com --limit 5 --format html

# JSON format with AI extraction
bun run cloudflare-crawl.ts https://example.com --format json --json-options '{"prompt":"Extract title"}'

# Only crawl /docs/ pages
bun run cloudflare-crawl.ts https://example.com --include "/docs/**"

# Async: submit and check later
bun run cloudflare-crawl.ts https://example.com --limit 100 --async
bun run cloudflare-crawl.ts --status <jobId>

# Cancel a running job
bun run cloudflare-crawl.ts --cancel <jobId>

# Block images and fonts for speed
bun run cloudflare-crawl.ts https://example.com --reject-resource image --reject-resource font
```

### Options

| Flag | Default | Purpose |
|------|---------|---------|
| `--limit <n>` | 10 | Max pages to crawl |
| `--depth <n>` | 3 | Max link depth |
| `--format <type>` | markdown | `markdown`, `html`, `json` |
| `--include <pattern>` | — | URL include glob (repeatable) |
| `--exclude <pattern>` | — | URL exclude glob (repeatable) |
| `--no-render` | false | Skip JS rendering (static HTML) |
| `--output <path>` | stdout | Save to file |
| `--async` | false | Submit only, print job ID |
| `--status <jobId>` | — | Check job status |
| `--cancel <jobId>` | — | Cancel running job |
| `--timeout <secs>` | 600 | Max poll wait |
| `--source <type>` | all | `all`, `sitemaps`, `links` |
| `--max-age <secs>` | — | Cache max age (max 604800) |
| `--include-external` | false | Follow external links |
| `--include-subdomains` | false | Follow subdomain links |
| `--reject-resource <type>` | — | Block resource type (repeatable) |
| `--user-agent <string>` | — | Custom User-Agent |
| `--auth <user:pass>` | — | HTTP Basic authentication |
| `--header <Name: Value>` | — | Extra HTTP header (repeatable) |
| `--json-options <json>` | — | JSON extraction options (requires `--format json`) |
| `--goto-options <json>` | — | Page load options |
| `--wait-selector <json>` | — | Wait for selector |

## Cloudflare Limits

| Plan | Jobs/Day | Max Pages | Rate Limit |
|------|----------|-----------|------------|
| Free | 5 | 100 | 6 req/min |
| Paid | Unlimited | 100,000 | 600 req/min |

## More

If you want more tools and content like this:

- [LinkedIn](https://www.linkedin.com/in/nathanhouse/) — Nathan House
- [StationX](https://www.stationx.net) — Cybersecurity training platform
- [YouTube](https://www.youtube.com/@StationxNet) — StationX channel
- [JobZoneRisk.com](https://jobzonerisk.com) — AI job displacement risk tracker

## License

MIT
