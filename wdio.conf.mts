import * as path from "path";
import { env } from "process";
import { parseObsidianVersions } from "wdio-obsidian-service";

const cacheDir = path.resolve(".obsidian-cache");
const desktopVersions = await parseObsidianVersions(env.OBSIDIAN_VERSIONS ?? "latest/latest", { cacheDir });

if (env.CI) {
  console.log("obsidian-cache-key:", JSON.stringify(desktopVersions));
}

export const config: WebdriverIO.Config = {
  runner: "local",
  framework: "mocha",
  specs: ["./test/specs/**/*.e2e.ts"],
  maxInstances: Number(env.WDIO_MAX_INSTANCES || 1),
  capabilities: desktopVersions.map(([appVersion, installerVersion]) => ({
    browserName: "obsidian",
    "wdio:obsidianOptions": {
      appVersion,
      installerVersion,
      plugins: ["."],
      vault: "test/vaults/basic"
    }
  })),
  services: ["obsidian"],
  reporters: ["obsidian"],
  mochaOpts: {
    ui: "bdd",
    timeout: 90 * 1000
  },
  waitforInterval: 250,
  waitforTimeout: 10 * 1000,
  logLevel: "warn",
  cacheDir
};
