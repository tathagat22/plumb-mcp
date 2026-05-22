/**
 * Live check for plumb_outline's data path: fetch a file's shallow structure
 * and print the pages → frames map. Reads .env (FIGMA_TOKEN, PLUMB_FILE_KEY).
 */
import { join } from "node:path";
import { fetchFileOutline } from "../src/figma/rest";
import { buildOutline } from "../src/normalize/outline";
import { loadDotEnv } from "./_dotenv";

loadDotEnv(join(process.cwd(), ".env"));

const token = process.env.FIGMA_TOKEN;
const fileKey = process.env.PLUMB_FILE_KEY;

if (!token || !fileKey) {
  console.error("Set FIGMA_TOKEN and PLUMB_FILE_KEY (e.g. in .env) to run this check.");
  process.exit(1);
}

console.log(`Fetching outline for file ${fileKey} …`);
const file = await fetchFileOutline(fileKey, token);
const outline = buildOutline(file.document, {
  key: fileKey,
  name: file.fileName,
  version: file.version,
});

console.log(JSON.stringify(outline, null, 2));
console.log(
  `\n✓ ${outline.meta.pageCount} page(s), ${outline.meta.frameCount} frame(s), ` +
    `~${outline.meta.estTokens} tokens`,
);
