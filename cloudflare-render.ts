#!/usr/bin/env bun
// HAL-ID: #HAL-20260311-0806-NH-PF
// Description: Cloudflare Browser Rendering single-page REST API CLI
// Exit codes: 0 = success/help, 1 = error (invalid input, API failure)

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const API_BASE = "https://api.cloudflare.com/client/v4/accounts";
const CREDENTIALS_PATH = join(
	homedir(),
	".claude/credentials/cloudflare-browser-rendering.env",
);

const VALID_COMMANDS = [
	"content",
	"markdown",
	"links",
	"scrape",
	"json",
	"screenshot",
	"pdf",
	"snapshot",
] as const;
type Command = (typeof VALID_COMMANDS)[number];

const VALID_RESOURCE_TYPES = [
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

const VALID_IMAGE_TYPES = ["png", "jpeg", "webp"];
const VALID_PDF_FORMATS = [
	"letter",
	"legal",
	"tabloid",
	"ledger",
	"a0",
	"a1",
	"a2",
	"a3",
	"a4",
	"a5",
	"a6",
];

// --- Credentials ---

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

// --- Validation helpers ---

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

function requireArg(args: string[], flag: string, i: number): string {
	if (i + 1 >= args.length) {
		console.error(`Error: ${flag} requires a value`);
		process.exit(1);
	}
	return args[i + 1];
}

function requireFloat(args: string[], flag: string, i: number): number {
	const val = Number.parseFloat(requireArg(args, flag, i));
	if (Number.isNaN(val)) {
		console.error(`Error: ${flag} must be a number`);
		process.exit(1);
	}
	return val;
}

function requireInt(args: string[], flag: string, i: number): number {
	const val = Number.parseInt(requireArg(args, flag, i), 10);
	if (Number.isNaN(val) || val < 1) {
		console.error(`Error: ${flag} must be a positive integer`);
		process.exit(1);
	}
	return val;
}

function requireJson(
	args: string[],
	flag: string,
	i: number,
): Record<string, unknown> {
	const raw = requireArg(args, flag, i);
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

function requireJsonOrFile(args: string[], flag: string, i: number): unknown {
	const raw = requireArg(args, flag, i);
	const trimmed = raw.trim();
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		try {
			return JSON.parse(trimmed);
		} catch {
			console.error(`Error: ${flag} contains invalid JSON`);
			process.exit(1);
		}
	}
	// Treat as file path
	const filePath = trimmed.startsWith("~/")
		? `${homedir()}/${trimmed.slice(2)}`
		: trimmed;
	if (!existsSync(filePath)) {
		console.error(`Error: ${flag} file not found: ${filePath}`);
		process.exit(1);
	}
	try {
		return JSON.parse(readFileSync(filePath, "utf-8"));
	} catch {
		console.error(`Error: ${flag} file contains invalid JSON: ${filePath}`);
		process.exit(1);
	}
}

function requireJsonArray(args: string[], flag: string, i: number): unknown[] {
	const raw = requireArg(args, flag, i);
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			throw new Error("not an array");
		}
		return parsed;
	} catch {
		console.error(`Error: ${flag} requires valid JSON array`);
		process.exit(1);
		throw new Error("unreachable");
	}
}

// --- API call ---

async function callEndpoint(
	token: string,
	accountId: string,
	endpoint: string,
	body: Record<string, unknown>,
): Promise<Response> {
	const url = `${API_BASE}/${accountId}/browser-rendering/${endpoint}`;

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
		throw new Error(`API error (${response.status}): ${error}`);
	}

	const browserMs = response.headers.get("X-Browser-Ms-Used");
	if (browserMs) {
		console.error(`Browser time: ${(Number(browserMs) / 1000).toFixed(1)}s`);
	}

	return response;
}

// --- Output handlers ---

function writeOutput(content: string, outputPath: string | null): void {
	if (outputPath) {
		try {
			writeFileSync(outputPath, content);
		} catch (err) {
			console.error(
				`Error: Failed to write to ${outputPath}: ${err instanceof Error ? err.message : err}`,
			);
			console.error("Dumping output to stdout instead:");
			console.log(content);
			process.exit(1);
		}
		console.error(`Saved to ${outputPath}`);
	} else {
		console.log(content);
	}
}

function autoFilename(prefix: string, domain: string, ext: string): string {
	const now = new Date();
	const pad = (n: number): string => String(n).padStart(2, "0");
	const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
	const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
	return `${prefix}-${domain}-${date}-${time}.${ext}`;
}

function getDomain(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return "page";
	}
}

async function parseApiResult(response: Response): Promise<unknown> {
	const raw = await response.text();
	let data: { success: boolean; result: unknown };
	try {
		data = JSON.parse(raw);
	} catch {
		throw new Error(`API returned non-JSON response: ${raw.slice(0, 200)}`);
	}
	if (!data.success) {
		throw new Error(`API returned failure: ${JSON.stringify(data)}`);
	}
	return data.result;
}

async function handleTextEndpoint(
	response: Response,
	outputPath: string | null,
): Promise<void> {
	const result = (await parseApiResult(response)) as string;
	writeOutput(result, outputPath);
}

async function handleLinksEndpoint(
	response: Response,
	outputPath: string | null,
): Promise<void> {
	const result = (await parseApiResult(response)) as string[];
	writeOutput(result.join("\n"), outputPath);
}

async function handleJsonEndpoint(
	response: Response,
	outputPath: string | null,
): Promise<void> {
	const result = await parseApiResult(response);
	writeOutput(JSON.stringify(result, null, 2), outputPath);
}

async function handleBinaryEndpoint(
	response: Response,
	outputPath: string | null,
	defaultFilename: string,
): Promise<void> {
	const buffer = Buffer.from(await response.arrayBuffer());
	const filePath = outputPath || defaultFilename;
	try {
		writeFileSync(filePath, buffer);
	} catch (err) {
		throw new Error(
			`Failed to write to ${filePath}: ${err instanceof Error ? err.message : err}`,
		);
	}
	console.error(
		`Saved to ${resolve(filePath)} (${(buffer.length / 1024).toFixed(1)} KB)`,
	);
}

async function handleSnapshotEndpoint(
	response: Response,
	outputPath: string | null,
	defaultScreenshotFilename: string,
): Promise<void> {
	const result = (await parseApiResult(response)) as {
		screenshot: string;
		content: string;
	};

	const screenshotBuffer = Buffer.from(result.screenshot, "base64");
	const screenshotPath = outputPath || defaultScreenshotFilename;
	try {
		writeFileSync(screenshotPath, screenshotBuffer);
	} catch (err) {
		throw new Error(
			`Failed to write screenshot to ${screenshotPath}: ${err instanceof Error ? err.message : err}`,
		);
	}
	console.error(
		`Screenshot saved to ${resolve(screenshotPath)} (${(screenshotBuffer.length / 1024).toFixed(1)} KB)`,
	);

	console.log(result.content);
}

// --- Help ---

function printHelp(command?: string): void {
	if (!command) {
		console.log(`Cloudflare Browser Rendering - Single Page CLI

Usage:
  cloudflare-render.ts <command> <url> [options]
  cloudflare-render.ts <command> --html "<html>..." [options]

Commands:
  content      Fetch fully rendered HTML
  markdown     Extract page as Markdown
  links        Retrieve all links from page
  scrape       Extract elements by CSS selector
  json         AI-powered structured data extraction
  screenshot   Capture page screenshot (PNG/JPEG/WebP)
  pdf          Generate PDF from page
  snapshot     Capture screenshot + HTML in one request

Shared Options:
  --html <string>            Render raw HTML instead of URL
  --output <path>            Save output to file
  --user-agent <string>      Custom User-Agent
  --auth <user:pass>         HTTP Basic authentication
  --header <Name: Value>     Extra HTTP header (repeatable)
  --reject-resource <type>   Block resource type (repeatable)
  --goto-options <json>      Page load options JSON
  --wait-selector <json>     Wait for selector JSON
  --cookies <json>           Cookies JSON array
  --viewport <json>          Viewport dimensions JSON

Use: cloudflare-render.ts <command> --help for command-specific options`);
		return;
	}

	const shared = `
Shared Options:
  --html <string>            Render raw HTML instead of URL
  --output <path>            Save output to file
  --user-agent <string>      Custom User-Agent
  --auth <user:pass>         HTTP Basic authentication
  --header <Name: Value>     Extra HTTP header (repeatable)
  --reject-resource <type>   Block resource type (repeatable)
  --goto-options <json>      Page load options JSON
  --wait-selector <json>     Wait for selector JSON
  --cookies <json>           Cookies JSON array
  --viewport <json>          Viewport dimensions JSON`;

	switch (command) {
		case "screenshot":
			console.log(`screenshot - Capture page screenshot

Usage: cloudflare-render.ts screenshot <url> [options]

Output: PNG file (auto-named if no --output)

Options:
  --full-page                Capture full scrollable page
  --type <png|jpeg|webp>     Image format (default: png)
  --quality <1-100>          Quality for jpeg/webp
  --selector <css>           Screenshot specific element
  --screenshot-options <json> Advanced options (clip, omitBackground)
${shared}`);
			break;
		case "pdf":
			console.log(`pdf - Generate PDF from page

Usage: cloudflare-render.ts pdf <url> [options]

Output: PDF file (auto-named if no --output)

Options:
  --landscape                Landscape orientation
  --print-background         Include background graphics
  --pdf-format <type>        Page size: letter, a4, a3, legal, tabloid
  --scale <0.1-2.0>          Scale factor
  --pdf-options <json>       Advanced options (margin, headers, footers)
${shared}`);
			break;
		case "links":
			console.log(`links - Retrieve all links from page

Usage: cloudflare-render.ts links <url> [options]

Output: One URL per line to stdout

Options:
  --visible-only             Only visible links
  --exclude-external         Exclude external domain links
${shared}`);
			break;
		case "scrape":
			console.log(`scrape - Extract elements by CSS selector

Usage: cloudflare-render.ts scrape <url> --selector <css> [options]

Output: JSON to stdout

Options:
  --selector <css>           CSS selector (repeatable, at least one required)
${shared}`);
			break;
		case "json":
			console.log(`json - AI-powered structured data extraction

Usage: cloudflare-render.ts json <url> --prompt "..." [options]

Output: JSON to stdout

Options:
  --prompt <string>          Extraction instruction (required unless --schema)
  --schema <json-or-file>    JSON schema (inline JSON or file path)
  --model <json>             Custom AI config JSON array (BYO API key)
${shared}`);
			break;
		case "snapshot":
			console.log(`snapshot - Capture screenshot + HTML in one request

Usage: cloudflare-render.ts snapshot <url> [options]

Output: Screenshot to file, HTML to stdout

Options:
  --full-page                Capture full scrollable page
  --type <png|jpeg|webp>     Image format (default: png)
  --quality <1-100>          Quality for jpeg/webp
  --screenshot-options <json> Advanced screenshot options
${shared}`);
			break;
		default:
			console.log(`${command} - Fetch page ${command}

Usage: cloudflare-render.ts ${command} <url> [options]

Output: ${command === "content" ? "HTML" : "Markdown"} to stdout
${shared}`);
	}
}

// --- Main ---

async function main(): Promise<void> {
	const args = process.argv.slice(2);

	if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
		printHelp(
			args.length > 0 && !args[0].startsWith("-") ? args[0] : undefined,
		);
		process.exit(0);
	}

	const command = args[0] as Command;
	if (!VALID_COMMANDS.includes(command)) {
		console.error(
			`Error: Unknown command '${command}'. Valid: ${VALID_COMMANDS.join(", ")}`,
		);
		process.exit(1);
	}

	// Parse arguments
	let targetUrl = "";
	let htmlInput: string | undefined;
	let outputPath: string | null = null;
	let userAgent: string | undefined;
	let authenticate: { username: string; password: string } | undefined;
	const extraHeaders: Record<string, string> = {};
	const rejectResourceTypes: string[] = [];
	let gotoOptions: Record<string, unknown> | undefined;
	let waitForSelector: Record<string, unknown> | undefined;
	let cookies: unknown[] | undefined;
	let viewport: Record<string, unknown> | undefined;

	// Screenshot/snapshot options
	let fullPage = false;
	let imageType = "png";
	let quality: number | undefined;
	let selector: string | undefined;
	let screenshotOptions: Record<string, unknown> | undefined;

	// PDF options
	let landscape = false;
	let printBackground = false;
	let pdfFormat: string | undefined;
	let scale: number | undefined;
	let pdfOptions: Record<string, unknown> | undefined;

	// Links options
	let visibleLinksOnly = false;
	let excludeExternalLinks = false;

	// Scrape options
	const selectors: string[] = [];

	// JSON options
	let prompt: string | undefined;
	let schema: unknown | undefined;
	let customAi: unknown[] | undefined;

	for (let i = 1; i < args.length; i++) {
		const arg = args[i];

		// Shared flags
		if (arg === "--html") {
			htmlInput = requireArg(args, "--html", i);
			i++;
		} else if (arg === "--output") {
			outputPath = requireArg(args, "--output", i);
			i++;
		} else if (arg === "--user-agent") {
			userAgent = requireArg(args, "--user-agent", i);
			i++;
		} else if (arg === "--auth") {
			const authVal = requireArg(args, "--auth", i);
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
			const headerVal = requireArg(args, "--header", i);
			const colonIdx = headerVal.indexOf(":");
			if (colonIdx < 1) {
				console.error("Error: --header format is 'Name: Value'");
				process.exit(1);
			}
			extraHeaders[headerVal.slice(0, colonIdx).trim()] = headerVal
				.slice(colonIdx + 1)
				.trim();
			i++;
		} else if (arg === "--reject-resource") {
			const resType = requireArg(args, "--reject-resource", i);
			if (!VALID_RESOURCE_TYPES.includes(resType)) {
				console.error(
					`Error: --reject-resource must be one of: ${VALID_RESOURCE_TYPES.join(", ")}`,
				);
				process.exit(1);
			}
			rejectResourceTypes.push(resType);
			i++;
		} else if (arg === "--goto-options") {
			gotoOptions = requireJson(args, "--goto-options", i);
			i++;
		} else if (arg === "--wait-selector") {
			waitForSelector = requireJson(args, "--wait-selector", i);
			i++;
		} else if (arg === "--cookies") {
			cookies = requireJsonArray(args, "--cookies", i);
			i++;
		} else if (arg === "--viewport") {
			viewport = requireJson(args, "--viewport", i);
			i++;
		}
		// Screenshot/snapshot flags
		else if (arg === "--full-page") {
			fullPage = true;
		} else if (arg === "--type") {
			imageType = requireArg(args, "--type", i);
			if (!VALID_IMAGE_TYPES.includes(imageType)) {
				console.error(
					`Error: --type must be one of: ${VALID_IMAGE_TYPES.join(", ")}`,
				);
				process.exit(1);
			}
			i++;
		} else if (arg === "--quality") {
			quality = requireInt(args, "--quality", i);
			if (quality < 1 || quality > 100) {
				console.error("Error: --quality must be between 1 and 100");
				process.exit(1);
			}
			i++;
		} else if (arg === "--selector") {
			const sel = requireArg(args, "--selector", i);
			if (command === "scrape") {
				selectors.push(sel);
			} else {
				selector = sel;
			}
			i++;
		} else if (arg === "--screenshot-options") {
			screenshotOptions = requireJson(args, "--screenshot-options", i);
			i++;
		}
		// PDF flags
		else if (arg === "--landscape") {
			landscape = true;
		} else if (arg === "--print-background") {
			printBackground = true;
		} else if (arg === "--pdf-format") {
			pdfFormat = requireArg(args, "--pdf-format", i);
			if (!VALID_PDF_FORMATS.includes(pdfFormat)) {
				console.error(
					`Error: --pdf-format must be one of: ${VALID_PDF_FORMATS.join(", ")}`,
				);
				process.exit(1);
			}
			i++;
		} else if (arg === "--scale") {
			scale = requireFloat(args, "--scale", i);
			if (scale < 0.1 || scale > 2.0) {
				console.error("Error: --scale must be between 0.1 and 2.0");
				process.exit(1);
			}
			i++;
		} else if (arg === "--pdf-options") {
			pdfOptions = requireJson(args, "--pdf-options", i);
			i++;
		}
		// Links flags
		else if (arg === "--visible-only") {
			visibleLinksOnly = true;
		} else if (arg === "--exclude-external") {
			excludeExternalLinks = true;
		}
		// JSON flags
		else if (arg === "--prompt") {
			prompt = requireArg(args, "--prompt", i);
			i++;
		} else if (arg === "--schema") {
			schema = requireJsonOrFile(args, "--schema", i);
			i++;
		} else if (arg === "--model") {
			customAi = requireJsonArray(args, "--model", i);
			i++;
		}
		// Positional URL
		else if (!arg.startsWith("-")) {
			targetUrl = arg;
		} else {
			console.error(`Error: Unknown flag '${arg}' for command '${command}'`);
			process.exit(1);
		}
	}

	// Validate input
	if (!targetUrl && !htmlInput) {
		console.error("Error: URL or --html required. Use --help for usage.");
		process.exit(1);
	}

	// Validate command-specific flags aren't used with wrong command
	const screenshotCommands = ["screenshot", "snapshot"];
	const pdfCommands = ["pdf"];
	const linksCommands = ["links"];
	const jsonCommands = ["json"];
	const scrapeCommands = ["scrape"];

	if (fullPage && !screenshotCommands.includes(command)) {
		console.error(`Error: --full-page only applies to screenshot/snapshot`);
		process.exit(1);
	}
	if (
		quality !== undefined &&
		imageType === "png" &&
		screenshotCommands.includes(command)
	) {
		console.error(
			"Error: --quality only applies with --type jpeg or --type webp",
		);
		process.exit(1);
	}
	if (landscape && !pdfCommands.includes(command)) {
		console.error("Error: --landscape only applies to pdf");
		process.exit(1);
	}
	if (printBackground && !pdfCommands.includes(command)) {
		console.error("Error: --print-background only applies to pdf");
		process.exit(1);
	}
	if (pdfFormat && !pdfCommands.includes(command)) {
		console.error("Error: --pdf-format only applies to pdf");
		process.exit(1);
	}
	if (scale !== undefined && !pdfCommands.includes(command)) {
		console.error("Error: --scale only applies to pdf");
		process.exit(1);
	}
	if (pdfOptions && !pdfCommands.includes(command)) {
		console.error("Error: --pdf-options only applies to pdf");
		process.exit(1);
	}
	if (visibleLinksOnly && !linksCommands.includes(command)) {
		console.error("Error: --visible-only only applies to links");
		process.exit(1);
	}
	if (excludeExternalLinks && !linksCommands.includes(command)) {
		console.error("Error: --exclude-external only applies to links");
		process.exit(1);
	}
	if (prompt && !jsonCommands.includes(command)) {
		console.error("Error: --prompt only applies to json");
		process.exit(1);
	}
	if (schema && !jsonCommands.includes(command)) {
		console.error("Error: --schema only applies to json");
		process.exit(1);
	}
	if (customAi && !jsonCommands.includes(command)) {
		console.error("Error: --model only applies to json");
		process.exit(1);
	}
	if (
		selector &&
		command !== "screenshot" &&
		!scrapeCommands.includes(command)
	) {
		console.error("Error: --selector only applies to screenshot and scrape");
		process.exit(1);
	}
	if (screenshotOptions && !screenshotCommands.includes(command)) {
		console.error(
			"Error: --screenshot-options only applies to screenshot/snapshot",
		);
		process.exit(1);
	}

	const validatedUrl = targetUrl ? validateUrl(targetUrl) : undefined;

	const { token, accountId } = loadCredentials();

	// Build request body
	const body: Record<string, unknown> = {};
	if (validatedUrl) body.url = validatedUrl;
	if (htmlInput) body.html = htmlInput;
	if (userAgent) body.userAgent = userAgent;
	if (authenticate) body.authenticate = authenticate;
	if (Object.keys(extraHeaders).length) body.setExtraHTTPHeaders = extraHeaders;
	if (rejectResourceTypes.length)
		body.rejectResourceTypes = rejectResourceTypes;
	if (gotoOptions) body.gotoOptions = gotoOptions;
	if (waitForSelector) body.waitForSelector = waitForSelector;
	if (cookies) body.cookies = cookies;
	if (viewport) body.viewport = viewport;

	// Command-specific body fields
	const domain = validatedUrl ? getDomain(validatedUrl) : "page";

	// Build screenshot options shared by screenshot and snapshot commands
	function buildScreenshotOptions(): Record<string, unknown> {
		const opts: Record<string, unknown> = { ...screenshotOptions };
		if (fullPage) opts.fullPage = true;
		if (imageType !== "png") opts.type = imageType;
		if (quality !== undefined) opts.quality = quality;
		return opts;
	}

	switch (command) {
		case "screenshot": {
			const ssOpts = buildScreenshotOptions();
			if (Object.keys(ssOpts).length) body.screenshotOptions = ssOpts;
			if (selector) body.selector = selector;
			break;
		}
		case "pdf": {
			const pOpts: Record<string, unknown> = { ...pdfOptions };
			if (landscape) pOpts.landscape = true;
			if (printBackground) pOpts.printBackground = true;
			if (pdfFormat) pOpts.format = pdfFormat;
			if (scale !== undefined) pOpts.scale = scale;
			if (Object.keys(pOpts).length) body.pdfOptions = pOpts;
			break;
		}
		case "links":
			if (visibleLinksOnly) body.visibleLinksOnly = true;
			if (excludeExternalLinks) body.excludeExternalLinks = true;
			break;
		case "scrape":
			if (selectors.length === 0) {
				console.error("Error: scrape requires at least one --selector <css>");
				process.exit(1);
			}
			body.elements = selectors.map((s) => ({ selector: s }));
			break;
		case "json":
			if (!prompt && !schema) {
				console.error("Error: json requires --prompt and/or --schema");
				process.exit(1);
			}
			if (prompt) body.prompt = prompt;
			if (schema) body.response_format = { type: "json_schema", schema };
			if (customAi) body.custom_ai = customAi;
			break;
		case "snapshot": {
			const snapOpts = buildScreenshotOptions();
			if (Object.keys(snapOpts).length) body.screenshotOptions = snapOpts;
			break;
		}
	}

	console.error(`${command}: ${validatedUrl || "(HTML input)"}...`);

	try {
		const response = await callEndpoint(token, accountId, command, body);

		switch (command) {
			case "content":
			case "markdown":
				await handleTextEndpoint(response, outputPath);
				break;
			case "links":
				await handleLinksEndpoint(response, outputPath);
				break;
			case "scrape":
			case "json":
				await handleJsonEndpoint(response, outputPath);
				break;
			case "screenshot":
				await handleBinaryEndpoint(
					response,
					outputPath,
					autoFilename("screenshot", domain, imageType),
				);
				break;
			case "pdf":
				await handleBinaryEndpoint(
					response,
					outputPath,
					autoFilename("page", domain, "pdf"),
				);
				break;
			case "snapshot":
				await handleSnapshotEndpoint(
					response,
					outputPath,
					autoFilename("snapshot", domain, imageType),
				);
				break;
		}
	} catch (error) {
		console.error(`Error: ${error instanceof Error ? error.message : error}`);
		process.exit(1);
	}
}

main();
