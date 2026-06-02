import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.dirname(scriptDir);

export async function compileApp(rootDir = defaultRoot) {
  const sourcePath = path.join(rootDir, "src", "App.tsx");
  const outputPath = path.join(rootDir, "public", "app.js");
  const babelPath = path.join(rootDir, "public", "vendor", "babel.min.js");

  const [source, babelSource] = await Promise.all([
    readFile(sourcePath, "utf8"),
    readFile(babelPath, "utf8")
  ]);

  const sandbox = {
    console,
    setTimeout,
    clearTimeout
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(babelSource, sandbox);

  const result = sandbox.Babel.transform(source, {
    filename: "App.tsx",
    presets: [
      [sandbox.Babel.availablePresets.typescript, { allExtensions: true, isTSX: true }],
      [sandbox.Babel.availablePresets.react, { runtime: "classic" }]
    ],
    sourceMaps: false
  });

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${result.code}\n`, "utf8");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await compileApp();
  console.log("Compiled src/App.tsx to public/app.js");
}
