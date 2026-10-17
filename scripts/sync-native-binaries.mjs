import { resolve } from "node:path";
import { installSnapshot } from "./native-helper-contract.mjs";

const [snapshot, ...extra] = process.argv.slice(2);
if (!snapshot || extra.length) throw new Error("Usage: npm run sync:bundled-helper -- <verified helper snapshot directory>");
installSnapshot(resolve(snapshot));
console.log("Imported the verified native helper snapshot. Run npm test before committing it.");
