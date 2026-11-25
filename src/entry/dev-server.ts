// Local dev server: npm run dev
import { createServer } from "node:http";
import { nodeHandler } from "../node";

const port = Number(process.env.PORT ?? 8787);
createServer((req, res) => void nodeHandler(req, res)).listen(port, "127.0.0.1", () => {
  console.log(`AniList addon: http://127.0.0.1:${port}/manifest.json`);
});
