import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { DefinitionCache } from "./cache.js";
import { resolveRequest, validateRequest } from "./resolve.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const simulator = join(root, "simulator");
const port = Number(process.env.THREE_KEYWORDS_PORT || 4311);
const monthlyLimit = Math.min(900, Math.max(0, Number(process.env.THREE_KEYWORDS_MONTHLY_LIMIT || 900)));
const cache = new DefinitionCache(join(root, "data", "definitions.sqlite"));
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

const server = createServer(async (request, response) => {
  setHeaders(response);
  if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
  if (request.method === "GET" && request.url === "/health") return json(response, 200, { ok: true, onlineConfigured: Boolean(process.env.TAVILY_API_KEY), attemptsThisMonth: cache.attempts() });
  if (request.method === "POST" && request.url === "/v1/definitions/resolve") {
    try {
      const body = await readJson(request);
      if (!validateRequest(body)) return json(response, 400, { error: "invalid_request" });
      const result = await resolveRequest(body, { cache, apiKey: process.env.TAVILY_API_KEY, monthlyLimit });
      return json(response, 200, result);
    } catch (error) {
      return json(response, error?.code === "PAYLOAD_TOO_LARGE" ? 413 : 400, { error: error?.code || "invalid_json" });
    }
  }
  if (request.method === "GET") return staticFile(request.url, response);
  json(response, 404, { error: "not_found" });
});

server.listen(port, "127.0.0.1", () => console.log(`AI Loading Catch Up simulator: http://127.0.0.1:${port}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { server.close(); cache.close(); });

function setHeaders(response) {
  response.setHeader("access-control-allow-origin", "http://127.0.0.1:4311");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("content-security-policy", "default-src 'self'; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'");
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) { const error = new Error(); error.code = "PAYLOAD_TOO_LARGE"; throw error; }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function staticFile(rawUrl, response) {
  const pathname = new URL(rawUrl, "http://127.0.0.1").pathname;
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const file = normalize(join(simulator, relative));
  if (!file.startsWith(`${simulator}/`) || !existsSync(file)) return json(response, 404, { error: "not_found" });
  response.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
  createReadStream(file).pipe(response);
}
