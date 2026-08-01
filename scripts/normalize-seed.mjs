/**
 * The bundler imports players.seed.json as a module and rejects a UTF-8 BOM
 * with "Unable to make a module from invalid JSON", which takes the whole app
 * down. Some editors add one on save, so strip it before dev/build.
 *
 * A BOM carries no content, so removing it cannot change the roster. Anything
 * else wrong with the file is reported, not silently altered.
 */
import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("../players.seed.json", import.meta.url);
const bytes = readFileSync(path);

if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
  writeFileSync(path, bytes.subarray(3));
  console.log("[seed] stripped a UTF-8 BOM from players.seed.json");
}

try {
  const players = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(players)) throw new Error("expected an array of players");
  console.log(`[seed] players.seed.json OK — ${players.length} players`);
} catch (error) {
  console.error(`[seed] players.seed.json is not valid JSON: ${error.message}`);
  process.exit(1);
}
