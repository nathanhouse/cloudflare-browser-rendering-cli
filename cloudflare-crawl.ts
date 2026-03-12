#!/usr/bin/env bun
// HAL-ID: #HAL-20260311-0803-NH-PH
// Description: Cloudflare Browser Rendering /crawl endpoint CLI
// Exit codes: 0 = success/help, 1 = error (invalid input, API failure, timeout)

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const API_BASE = "https://api.cloudflare.com/client/v4/accounts";
const CREDENTIALS_PATH = join(
	homedir(),
	".claude/credentials/cloudflare-browser-rendering.env",
);

interface CrawlConfig {
	url: string;
	limit: number;
	depth: number;
	formats: string[];
	render: boolean;
	source?: string;
	maxAge?: number;
	modifiedSince?: number;
	userAgent?: string;
	rejectResourceTypes?: string[];
	authenticate?: { username: string; password: string };
	setExtraHTTPHeaders?: Record<string, string>;
	gotoOptions?: Record<string, unknown>;
	waitForSelector?: Record<string, unknown>;
	jsonOptions?: Record<string, unknown>;
	options: {
		includePatterns?: string[];
		excludePatterns?: string[];
		includeExternalLinks?: boolean;
		includeSubdomains?: boolean;
	};
}

interface CrawlRecord {
	url: string;
	status: string;
	markdown?: string;
	html?: string;
	json?: unknown;
	metadata?: { status: number; title: string; url: string };
}

interface CrawlJobResponse {
	success: boolean;
	result: string;
}

interface CrawlStatusResponse {
	success: boolean;
	result: {
		id: string;
		status: string;
		browserSecondsUsed: number;
		total: number;
		finished: number;
		records: CrawlRecord[];
		cursor?: number;
	};
}

function loadCredentials(): { token: string; accountId: string } {
	// 1. Check environment variables first
	const envToken = process.env.CLOUDFLARE_BROWSER_RENDERING_TOKEN;
	const envAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
	if (envToken && envToken !== "<token>" && envAccount) {
		return { token: envToken, accountId: envAccount };
	}

	// 2. Fall back to .env file (CFBR_ENV_FILE or default path)
	const envFile = process.env.CFBR_ENV_FILE || CREDENTIALS_PATH;

	if (!existsSync(envFile)) {
		console.error("Error: Credentials not found.");
		console.error(
			"Set CLOUDFLARE_BROWSER_RENDERING_TOKEN and CLOUDFLARE_ACCOUNT_ID env vars,",
		);
		console.error(`or create: ${envFile}`);
		console.error(
			"Create token: https://dash.cloudflare.com/profile/api-tokens",
		);
		console.error("Permission: Account > Browser Rendering > Edit");
		process.exit(1);
	}

	const content = readFileSync(envFile, "utf-8");
	const tokenMatch = content.match(/CLOUDFLARE_BROWSER_RENDERING_TOKEN=(.+)/);
	const accountMatch = content.match(/CLOUDFLARE_ACCOUNT_ID=(.+)/);

	if (!tokenMatch || tokenMatch[1].trim() === "<token>") {
		console.error("Error: CLOUDFLARE_BROWSER_RENDERING_TOKEN not set");
		console.error(`Edit: ${envFile}`);
		process.exit(1);
	}

	if (!accountMatch) {
		console.error("Error: CLOUDFLARE_ACCOUNT_ID not found");
		process.exit(1);
	}

	return {
		token: tokenMatch[1].trim(),
		accountId: accountMatch[1].trim(),
	};
}

function validateJobId(id: string): string {
	if (!/^[a-f0-9-]+$/i.test(id)) {
		console.error(`Error: Invalid job ID format '${id}'`);
		process.exit(1);
	}
	return id;
}

function validateUrl(input: string): string {
	try {
		const parsed = new URL(input);
		if (!["http:", "https:"].includes(parsed.protocol)) {
			throw new Error("Only http/https URLs supported");
		}
		return parsed.href;
	} catch {
		console.error(`Error: Invalid URL '${input}'`);
		process.exit(1);
		throw new Error("unreachable");
	}
}

async function startCrawl(
	token: string,
	accountId: string,
	config: CrawlConfig,
): Promise<string> {
	const url = `${API_BASE}/${accountId}/browser-rendering/crawl`;

	const { options, ...baseConfig } = config;

	const body: Record<string, unknown> = { ...baseConfig };

	const hasOptions =
		options.includePatterns?.length ||
		options.excludePatterns?.length ||
		options.includeExternalLinks ||
		options.includeSubdomains;

	if (hasOptions) {
		body.options = options;
	}

	const response = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Crawl start failed (${response.status}): ${error}`);
	}

	const raw = await response.text();
	let data: CrawlJobResponse;
	try {
		data = JSON.parse(raw);
	} catch {
		throw new Error(`API returned non-JSON response: ${raw.slice(0, 200)}`);
	}
	if (!data.success) {
		throw new Error(`Crawl start failed: ${JSON.stringify(data)}`);
	}

	return data.result;
}

async function getCrawlStatus(
	token: string,
	accountId: string,
	jobId: string,
	limit = 10,
	status?: string,
	cursor?: number,
): Promise<CrawlStatusResponse> {
	const params = new URLSearchParams({ limit: String(limit) });
	if (status) params.set("status", status);
	if (cursor !== undefined) params.set("cursor", String(cursor));

	const url = `${API_BASE}/${accountId}/browser-rendering/crawl/${jobId}?${params}`;

	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${token}` },
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Status check failed (${response.status}): ${error}`);
	}

	const raw = await response.text();
	let data: CrawlStatusResponse;
	try {
		data = JSON.parse(raw);
	} catch {
		throw new Error(`API returned non-JSON response: ${raw.slice(0, 200)}`);
	}
	return data;
}

async function cancelCrawl(
	token: string,
	accountId: string,
	jobId: string,
): Promise<void> {
	const url = `${API_BASE}/${accountId}/browser-rendering/crawl/${jobId}`;

	const response = await fetch(url, {
		method: "DELETE",
		headers: { Authorization: `Bearer ${token}` },
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Cancel failed (${response.status}): ${error}`);
	}
}

async function pollForCompletion(
	token: string,
	accountId: string,
	jobId: string,
	timeoutSecs: number,
): Promise<void> {
	const startTime = Date.now();
	const timeoutMs = timeoutSecs * 1000;
	const backoffSteps = [2000, 4000, 8000, 15000];
	let step = 0;

	// Initial delay — job needs time to register before it's queryable
	await new Promise((resolve) => setTimeout(resolve, 5000));

	while (Date.now() - startTime < timeoutMs) {
		let result: Awaited<ReturnType<typeof getCrawlStatus>>;
		try {
			result = await getCrawlStatus(token, accountId, jobId, 1);
		} catch (err) {
			// Job may not be queryable yet — retry on 404 during early polls
			if (step < 8 && err instanceof Error && err.message.includes("404")) {
				console.error("Waiting for job to register...");
				step++;
				await new Promise((resolve) => setTimeout(resolve, 5000));
				continue;
			}
			throw err;
		}

		const { status, finished, total } = result.result;
		const browserSecs = result.result.browserSecondsUsed ?? 0;

		console.error(
			`Status: ${status} | ${finished}/${total} pages | ${browserSecs.toFixed(1)}s browser time`,
		);

		if (status === "completed") return;

		if (status.startsWith("cancelled") || status === "errored") {
			throw new Error(`Crawl ${status}`);
		}

		const delay = backoffSteps[Math.min(step, backoffSteps.length - 1)];
		step++;
		await new Promise((resolve) => setTimeout(resolve, delay));
	}

	throw new Error(`Timeout after ${timeoutSecs}s`);
}

async function fetchAllResults(
	token: string,
	accountId: string,
	jobId: string,
): Promise<CrawlRecord[]> {
	const allRecords: CrawlRecord[] = [];
	let cursor: number | undefined;
	const pageSize = 50;

	while (true) {
		const result = await getCrawlStatus(
			token,
			accountId,
			jobId,
			pageSize,
			"completed",
			cursor,
		);
		allRecords.push(...result.result.records);

		if (!result.result.cursor || result.result.records.length < pageSize) {
			break;
		}
		cursor = result.result.cursor;
	}

	return allRecords;
}

function writeOutputSafe(content: string, outputPath: string | null): void {
	if (outputPath) {
		try {
			writeFileSync(outputPath, content);
			console.error(`Saved to ${outputPath}`);
		} catch (err) {
			console.error(
				`Error: Failed to write to ${outputPath}: ${err instanceof Error ? err.message : err}`,
			);
			console.error("Dumping output to stdout instead:");
			console.log(content);
			process.exit(1);
		}
	} else {
		console.log(content);
	}
}

function formatOutput(records: CrawlRecord[], format: string): string {
	if (format === "json") {
		return JSON.stringify(records, null, 2);
	}

	if (format === "html") {
		return records
			.map((r) => `<!-- ${r.url} -->\n${r.html || ""}`)
			.join("\n\n");
	}

	// markdown (default)
	return records
		.map((r) => {
			const title = r.metadata?.title || r.url;
			return `# ${title}\n\nSource: ${r.url}\n\n${r.markdown || ""}`;
		})
		.join("\n\n---\n\n");
}

function printUsage(): void {
	console.log(`Cloudflare Browser Rendering /crawl CLI

Usage:
  cloudflare-crawl.ts <url> [options]
  cloudflare-crawl.ts --status <jobId>
  cloudflare-crawl.ts --cancel <jobId>

Options:
  --limit <n>              Max pages to crawl (default: 10)
  --depth <n>              Max link depth (default: 3)
  --format <type>          Output: markdown, html, json (default: markdown)
  --include <pattern>      URL include glob (repeatable)
  --exclude <pattern>      URL exclude glob (repeatable)
  --no-render              Skip JS rendering (static HTML only)
  --output <path>          Save to file (default: stdout)
  --async                  Submit only, print job ID
  --status <jobId>         Check existing job status
  --cancel <jobId>         Cancel a running crawl job
  --timeout <secs>         Max poll wait (default: 600)
  --source <type>          URL source: all, sitemaps, links (default: all)
  --max-age <secs>         Cache max age in seconds (max: 604800)
  --modified-since <ts>    Only crawl pages modified after Unix timestamp
  --include-external       Follow links to external domains
  --include-subdomains     Follow links to subdomains
  --reject-resource <type> Block resource type (repeatable: image, media, font, stylesheet)
  --user-agent <string>    Custom User-Agent string
  --auth <user:pass>       HTTP Basic authentication
  --header <Name: Value>   Extra HTTP header (repeatable)
  --json-options <json>    JSON extraction options (requires --format json)
  --goto-options <json>    Page load options, e.g. '{"waitUntil":"networkidle2"}'
  --wait-selector <json>   Wait for selector, e.g. '{"selector":"#content"}'

Examples:
  # Quick single-page crawl
  cloudflare-crawl.ts https://example.com --limit 1

  # Crawl docs section
  cloudflare-crawl.ts https://docs.example.com --limit 50 --depth 3

  # Static crawl (no JS, faster)
  cloudflare-crawl.ts https://example.com --no-render

  # Only /docs/ pages
  cloudflare-crawl.ts https://example.com --include "/docs/**"

  # Async: submit and check later
  cloudflare-crawl.ts https://example.com --limit 100 --async
  cloudflare-crawl.ts --status <jobId>

  # Save to file
  cloudflare-crawl.ts https://example.com --output /tmp/site.md

  # Crawl sitemaps only
  cloudflare-crawl.ts https://example.com --source sitemaps --limit 100

  # Block images and fonts for speed
  cloudflare-crawl.ts https://example.com --reject-resource image --reject-resource font

  # Crawl with HTTP auth
  cloudflare-crawl.ts https://secure.example.com --auth admin:secret123

  # Custom headers (e.g. API key)
  cloudflare-crawl.ts https://api.example.com/docs --header "X-API-Key: abc123"

  # Wait for dynamic content
  cloudflare-crawl.ts https://app.example.com --wait-selector '{"selector":"[data-loaded]","timeout":30000}'

  # Extract structured JSON with AI
  cloudflare-crawl.ts https://shop.example.com --format json --json-options '{"prompt":"Extract product name and price"}'

Limits:
  Free:  5 jobs/day, 100 pages max, 6 req/min
  Paid:  Unlimited jobs, 100K pages, 600 req/min`);
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);

	if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
		printUsage();
		process.exit(0);
	}

	// Parse arguments
	let targetUrl = "";
	let limit = 10;
	let depth = 3;
	let format = "markdown";
	const includePatterns: string[] = [];
	const excludePatterns: string[] = [];
	let render = true;
	let outputPath: string | null = null;
	let asyncMode = false;
	let statusJobId = "";
	let cancelJobId = "";
	let timeout = 600;
	let source: string | undefined;
	let maxAge: number | undefined;
	let modifiedSince: number | undefined;
	let userAgent: string | undefined;
	const rejectResourceTypes: string[] = [];
	let authenticate: { username: string; password: string } | undefined;
	const extraHeaders: Record<string, string> = {};
	let gotoOptions: Record<string, unknown> | undefined;
	let waitForSelector: Record<string, unknown> | undefined;
	let jsonOptions: Record<string, unknown> | undefined;
	let includeExternalLinks = false;
	let includeSubdomains = false;

	function requireArg(flag: string, i: number): string {
		if (i + 1 >= args.length) {
			console.error(`Error: ${flag} requires a value`);
			process.exit(1);
		}
		return args[i + 1];
	}

	function requireInt(flag: string, i: number): number {
		const val = Number.parseInt(requireArg(flag, i), 10);
		if (Number.isNaN(val) || val < 1) {
			console.error(`Error: ${flag} must be a positive integer`);
			process.exit(1);
		}
		return val;
	}

	function requireNonNegativeInt(flag: string, i: number): number {
		const val = Number.parseInt(requireArg(flag, i), 10);
		if (Number.isNaN(val) || val < 0) {
			console.error(`Error: ${flag} must be a non-negative integer`);
			process.exit(1);
		}
		return val;
	}

	function requireJson(flag: string, i: number): Record<string, unknown> {
		const raw = requireArg(flag, i);
		try {
			const parsed = JSON.parse(raw);
			if (
				typeof parsed !== "object" ||
				parsed === null ||
				Array.isArray(parsed)
			) {
				throw new Error("not an object");
			}
			return parsed as Record<string, unknown>;
		} catch {
			console.error(`Error: ${flag} requires valid JSON object`);
			process.exit(1);
			throw new Error("unreachable");
		}
	}

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		if (arg === "--limit") {
			limit = requireInt("--limit", i);
			i++;
		} else if (arg === "--depth") {
			depth = requireInt("--depth", i);
			i++;
		} else if (arg === "--format") {
			format = requireArg("--format", i);
			i++;
		} else if (arg === "--include") {
			includePatterns.push(requireArg("--include", i));
			i++;
		} else if (arg === "--exclude") {
			excludePatterns.push(requireArg("--exclude", i));
			i++;
		} else if (arg === "--no-render") {
			render = false;
		} else if (arg === "--output") {
			outputPath = requireArg("--output", i);
			i++;
		} else if (arg === "--async") {
			asyncMode = true;
		} else if (arg === "--status") {
			statusJobId = validateJobId(requireArg("--status", i));
			i++;
		} else if (arg === "--cancel") {
			cancelJobId = validateJobId(requireArg("--cancel", i));
			i++;
		} else if (arg === "--timeout") {
			timeout = requireInt("--timeout", i);
			i++;
		} else if (arg === "--source") {
			source = requireArg("--source", i);
			const validSources = ["all", "sitemaps", "links"];
			if (!validSources.includes(source)) {
				console.error(
					`Error: --source must be one of: ${validSources.join(", ")}`,
				);
				process.exit(1);
			}
			i++;
		} else if (arg === "--max-age") {
			maxAge = requireNonNegativeInt("--max-age", i);
			if (maxAge > 604800) {
				console.error("Error: --max-age maximum is 604800 (7 days)");
				process.exit(1);
			}
			i++;
		} else if (arg === "--modified-since") {
			modifiedSince = requireNonNegativeInt("--modified-since", i);
			i++;
		} else if (arg === "--user-agent") {
			userAgent = requireArg("--user-agent", i);
			i++;
		} else if (arg === "--reject-resource") {
			const resType = requireArg("--reject-resource", i);
			const validResourceTypes = [
				"image",
				"media",
				"font",
				"stylesheet",
				"script",
				"document",
				"texttrack",
				"xhr",
				"fetch",
				"eventsource",
				"websocket",
				"manifest",
				"other",
			];
			if (!validResourceTypes.includes(resType)) {
				console.error(
					`Error: --reject-resource must be one of: ${validResourceTypes.join(", ")}`,
				);
				process.exit(1);
			}
			rejectResourceTypes.push(resType);
			i++;
		} else if (arg === "--include-external") {
			includeExternalLinks = true;
		} else if (arg === "--include-subdomains") {
			includeSubdomains = true;
		} else if (arg === "--auth") {
			const authVal = requireArg("--auth", i);
			const colonIdx = authVal.indexOf(":");
			if (colonIdx < 1) {
				console.error("Error: --auth format is user:password");
				process.exit(1);
			}
			authenticate = {
				username: authVal.slice(0, colonIdx),
				password: authVal.slice(colonIdx + 1),
			};
			i++;
		} else if (arg === "--header") {
			const headerVal = requireArg("--header", i);
			const colonIdx = headerVal.indexOf(":");
			if (colonIdx < 1) {
				console.error("Error: --header format is 'Name: Value'");
				process.exit(1);
			}
			const name = headerVal.slice(0, colonIdx).trim();
			const value = headerVal.slice(colonIdx + 1).trim();
			extraHeaders[name] = value;
			i++;
		} else if (arg === "--json-options") {
			jsonOptions = requireJson("--json-options", i);
			i++;
		} else if (arg === "--goto-options") {
			gotoOptions = requireJson("--goto-options", i);
			i++;
		} else if (arg === "--wait-selector") {
			waitForSelector = requireJson("--wait-selector", i);
			i++;
		} else if (!arg.startsWith("-")) {
			targetUrl = arg;
		} else {
			console.error(`Error: Unknown flag '${arg}'`);
			process.exit(1);
		}
	}

	const { token, accountId } = loadCredentials();

	// Handle --cancel
	if (cancelJobId) {
		try {
			console.error(`Cancelling job ${cancelJobId}...`);
			await cancelCrawl(token, accountId, cancelJobId);
			console.error("Cancelled.");
		} catch (error) {
			console.error(`Error: ${error instanceof Error ? error.message : error}`);
			process.exit(1);
		}
		return;
	}

	// Handle --status
	if (statusJobId) {
		try {
			const result = await getCrawlStatus(token, accountId, statusJobId, 1);
			const { status, finished, total } = result.result;
			const browserSecs = result.result.browserSecondsUsed ?? 0;
			console.error(
				`Job: ${statusJobId}\nStatus: ${status}\nPages: ${finished}/${total}\nBrowser time: ${browserSecs.toFixed(1)}s`,
			);

			if (status === "completed") {
				console.error("Fetching results...");
				const records = await fetchAllResults(token, accountId, statusJobId);
				const output = formatOutput(records, format);
				writeOutputSafe(output, outputPath);
			}
		} catch (error) {
			console.error(`Error: ${error instanceof Error ? error.message : error}`);
			process.exit(1);
		}
		return;
	}

	// Require URL for crawl
	if (!targetUrl) {
		console.error("Error: URL required. Use --help for usage.");
		process.exit(1);
	}

	const validatedUrl = validateUrl(targetUrl);

	// Map format to API formats array
	const formatMap: Record<string, string[]> = {
		markdown: ["markdown"],
		html: ["html"],
		json: ["json"],
	};

	if (!formatMap[format]) {
		console.error(
			`Error: Invalid format '${format}'. Use: markdown, html, json`,
		);
		process.exit(1);
	}

	if (jsonOptions && format !== "json") {
		console.error("Error: --json-options requires --format json");
		process.exit(1);
	}

	if (format === "json" && !jsonOptions) {
		console.error(
			'Error: --format json requires --json-options (e.g. --json-options \'{"prompt":"Extract..."}\')',
		);
		process.exit(1);
	}

	const config: CrawlConfig = {
		url: validatedUrl,
		limit,
		depth,
		formats: formatMap[format],
		render,
		...(source && { source }),
		...(maxAge !== undefined && { maxAge }),
		...(modifiedSince !== undefined && { modifiedSince }),
		...(userAgent && { userAgent }),
		...(rejectResourceTypes.length && { rejectResourceTypes }),
		...(authenticate && { authenticate }),
		...(Object.keys(extraHeaders).length && {
			setExtraHTTPHeaders: extraHeaders,
		}),
		...(gotoOptions && { gotoOptions }),
		...(waitForSelector && { waitForSelector }),
		...(jsonOptions && { jsonOptions }),
		options: {
			...(includePatterns.length && { includePatterns }),
			...(excludePatterns.length && { excludePatterns }),
			...(includeExternalLinks && { includeExternalLinks }),
			...(includeSubdomains && { includeSubdomains }),
		},
	};

	console.error(
		`Crawling ${validatedUrl} (limit: ${limit}, depth: ${depth}, render: ${render})`,
	);

	try {
		const jobId = await startCrawl(token, accountId, config);
		console.error(`Job ID: ${jobId}`);

		if (asyncMode) {
			console.log(JSON.stringify({ job_id: jobId }));
			return;
		}

		await pollForCompletion(token, accountId, jobId, timeout);

		console.error("Fetching results...");
		const records = await fetchAllResults(token, accountId, jobId);
		console.error(`Got ${records.length} pages`);

		const output = formatOutput(records, format);
		writeOutputSafe(output, outputPath);
	} catch (error) {
		console.error(`Error: ${error instanceof Error ? error.message : error}`);
		process.exit(1);
	}
}

main();
