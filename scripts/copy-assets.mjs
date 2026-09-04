import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const appRoot = join(root, "..");
const out = join(appRoot, "dist");

mkdirSync(out, { recursive: true });
for (const file of ["index.html", "renderer.js", "styles.css"]) {
  copyFileSync(join(appRoot, "src", file), join(out, file));
}
copyFileSync(join(appRoot, "build", "icon.svg"), join(out, "icon.svg"));
