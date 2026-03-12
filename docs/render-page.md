# Render Single Page with Cloudflare Browser Rendering

Render, screenshot, scrape, or extract data from individual pages via Cloudflare's REST API.

## Prerequisites

Token must be created at https://dash.cloudflare.com/profile/api-tokens
- Permission: **Account > Browser Rendering > Edit**
- Credentials: env vars `CLOUDFLARE_BROWSER_RENDERING_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`, or `.env` file (see README)

## Quick Start

```bash
# Get page as Markdown
bun run cloudflare-render.ts markdown https://example.com

# Get page as HTML
bun run cloudflare-render.ts content https://example.com

# Screenshot (full page, saves PNG)
bun run cloudflare-render.ts screenshot https://example.com --full-page

# Generate PDF (A4 landscape)
bun run cloudflare-render.ts pdf https://example.com --landscape --pdf-format a4

# Extract all links (one per line)
bun run cloudflare-render.ts links https://example.com --visible-only

# Scrape elements by CSS selector
bun run cloudflare-render.ts scrape https://example.com --selector h1 --selector "a"

# AI-powered structured data extraction
bun run cloudflare-render.ts json https://example.com --prompt "Extract title and description"

# Snapshot (screenshot file + HTML to stdout)
bun run cloudflare-render.ts snapshot https://example.com
```

## Commands

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

## Shared Options

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

## Command-Specific Options

**screenshot/snapshot:** `--full-page`, `--type <png|jpeg|webp>`, `--quality <1-100>`, `--selector <css>`, `--screenshot-options <json>`

**pdf:** `--landscape`, `--print-background`, `--pdf-format <letter|a4|a3|legal|tabloid>`, `--scale <0.1-2.0>`, `--pdf-options <json>`

**links:** `--visible-only`, `--exclude-external`

**scrape:** `--selector <css>` (repeatable, required)

**json:** `--prompt <string>`, `--schema <json-or-file>`, `--model <json-array>`

## When to Use render vs crawl

| Need | Use |
|------|-----|
| Single page content/screenshot/PDF | `cloudflare-render.ts` |
| Multiple pages, follow links | `cloudflare-crawl.ts` |
| Structured data from one page | `cloudflare-render.ts` (`json` or `scrape`) |
| Site-wide content extraction | `cloudflare-crawl.ts` |
