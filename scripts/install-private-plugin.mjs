import { copyFile, mkdir, readFile, stat, writeFile } from "fs/promises";
import { resolve } from "path";

const vaultArg = process.argv[2];
if (!vaultArg) {
  throw new Error('Pass the vault path, for example: npm run install:private-plugin -- "/Users/me/Documents/Vault"');
}

const root = resolve(import.meta.dirname, "..");
const vault = resolve(vaultArg);
const pluginDir = resolve(vault, ".obsidian", "plugins", "contextual-ai-reader");

try {
  const info = await stat(vault);
  if (!info.isDirectory()) throw new Error("not a directory");
} catch {
  throw new Error(`Vault does not exist: ${vault}`);
}

await mkdir(pluginDir, { recursive: true });
await Promise.all([
  copyFile(resolve(root, "main.js"), resolve(pluginDir, "main.js")),
  copyFile(resolve(root, "manifest.json"), resolve(pluginDir, "manifest.json")),
  copyFile(resolve(root, "styles.css"), resolve(pluginDir, "styles.css"))
]);

const dataPath = resolve(pluginDir, "data.json");
let settings = {};
try {
  settings = JSON.parse(await readFile(dataPath, "utf8"));
  const backupPath = resolve(pluginDir, "data.json.backup-before-shared-memory");
  try {
    await stat(backupPath);
  } catch {
    await copyFile(dataPath, backupPath);
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
settings.sharedMemoryEnabled = true;
await writeFile(dataPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });

console.log(`Installed the private shared-memory build into ${pluginDir}`);
console.log("Enabled private shared translation memory; existing plugin settings were preserved.");
