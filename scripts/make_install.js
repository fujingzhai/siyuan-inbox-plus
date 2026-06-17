import { cpSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const plugin = "siyuan-inbox-plus";;
const dataDir = process.env.SIYUAN_DATA_DIR || resolve(homedir(), "siyuan/data");
const dist = resolve(root, "dist");
const target = resolve(dataDir, "plugins", plugin);
const backupRoot = resolve(homedir(), "AI-Space/.tmp/siyuan-inbox-plus-install-backups");

if (!existsSync(dist)) {
  throw new Error("dist 不存在，请先运行 pnpm build");
}

mkdirSync(backupRoot, { recursive: true });
mkdirSync(resolve(target, ".."), { recursive: true });

if (existsSync(target)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  renameSync(target, resolve(backupRoot, `${plugin}-${stamp}`));
}

cpSync(dist, target, { recursive: true });
console.log(`已安装 ${plugin} 到 ${target}`);
