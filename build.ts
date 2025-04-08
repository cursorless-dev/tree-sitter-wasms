import { PromisePool } from "@supercharge/promise-pool";
import findRoot from "find-root";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import util from "node:util";
import packageInfo from "./package.json";

class ParserError {
  constructor(public message: string, public value: any) {}
}

type ParserName = keyof typeof packageInfo.devDependencies;
const exec = util.promisify(require("child_process").exec);
const outDir = path.join(__dirname, "out");

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
  const match = value.match(/^github:(\S+)#(\S+)$/);

  if (match == null) {
    throw new ParserError(`❗ Failed to parse git repo for ${name}`, value);
  }

  try {
    const repoUrl = `https://github.com/${match[1]}.git`;
    const commitHash = match[2];

    console.log(`🗑️  Deleting cached node dependency for ${name}`);
    await exec(`rm -rf ${packagePath}`);
    console.log(`⬇️  Cloning ${name} from git`);
    await exec(`git clone ${repoUrl} ${packagePath}`);
    process.chdir(packagePath);
    await exec(`git reset --hard ${commitHash}`);
  } catch (e) {
    throw new ParserError(`❗Failed to clone git repo for ${name}`, e);
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
    throw new ParserError(`❗ Failed to find cwd ${label}`, cwd);
  }

  if (generate) {
    try {
      await exec(generateCommand, { cwd });
    } catch (e) {
      throw new ParserError(`❗ Failed to generate ${label}`, e);
    }
  }

  try {
    await exec(buildCommand, { cwd });
    await exec(`mv *.wasm ${outDir}`, { cwd });
    console.log(`✅ Finished building ${label}`);
  } catch (e) {
    throw new ParserError(`❗ Failed to build ${label}`, e);
  }
}

async function processParser(name: ParserName) {
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
}

async function run() {
  const grammars = Object.keys(packageInfo.devDependencies).filter(
    (n) =>
      (n.startsWith("tree-sitter-") &&
        n !== "tree-sitter-cli" &&
        n !== "tree-sitter") ||
      n === "@elm-tooling/tree-sitter-elm"
  ) as ParserName[];

  let hasErrors = false;

  await PromisePool.withConcurrency(os.cpus().length)
    .for(grammars)
    .process(async (name: ParserName) => {
      try {
        await processParser(name);
      } catch (e) {
        if (e instanceof ParserError) {
          console.error(e.message + ":\n", e.value);
        } else {
          console.error(e);
        }
        hasErrors = true;
      }
    });

  if (hasErrors) {
    throw new Error();
  }
}

fs.mkdirSync(outDir);
process.chdir(outDir);

run().catch(() => {
  process.exit(1);
});
