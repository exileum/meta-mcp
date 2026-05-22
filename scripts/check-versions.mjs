#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

const [pkg, server] = await Promise.all([
  readFile(join(ROOT, "package.json"), "utf8").then(JSON.parse),
  readFile(join(ROOT, "server.json"), "utf8").then(JSON.parse),
]);

const pkgVersion = pkg.version;
const serverRootVersion = server.version;
const serverPackageVersion = server.packages?.[0]?.version;

if (pkgVersion !== serverRootVersion || pkgVersion !== serverPackageVersion) {
  console.error(
    `Version mismatch: package.json=${pkgVersion} server.json(root)=${serverRootVersion} server.json(packages[0])=${serverPackageVersion}`,
  );
  process.exit(1);
}
