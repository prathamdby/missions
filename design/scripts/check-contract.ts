import { globSync, readFileSync } from "node:fs";
import path from "node:path";

import { checkCss } from "../contract/css.ts";
import { loadManifest, ROOT, TOKENS_CSS_PATH } from "../manifest.ts";

const AUTHORED_CSS = ["apps/web/src/**/*.css"];

const main = () => {
  const manifest = loadManifest();
  const files = globSync(AUTHORED_CSS, { cwd: ROOT })
    .map((file) => path.join(ROOT, file))
    .filter((file) => file !== TOKENS_CSS_PATH)
    .toSorted();

  let count = 0;
  for (const file of files) {
    const relative = path.relative(ROOT, file);
    for (const v of checkCss(readFileSync(file, "utf-8"), manifest, file)) {
      count += 1;
      process.stderr.write(
        `${relative}:${v.line}:${v.column} ${v.rule} ${v.message}\n`
      );
    }
  }

  if (count > 0) {
    process.stderr.write(`\n${count} design contract violation(s).\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `Design contract: ${files.length} authored stylesheet(s) clean.\n`
  );
};

main();
