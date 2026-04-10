import { exec as execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exit } from "node:process";
import { fileURLToPath } from "node:url";
import util from "node:util";
import { PromisePool } from "@supercharge/promise-pool";
import findRoot from "find-root";
import packageInfo from "./package.json" with { type: "json" };

class ParserError extends Error {
  constructor(
    public message: string,
    public value: unknown,
  ) {
    super(message);
    this.name = "ParserError";
  }
}

const __dirname = import.meta.dirname;
const dependencies = packageInfo.devDependencies;
type ParserName = keyof typeof dependencies;
const exec = util.promisify(execSync);
const outDir = path.join(__dirname, "out");

function getPackagePath(name: string) {
  try {
    return findRoot(fileURLToPath(import.meta.resolve(name)));
  } catch {
    return path.join(__dirname, "node_modules", name);
  }
}

async function gitCloneOverload(name: ParserName) {
  const packagePath = getPackagePath(name);
  const value = dependencies[name];
  const match = /^github:(\S+)#(\S+)$/.exec(value);

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
  } catch (error) {
    throw new ParserError(`❗Failed to clone git repo for ${name}`, error);
  }
}

async function buildParserWASM(
  name: ParserName,
  { subPath, generate }: { subPath?: string; generate?: boolean } = {},
) {
  const label = subPath != null ? path.join(name, subPath) : name;

  const cliPackagePath = getPackagePath("tree-sitter-cli");
  const packagePath = getPackagePath(name);
  const cliPath = path.join(cliPackagePath, "tree-sitter");
  const generateCommand = cliPath.concat(" generate");
  const buildCommand = cliPath.concat(" build --wasm");

  console.log(`⏳ Building ${label}`);

  const cwd = subPath != null ? path.join(packagePath, subPath) : packagePath;

  if (!fs.existsSync(cwd)) {
    throw new ParserError(`❗ Failed to find cwd ${label}`, cwd);
  }

  if (generate) {
    try {
      await exec(generateCommand, { cwd });
    } catch (error) {
      throw new ParserError(`❗ Failed to generate ${label}`, error);
    }
  }

  try {
    await exec(buildCommand, { cwd });
    await exec(`mv *.wasm ${outDir}`, { cwd });
    console.log(`✅ Finished building ${label}`);
  } catch (error) {
    throw new ParserError(`❗ Failed to build ${label}`, error);
  }
}

async function processParser(name: ParserName) {
  // oxlint-disable-next-line typescript/switch-exhaustiveness-check
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

    default:
      await buildParserWASM(name);
  }
}

async function run() {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const grammars = Object.keys(dependencies).filter(
    (n) =>
      (n.startsWith("tree-sitter-") && n !== "tree-sitter-cli") ||
      n === "@elm-tooling/tree-sitter-elm",
  ) as ParserName[];

  let hasErrors = false;

  await PromisePool.withConcurrency(os.cpus().length)
    .for(grammars)
    .process(async (name) => {
      try {
        await processParser(name);
      } catch (error) {
        if (error instanceof ParserError) {
          console.error(`${error.message}:\n`, error.value);
        } else {
          console.error(error);
        }
        hasErrors = true;
      }
    });

  // oxlint-disable-next-line typescript/no-unnecessary-condition
  if (hasErrors) {
    throw new Error("❗Failed to build some parsers");
  }
}

fs.mkdirSync(outDir);
process.chdir(outDir);

try {
  await run();
} catch (error) {
  console.error(error);
  exit(1);
}
