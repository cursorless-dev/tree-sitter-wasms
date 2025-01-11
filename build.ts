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
  } catch(_) {
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

/*
TODO:
- fix agda (clones incorrectly, missing tree-sitter.json)
- fix markdown (multiple grammars)
- fix ocaml (contains multiple grammars... this project should probably support all of them)
- fix perl (outright missing its parser c file?)
- fix vue (might need a custom fork for this?)
- fix xml (differing path)
- fix latex (ENOINT spawn /bin/sh??? missing folder, presumably?)
- fix query (clones incorrectly, missing tree-sitter.json)
- fix solidity (clones incorrectly, missing tree-sitter.json)
- fix elixir (special case, see project README)
- fix systemrdl (clones incorrectly, missing tree-sitter.json)
- fix tlapus (clones incorrectly, missing tree-sitter.json)
*/
const grammars = Object.keys(packageInfo.devDependencies)
  .filter((n) => n.startsWith("tree-sitter-") && n !== "tree-sitter-cli" && n !== "tree-sitter")
  .concat('@tree-sitter-grammars/tree-sitter-zig')
  .concat("@tlaplus/tree-sitter-tlaplus")
  .filter((s) => !langArg || s.includes(langArg));

PromisePool.withConcurrency(os.cpus().length)
  .for(grammars)
  .process(async (name : string) => {
    if (name == "tree-sitter-rescript") {
      await buildParserWASM(name, { generate: true });
    } else if (name == "tree-sitter-ocaml") {
      await buildParserWASM(name, { subPath: "ocaml" });
    } else if (name == "tree-sitter-php") {
      await buildParserWASM(name, { subPath: "php" });
    } else if (name == "tree-sitter-typescript") {
      await buildParserWASM(name, { subPath: "typescript" });
      await buildParserWASM(name, { subPath: "tsx" });
    } else {
      await buildParserWASM(name);
    }
  })
  .then(async () => {
    if (hasErrors) {
      process.exit(1);
    }
    await exec(`mv *.wasm ${outDir}`, { cwd: __dirname });
  });
