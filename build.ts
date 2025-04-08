import fs from "fs";
import os from "os";
import path from "path";
import util from "util";

import { PromisePool } from "@supercharge/promise-pool";
const findRoot = require("find-root");

import packageInfo from "./package.json";

const langArg = process.argv[2];

const exec = util.promisify(require("child_process").exec);

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

  let cliPath = path.join(cliPackagePath, "tree-sitter");
  let generateCommand = cliPath.concat(" generate");
  let buildCommand = cliPath.concat(" build --wasm");

  try {
    console.log(`⏳ Building ${label}`);
    let packagePath;
    try {
      packagePath = findRoot(require.resolve(name));
    } catch (_) {
      packagePath = path.join(__dirname, "node_modules", name);
    }
    const cwd = subPath ? path.join(packagePath, subPath) : packagePath;
    if (generate) {
      await exec(generateCommand, { cwd });
    }
    await exec(buildCommand, { cwd });
    await exec(`mv *.wasm ${outDir}`, { cwd });
    console.log(`✅ Finished building ${label}`);
  } catch (e) {
    console.error(`🔥 Failed to build ${label}:\n`, e);
    hasErrors = true;
  }
}

if (fs.existsSync(outDir)) {
  fs.rmSync(outDir, { recursive: true, force: true });
}

fs.mkdirSync(outDir);

process.chdir(outDir);

const grammars = Object.keys(packageInfo.devDependencies)
  .filter(
    (n) =>
      n.startsWith("tree-sitter-") &&
      n !== "tree-sitter-cli" &&
      n !== "tree-sitter"
  )
  .filter((s) => !langArg || s.includes(langArg));

PromisePool.withConcurrency(os.cpus().length)
  .for(grammars)
  .process(async (name: string) => {
    if (name == "tree-sitter-agda") {
      await buildParserWASM(name);
    } else if (name == "tree-sitter-perl") {
      await buildParserWASM(name, { generate: true });
    } else if (name == "tree-sitter-php") {
      await buildParserWASM(name, { subPath: "php" });
    } else if (name == "tree-sitter-typescript") {
      await buildParserWASM(name, { subPath: "typescript" });
      await buildParserWASM(name, { subPath: "tsx" });
    } else if (name == "tree-sitter-latex") {
      await buildParserWASM(name, { generate: true });
    } else if (name == "tree-sitter-xml") {
      await buildParserWASM(name, { subPath: "xml" });
      await buildParserWASM(name, { subPath: "dtd" });
    } else if (name == "tree-sitter-query") {
      await buildParserWASM(name);
    } else if (name == "tree-sitter-elixir") {
      await buildParserWASM(name);
    } else if (name == "tree-sitter-markdown") {
      await buildParserWASM(name, { subPath: "tree-sitter-markdown" });
      await buildParserWASM(name, { subPath: "tree-sitter-markdown-inline" });
    } else if (name === "tree-sitter-swift") {
      await buildParserWASM(name, { generate: true });
    } else {
      await buildParserWASM(name);
    }
  })
  .then(async () => {
    if (hasErrors) {
      //not sure if this failsafe is actually required, but it doesn't hurt to ensure that no wasms can be published from a failed build
      fs.rmSync(outDir, { recursive: true, force: true });
      fs.mkdirSync(outDir);
      process.exit(1);
    }
  });
