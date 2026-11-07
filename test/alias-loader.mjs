import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const basePath = path.join(projectRoot, "src", specifier.slice(2));
    const candidatePaths = [
      basePath,
      `${basePath}.js`,
      `${basePath}.mjs`,
      `${basePath}.ts`,
      path.join(basePath, "index.js"),
    ];
    const resolvedPath = candidatePaths.find((candidate) =>
      fs.existsSync(candidate),
    );

    if (resolvedPath) {
      return nextResolve(pathToFileURL(resolvedPath).href, context);
    }
  }

  return nextResolve(specifier, context);
}
