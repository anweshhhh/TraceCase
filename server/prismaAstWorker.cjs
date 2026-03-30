/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");

const prismaAst = require(
  path.join(
    __dirname,
    "..",
    "node_modules",
    "@mrleebo",
    "prisma-ast",
    "dist",
    "prisma-ast.cjs.production.min.js",
  ),
);

try {
  const input = fs.readFileSync(0, "utf8");
  const schema = prismaAst.getSchema(input);

  process.stdout.write(JSON.stringify(schema));
} catch (error) {
  const message =
    error instanceof Error ? error.message : "Invalid Prisma schema.";

  process.stderr.write(message);
  process.exitCode = 1;
}
