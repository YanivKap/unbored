/** Zero-dependency static server for local preview: node scripts/serve.ts [port] */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, normalize, join } from "node:path";

const PORT = Number(process.argv[2] ?? process.env.PORT ?? 4173);
const ROOT = new URL("../public/", import.meta.url).pathname;
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png",
  ".svg": "image/svg+xml", ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

createServer(async (req, res) => {
  const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const rel = normalize(path === "/" ? "/index.html" : path).replace(/^(\.\.[/\\])+/, "");
  try {
    const body = await readFile(join(ROOT, rel));
    res.writeHead(200, {
      "content-type": TYPES[extname(rel)] ?? "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  }
}).listen(PORT, () => console.log(`unbored preview: http://localhost:${PORT}`));
