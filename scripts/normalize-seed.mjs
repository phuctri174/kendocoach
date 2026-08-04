/**
 * The bundler imports the seed JSON files as modules and rejects a UTF-8 BOM
 * with "Unable to make a module from invalid JSON", which takes the whole app
 * down. Some editors add one on save, so strip it before dev/build.
 *
 * A BOM carries no content, so removing it cannot change the data. Anything
 * else wrong with a file is reported, not silently altered.
 */
import { readFileSync, writeFileSync } from "node:fs";

function checkSeedFile(relativePath, label, validate) {
  const path = new URL(relativePath, import.meta.url);
  const bytes = readFileSync(path);

  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    writeFileSync(path, bytes.subarray(3));
    console.log(`[seed] stripped a UTF-8 BOM from ${label}`);
  }

  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    validate(data);
  } catch (error) {
    console.error(`[seed] ${label} is not valid: ${error.message}`);
    process.exit(1);
  }
}

checkSeedFile("../players.seed.json", "players.seed.json", (players) => {
  if (!Array.isArray(players)) throw new Error("expected an array of players");
  console.log(`[seed] players.seed.json OK — ${players.length} players`);
});

checkSeedFile("../augments_catalog.json", "augments_catalog.json", (augments) => {
  if (!Array.isArray(augments)) throw new Error("expected an array of augments");
  console.log(`[seed] augments_catalog.json OK — ${augments.length} augments`);
});

checkSeedFile("../items_catalog.json", "items_catalog.json", (items) => {
  if (!Array.isArray(items)) throw new Error("expected an array of items");
  console.log(`[seed] items_catalog.json OK — ${items.length} items`);
});

checkSeedFile("../passives_catalog.json", "passives_catalog.json", (catalog) => {
  if (!Array.isArray(catalog?.passives)) throw new Error("expected a `passives` array");
  console.log(`[seed] passives_catalog.json OK — ${catalog.passives.length} passive entries`);
});
