import type { IncomingMessage, ServerResponse } from "node:http";
import { handleRequest } from "./app";
import { MemoryCache } from "./cache";

/** One cache per function instance; Vercel reuses instances between requests. */
const cache = new MemoryCache();

/** Node (req, res) adapter around the Web handler, used by Vercel and the local dev server. */
export async function nodeHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() || "http";
  const host = (req.headers["x-forwarded-host"] as string | undefined) || req.headers.host || "localhost";
  const url = new URL(req.url ?? "/", `${proto}://${host}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else if (value !== undefined) headers.set(key, value);
  }

  let response: Response;
  try {
    response = await handleRequest(
      new Request(url, { method: req.method ?? "GET", headers }),
      {
        ANILIST_USER: process.env.ANILIST_USER,
        ENABLE_SPLIT_FILTERS: process.env.ENABLE_SPLIT_FILTERS,
        MAPPING_URL: process.env.MAPPING_URL,
      },
      { cache },
    );
  } catch (err) {
    console.error("unhandled", err);
    response = new Response(JSON.stringify({ error: "internal error" }), { status: 500 });
  }

  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (req.method === "HEAD" || response.body === null) {
    res.end();
    return;
  }
  res.end(Buffer.from(await response.arrayBuffer()));
}
