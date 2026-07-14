import { cp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { resolve } from "path";

const root = resolve(import.meta.dirname, "..");
const outputDir = resolve(root, "dist-dev", "contextual-ai-reader-dev");
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await Promise.all([
  cp(resolve(root, "main.js"), resolve(outputDir, "main.js")),
  cp(resolve(root, "styles.css"), resolve(outputDir, "styles.css")),
  writeFile(resolve(outputDir, "manifest.json"), `${JSON.stringify({
    ...manifest,
    id: "contextual-ai-reader-dev",
    name: "Contextual AI Reader Dev",
    description: `${manifest.description} Local development build.`
  }, null, 2)}\n`)
]);

console.log(`Development plugin created at ${outputDir}`);
