import { cp, mkdir, stat } from "fs/promises";
import { resolve } from "path";

const vaultArg = process.argv[2];
if (!vaultArg) {
  throw new Error('Pass the test vault path, for example: npm run install:dev-plugin -- "/Users/me/Documents/Test Vault"');
}

const root = resolve(import.meta.dirname, "..");
const vault = resolve(vaultArg);
const source = resolve(root, "dist-dev", "contextual-ai-reader-dev");
const obsidianDir = resolve(vault, ".obsidian");

try {
  const info = await stat(vault);
  if (!info.isDirectory()) throw new Error("not a directory");
} catch {
  throw new Error(`Test vault does not exist: ${vault}`);
}

await mkdir(resolve(obsidianDir, "plugins"), { recursive: true });
await cp(source, resolve(obsidianDir, "plugins", "contextual-ai-reader-dev"), {
  force: true,
  recursive: true
});

console.log(`Installed Contextual AI Reader Dev into ${vault}`);
