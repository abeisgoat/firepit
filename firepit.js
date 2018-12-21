const { join } = require("path");
const {
  lstatSync,
  writeFileSync,
  chmodSync,
  constants,
  unlinkSync
} = require("fs");
const fs = require("fs");
const path = require("path");
const { getInstalledPath } = require("get-installed-path");
const { fork, execFile } = require("child_process");
const homePath = require("user-home");

const npm = __dirname + "/node_modules/npm/bin/npm-cli";
const isWin = process.platform === "win32";
const isWriter = process.argv.indexOf("--pit:no-write") === -1;
const isDebug = process.argv.indexOf("--pit:debug") !== -1;
let fauxBinsPath = join(homePath, ".cache", "firebase", "bin");
const unsafeNodePath = process.argv[0];
let trashbin;

if (isDebug) {
  process.env.DEBUG = "trashbin";
  process.argv.splice(process.argv.indexOf("--pit:debug"), 1);
}

const debug = require("debug")("trashbin");
debug("Welcome to trashbin!");

(async () => {
  if (!isWriter) {
    process.argv.splice(process.argv.indexOf("--pit:no-write"), 1);
  }

  createFauxBinaries();

  if (isWin) {
    const safeNodePath = await getSafeCrossPlatformPath(isWin, process.argv[0]);
    fauxBinsPath = await getSafeCrossPlatformPath(isWin, fauxBinsPath);
    process.argv[0] = safeNodePath;
    process.env.NODE = safeNodePath;
    process.env._ = safeNodePath;
    debug(safeNodePath);
    debug(process.argv);
    createFauxBinaries();
  }

  if (isWin) {
    process.env.PATH = `${process.env.PATH};${fauxBinsPath}`;
  } else {
    process.env.PATH = `${process.env.PATH}:${fauxBinsPath}`;
  }
  // process.env._ = join(fauxBinsPath, "node");
  // process.env.NODE = process.env._;

  // debug(process.argv);
  // debug(process.env);
  if (process.argv.indexOf("is:npm") !== -1) {
    debug("Detected is:npm flag, calling NPM");
    const breakerIndex = process.argv.indexOf("is:npm") + 1;
    const npmArgs = [
      ...process.argv.slice(breakerIndex),
      "--no-update-notifier",
      `--script-shell=${fauxBinsPath}/shell${isWin ? ".bat" : ""}`
    ];
    debug(npmArgs);
    const cmd = fork(npm, npmArgs, { stdio: "inherit", env: process.env });
    cmd.on("close", () => {
      debug(`faux-npm done.`);
    });
    return;
  }

  if (process.argv.indexOf("is:node") !== -1) {
    debug("Detected is:node flag, calling node");
    const breakerIndex = process.argv.indexOf("is:node") + 1;
    const nodeArgs = [...process.argv.slice(breakerIndex)];
    const cmd = fork(nodeArgs[0], nodeArgs.slice(1), {
      stdio: "inherit",
      env: process.env
    });
    cmd.on("close", () => {
      debug(`faux-node done.`);
    });
    return;
  }

  const installPath = join(homePath, ".cache", "firebase", "cli");
  const moduleBinPath = "./lib/bin/firebase.js";

  const firebaseToolsBinPaths = [];

  try {
    const trashbinFirebaseToolsBinPath = join(
      installPath,
      "node_modules/firebase-tools",
      moduleBinPath
    );

    debug(
      `Checking for trashbin CLI install at ${trashbinFirebaseToolsBinPath}`
    );

    if (lstatSync(trashbinFirebaseToolsBinPath).isFile()) {
      debug(`Found trashbin install.`);
      firebaseToolsBinPaths.push(trashbinFirebaseToolsBinPath);
    }
  } catch (err) {
    debug(err);
    debug("Can't find trashbin firebase-tools install");
  }

  try {
    debug("Attempting to lookup global CLI install...");

    const globalFirebaseToolsBinPath = join(
      await getInstalledPath("firebase-tools"),
      moduleBinPath
    );
    firebaseToolsBinPaths.push(globalFirebaseToolsBinPath);
  } catch (err) {
    debug(err);
    debug("Can't find global firebase-tools install");
  }

  if (firebaseToolsBinPaths.length) {
    const binPath = firebaseToolsBinPaths[0];
    debug(`CLI install found at "${binPath}", starting fork...`);
    const cmd = fork(binPath, process.argv.slice(2), { stdio: "inherit" });
    cmd.on("close", () => {
      debug(`firebase-tools is done.`);
    });
  } else {
    debug(`CLI not found! Invoking npm...`);
    debug(`Attempting to install to "${installPath}"`);

    console.log(`Please wait while the Firebase CLI downloads...`);
    const cmd = fork(
      npm,
      [
        "--no-update-notifier",
        "install",
        "firebase-tools",
        `--script-shell=${fauxBinsPath}/shell${isWin ? ".bat" : ""}`,
        "--prefix",
        installPath
      ],
      { stdio: "inherit", env: process.env }
    );

    cmd.on("close", () => {
      debug(`npm is done.`);
    });
  }
})().catch(err => {
  throw err;
});

function createFauxBinaries() {
  const fauxBins = {
    /* Linux / OSX */
    shell: `#!/usr/bin/env bash
bash "\${\@/*${process.argv[0].split("/").slice(-1)[0]}/node}"`,
    node: `#!/usr/bin/env bash
if [[ "$@" == *"gyp"* ]]; then
  ${process.argv[0]} "$@"
else
  ARGS="$@"
  if ([[ "$@" != /* ]]); then
    ARGS="$PWD/$@"
  fi

  ${process.argv[0]} $ARGS
fi`,
    npm: `"${unsafeNodePath}" "${npm}" --no-update-notifier --script-shell "${fauxBinsPath}\shell" "$@"`,
    /* Windows */
    "node.bat": `@echo off
"${unsafeNodePath}"  ${fauxBinsPath}\\node.js %*`,
    "shell.bat": `@echo off
"${unsafeNodePath}"  ${fauxBinsPath}\\shell.js %*`,
    "npm.bat": `@echo off
node "${npm}" --no-update-notifier --scripts-prepend-node-path="auto" --script-shell "${fauxBinsPath}\\shell.bat" %*`,
    // https://stackoverflow.com/questions/4051088/get-dos-path-instead-of-windows-path
    "dosify_path.bat": `@echo off
echo %~s1`,
    "shell.js": `${getSafeCrossPlatformPath.toString()}\n(${Script_ShellJS.toString()})()`,
    "node.js": `(${Script_NodeJS.toString()})()`
  };

  try {
    mkDirByPathSync(fauxBinsPath);
  } catch (err) {
    debug(err);
  }

  if (isWriter) {
    Object.keys(fauxBins).forEach(filename => {
      const fauxBinPath = join(fauxBinsPath, filename);
      try {
        unlinkSync(fauxBinPath);
      } catch (err) {
        debug(err);
      }
      writeFileSync(fauxBinPath, fauxBins[filename]);
      if (!isWin) {
        const rwx = constants.S_IRUSR | constants.S_IWUSR | constants.S_IXUSR;
        chmodSync(fauxBinPath, rwx);
      }
    });
  }
}

async function getSafeCrossPlatformPath(isWin, path) {
  if (!isWin) return path;

  let command = `for %I in ("${path}") do echo %~sI`;
  return new Promise((resolve, reject) => {
    const cmd = require("child_process").spawn(
      `cmd`,
      ["/c", command],
      {
        shell: true
    });

    let result = "";
    cmd.on("error", (error) => {throw error});
    cmd.stdout.on("data", (stdout) => {
      result += stdout.toString();
    });

    cmd.on("close", (code) => {
      if (code == 0) {
        const lines = result.split("\r\n").filter((line) => line);
        const path = lines.slice(-1)[0];
        resolve(path.trim());
      } else {
        throw `Attempt to dosify path failed with code ${code}`;
      }
    });

  });
}

//https://stackoverflow.com/questions/31645738/how-to-create-full-path-with-nodes-fs-mkdirsync
function mkDirByPathSync(targetDir, { isRelativeToScript = false } = {}) {
  const sep = path.sep;
  const initDir = path.isAbsolute(targetDir) ? sep : "";
  const baseDir = isRelativeToScript ? __dirname : ".";

  return targetDir.split(sep).reduce((parentDir, childDir) => {
    const curDir = path.resolve(baseDir, parentDir, childDir);
    try {
      fs.mkdirSync(curDir);
    } catch (err) {
      if (err.code === "EEXIST") {
        // curDir already exists!
        return curDir;
      }

      // To avoid `EISDIR` error on Mac and `EACCES`-->`ENOENT` and `EPERM` on Windows.
      if (err.code === "ENOENT") {
        // Throw the original parentDir error on curDir `ENOENT` failure.
        throw new Error(`EACCES: permission denied, mkdir '${parentDir}'`);
      }

      const caughtErr = ["EACCES", "EPERM", "EISDIR"].indexOf(err.code) > -1;
      if (!caughtErr || (caughtErr && curDir === path.resolve(targetDir))) {
        throw err; // Throw if it's just the last created dir.
      }
    }

    return curDir;
  }, initDir);
}

/*
These functions are not invoked, but are placed into standalone files which
are invoked during runtime.
 */

function Script_NodeJS() {
  const [script, ...otherArgs] = process.argv.slice(2);
  require("child_process").fork(script, otherArgs, {
    env: process.env,
    cwd: process.cwd(),
    stdio: "inherit",
  }).on("exit", (code) => {
    process.exit(code);
  })
}

async function Script_ShellJS() {
  const path = require("path");
  const child_process = require("child_process");
  const isWin = process.platform === "win32";

  const args = process.argv.slice(2);
  const PATH = process.env.PATH;
  const pathSeperator = isWin ? ";" : ":";

  process.env.path = [
    __dirname,
    path.join(process.cwd(), "node_modules/.bin"),
    ...PATH.split(pathSeperator).filter(folder => folder)
  ].join(pathSeperator);

  let index;
  if ((index = args.indexOf("-c")) !== -1) {
    args.splice(index, 1);
  }

  args[0] = args[0].replace(process.execPath, "node");
  let [cmdRuntime, cmdScript, ...otherArgs] = args[0].split(" ");

  if (cmdRuntime === process.execPath) {
    cmdRuntime = "node";
  }

  let cmd;
  if (cmdRuntime === "node") {
    if ([".", "/"].indexOf(cmdScript[0]) === -1) {
      cmdScript = await getSafeCrossPlatformPath(
        isWin,
        path.join(process.cwd(), cmdScript)
      );
    }

    cmd = child_process.fork(cmdScript, otherArgs, {
      env: process.env,
      cwd: process.cwd(),
      stdio: "inherit"
    })
  } else {
    cmd = child_process.spawn(cmdRuntime, [cmdScript, ...otherArgs], {
      env: process.env,
      cwd: process.cwd(),
      stdio: "inherit",
      shell: true
    });
  }

  cmd.on("exit", (code) => {
    process.exit(code);
  });
}
