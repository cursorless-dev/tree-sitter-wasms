import { PromisePool } from "@supercharge/promise-pool";
import findRoot from "find-root";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import util from "node:util";
import packageInfo from "./package.json";

const exec = util.promisify(require("child_process").exec);
const langArg = process.argv[2];
const outDir = path.join(__dirname, "out");
let hasErrors = false;

async function buildParserWASM(
  name: string,
  { subPath, generate }: { subPath?: string; generate?: boolean } = {}
) {
  const label = subPath ? path.join(name, subPath) : name;

  let cliPackagePath;
  try {
    cliPackagePath = findRoot(require.resolve("tree-sitter-cli"));
  } catch (_) {
    cliPackagePath = path.join(__dirname, "node_modules", "tree-sitter-cli");
  }

  const cliPath = path.join(cliPackagePath, "tree-sitter");
  const generateCommand = cliPath.concat(" generate");
  const buildCommand = cliPath.concat(" build --wasm");

  console.log(`⏳ Building ${label}`);

  let packagePath;
  try {
    packagePath = findRoot(require.resolve(name));
  } catch (_) {
    packagePath = path.join(__dirname, "node_modules", name);
  }

  const cwd = subPath ? path.join(packagePath, subPath) : packagePath;

  if (!fs.existsSync(cwd)) {
    console.error(`🔥 Failed to find cwd: ${cwd}`);
    hasErrors = true;
    return;
  }

  if (generate) {
    try {
      await exec(generateCommand, { cwd });
    } catch (e) {
      console.error(`🔥 Failed to generate ${label}:\n`, e);
      hasErrors = true;
      return;
    }
  }

  try {
    await exec(buildCommand, { cwd });
    await exec(`mv *.wasm ${outDir}`, { cwd });
    console.log(`✅ Finished building ${label}`);
  } catch (e) {
    console.error(`🔥 Failed to build ${label}:\n`, e);
    hasErrors = true;
  }
}

function buildParserWASMS() {
  const grammars = Object.keys(packageInfo.devDependencies)
    .filter(
      (n) =>
        (n.startsWith("tree-sitter-") ||
          n === "@elm-tooling/tree-sitter-elm") &&
        n !== "tree-sitter-cli" &&
        n !== "tree-sitter"
    )
    .filter((s) => !langArg || s.includes(langArg));

  return PromisePool.withConcurrency(os.cpus().length)
    .for(grammars)
    .process(async (name: string) => {
      switch (name) {
        case "tree-sitter-php":
          await buildParserWASM(name, { subPath: "php" });
          break;
        case "tree-sitter-typescript":
          await buildParserWASM(name, { subPath: "typescript" });
          await buildParserWASM(name, { subPath: "tsx" });
          break;
        case "tree-sitter-xml":
          await buildParserWASM(name, { subPath: "xml" });
          await buildParserWASM(name, { subPath: "dtd" });
          break;
        case "tree-sitter-markdown":
          await buildParserWASM(name, {
            subPath: "tree-sitter-markdown",
          });
          await buildParserWASM(name, {
            subPath: "tree-sitter-markdown-inline",
          });
          break;
        case "tree-sitter-perl":
        case "tree-sitter-latex":
        case "tree-sitter-swift":
        case "tree-sitter-elixir":
          await buildParserWASM(name, { generate: true });
          break;
        default:
          await buildParserWASM(name);
      }
    });
}

fs.mkdirSync(outDir);
process.chdir(outDir);

buildParserWASMS().then(() => {
  if (hasErrors) {
    process.exit(1);
  }
});
