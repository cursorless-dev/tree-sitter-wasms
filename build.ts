import { PromisePool } from "@supercharge/promise-pool";
import findRoot from "find-root";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import util from "node:util";
import packageInfo from "./package.json";

type ParserName = keyof typeof packageInfo.devDependencies;

const exec = util.promisify(require("child_process").exec);
const outDir = path.join(__dirname, "out");
let hasErrors = false;

function getPackagePath(name: string) {
  try {
    return findRoot(require.resolve(name));
  } catch (_) {
    return path.join(__dirname, "node_modules", name);
  }
}

async function gitCloneOverload(name: ParserName) {
  const packagePath = getPackagePath(name);
  const value = packageInfo.devDependencies[name];
  const match = value.match(/^github:(.+)#(.+)$/);

  if (match == null || match.length < 3) {
    console.error(`❗ Failed to parse git repo for ${name}:\n`, value);
    hasErrors = true;
    return;
  }

  const repoUrl = `https://github.com/${match[1]}.git`;
  const commitHash = match[2];

  try {
    console.log(`🗑️  Deleting cached node dep for ${name}`);
    await exec(`rm -rf ${packagePath}`);
    console.log(`⬇️  Cloning ${name} from git (${commitHash})`);
    await exec(`git clone ${repoUrl} ${packagePath}`);
  } catch (e) {
    console.error(`❗Failed to clone git repo for ${name}:\n`, e);
    hasErrors = true;
  }
}

async function buildParserWASM(
  name: ParserName,
  { subPath, generate }: { subPath?: string; generate?: boolean } = {}
) {
  const label = subPath ? path.join(name, subPath) : name;

  const cliPackagePath = getPackagePath("tree-sitter-cli");
  const packagePath = getPackagePath(name);
  const cliPath = path.join(cliPackagePath, "tree-sitter");
  const generateCommand = cliPath.concat(" generate");
  const buildCommand = cliPath.concat(" build --wasm");

  console.log(`⏳ Building ${label}`);

  const cwd = subPath ? path.join(packagePath, subPath) : packagePath;

  if (!fs.existsSync(cwd)) {
    console.error(`❗ Failed to find cwd ${label}:\n`, cwd);
    hasErrors = true;
    return;
  }

  if (generate) {
    try {
      await exec(generateCommand, { cwd });
    } catch (e) {
      console.error(`❗ Failed to generate ${label}:\n`, e);
      hasErrors = true;
      return;
    }
  }

  try {
    await exec(buildCommand, { cwd });
    await exec(`mv *.wasm ${outDir}`, { cwd });
    console.log(`✅ Finished building ${label}`);
  } catch (e) {
    console.error(`❗ Failed to build ${label}:\n`, e);
    hasErrors = true;
  }
}

function buildParserWASMS() {
  const grammars = Object.keys(packageInfo.devDependencies).filter(
    (n) =>
      (n.startsWith("tree-sitter-") &&
        n !== "tree-sitter-cli" &&
        n !== "tree-sitter") ||
      n === "@elm-tooling/tree-sitter-elm"
  ) as ParserName[];

  return PromisePool.withConcurrency(os.cpus().length)
    .for(grammars)
    .process(async (name: ParserName) => {
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
          await gitCloneOverload(name);
          await buildParserWASM(name, {
            subPath: "tree-sitter-markdown",
          });
          await buildParserWASM(name, {
            subPath: "tree-sitter-markdown-inline",
          });
          break;

        case "tree-sitter-elixir":
        case "tree-sitter-perl":
        case "tree-sitter-query":
          await gitCloneOverload(name);
          await buildParserWASM(name, { generate: true });
          break;

        case "tree-sitter-latex":
        case "tree-sitter-swift":
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
