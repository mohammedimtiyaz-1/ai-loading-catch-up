import { cpSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const dist = join(root, "dist");
const unpacked = join(dist, "ai-chat-keyword-explainer-unpacked");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(root, "extension"), unpacked, { recursive: true });
execFileSync("zip", ["-qr", join(dist, "ai-chat-keyword-explainer-chrome.zip"), "ai-chat-keyword-explainer-unpacked"], { cwd: dist });
console.log(`Packaged ${unpacked}`);
