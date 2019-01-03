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
const { fork, spawn } = require("child_process");
const homePath = require("user-home");


const isWin = process.platform === "win32";
const isWriter = process.argv.indexOf("--pit:no-write") === -1;
const IsLogDebug = process.argv.indexOf("--pit:log-debug") !== -1;
const isFileDebug = process.argv.indexOf("--pit:file-debug") !== -1;

const installPath = join(homePath, ".cache", "firebase", "cli");
let runtimeBinsPath = join(homePath, ".cache", "firebase", "bin");

const moduleBinPath = "./lib/bin/firebase.js";
const npmBinPath = __dirname + "/node_modules/npm/bin/npm-cli";


let safeNodePath;
const unsafeNodePath = process.argv[0];

if (IsLogDebug) {
  process.argv.splice(process.argv.indexOf("--pit:debug"), 1);
}

if (!isWriter) {
  process.argv.splice(process.argv.indexOf("--pit:no-write"), 1);
}

const log = [];
const debug = (...msg) => {
  if (IsLogDebug) {
    msg.forEach((m) => console.log(m));
  } else {
    msg.forEach((m) => log.push(m));
  }
};
debug("Welcome to firepit!");

(async () => {
  const isTopLevel = process.env.IN_FIREPIT !== "true";
  safeNodePath = await getSafeCrossPlatformPath(isWin, process.argv[0]);

  if (isTopLevel && isWin) {
    const shellConfig = {
      stdio: "inherit",
      env: {
        IN_FIREPIT: "true",
        ...process.env
      }
    };

    spawn(
      "cmd",
      [
        "/k",
        [
          `doskey firebase=${safeNodePath} $*`,
          `doskey npm=${safeNodePath} is:npm $*`,
          "echo Welcome to the Firebase Shell! You can type 'firebase' or 'npm' to run commands!"
        ].join(" | ")
      ],
      shellConfig
    );
  } else {
    await firepit();
  }

  if (isFileDebug) {
    writeFileSync("firepit-log.txt", log.join("\n"));
  }
})().catch(err => {
  debug(err.toString());
  console.log(`This tool has encountered an error. Please file a bug on Github and include firepit-log.txt`);
  writeFileSync("firepit-log.txt", log.join("\n"));
});

async function firepit() {
  runtimeBinsPath = await getSafeCrossPlatformPath(isWin, runtimeBinsPath);
  process.argv[0] = safeNodePath;
  process.env.NODE = safeNodePath;
  process.env._ = safeNodePath;

  debug(safeNodePath);
  debug(process.argv);

  createRuntimeBinaries();
  appendToPath(isWin, [runtimeBinsPath]);

  if (process.argv.indexOf("is:npm") !== -1) {
    return ImitateNPM();
  }

  if (process.argv.indexOf("is:node") !== -1) {
    return ImitateNode();
  }

  const firebaseToolsBinPaths = [];

  try {
    const firepitFirebaseToolsBinPath = join(
      installPath,
      "node_modules/firebase-tools",
      moduleBinPath
    );

    debug(`Checking for firepit CLI install at ${firepitFirebaseToolsBinPath}`);

    if (lstatSync(firepitFirebaseToolsBinPath).isFile()) {
      debug(`Found firepit install.`);
      firebaseToolsBinPaths.push(firepitFirebaseToolsBinPath);
    }
  } catch (err) {
    debug(err);
    debug("Can't find firepit firebase-tools install");
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
    ImitateFirebaseTools(binPath);
  } else {
    debug(`CLI not found! Invoking npm...`);
    debug(`Attempting to install to "${installPath}"`);

    console.log(`Please wait while the Firebase CLI downloads...`);
    const cmd = fork(
      npmBinPath,
      [
        "--no-update-notifier",
        "install",
        "firebase-tools",
        `--script-shell=${runtimeBinsPath}/shell${isWin ? ".bat" : ""}`,
        "--prefix",
        installPath
      ],
      { stdio: "inherit", env: process.env }
    );

    cmd.on("close", () => {
      debug(`npm is done.`);
    });
  }
}

function ImitateNPM() {
  debug("Detected is:npm flag, calling NPM");
  const breakerIndex = process.argv.indexOf("is:npm") + 1;
  const npmArgs = [
    ...process.argv.slice(breakerIndex),
    "--no-update-notifier",
    `--script-shell=${runtimeBinsPath}/shell${isWin ? ".bat" : ""}`
  ];
  debug(npmArgs);
  const cmd = fork(npmBinPath, npmArgs, { stdio: "inherit", env: process.env });
  cmd.on("close", () => {
    debug(`faux-npm done.`);
  });
}

function ImitateNode() {
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
}

function ImitateFirebaseTools(binPath) {
  debug("Detected no special flags, calling firebase-tools");
  const cmd = fork(binPath, process.argv.slice(2), { stdio: "inherit" });
  cmd.on("close", () => {
    debug(`firebase-tools is done.`);
  });
}


function createRuntimeBinaries() {
  const runtimeBins = {
    /* Linux / OSX */
    shell: `"${unsafeNodePath}"  ${runtimeBinsPath}/shell.js "$@"`,
    node: `"${unsafeNodePath}"  ${runtimeBinsPath}/node.js "$@"`,
    npm: `"${unsafeNodePath}" "${npmBinPath}" --no-update-notifier --script-shell "${runtimeBinsPath}/shell" "$@"`,

    /* Windows */
    "node.bat": `@echo off
"${unsafeNodePath}"  ${runtimeBinsPath}\\node.js %*`,
    "shell.bat": `@echo off
"${unsafeNodePath}"  ${runtimeBinsPath}\\shell.js %*`,
    "npm.bat": `@echo off
node "${npmBinPath}" --no-update-notifier --scripts-prepend-node-path="auto" --script-shell "${runtimeBinsPath}\\shell.bat" %*`,

    /* Runtime scripts */
    "shell.js": `${appendToPath.toString()}\n${getSafeCrossPlatformPath.toString()}\n(${Script_ShellJS.toString()})()`,
    "node.js": `(${Script_NodeJS.toString()})()`
  };

  try {
    mkDirByPathSync(runtimeBinsPath);
  } catch (err) {
    debug(err);
  }

  if (isWriter) {
    Object.keys(runtimeBins).forEach(filename => {
      const runtimeBinPath = join(runtimeBinsPath, filename);
      try {
        unlinkSync(runtimeBinPath);
      } catch (err) {
        debug(err);
      }
      writeFileSync(runtimeBinPath, runtimeBins[filename]);
      if (!isWin) {
        const rwx = constants.S_IRUSR | constants.S_IWUSR | constants.S_IXUSR;
        chmodSync(runtimeBinPath, rwx);
      }
    });
  }
}

// https://stackoverflow.com/questions/31645738/how-to-create-full-path-with-nodes-fs-mkdirsync
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
-------------------------------------
Shared Firepit / Runtime Functions

Are invoked in both Firepit and in the Runtime scripts.
-------------------------------------
 */

async function getSafeCrossPlatformPath(isWin, path) {
  if (!isWin) return path;

  let command = `for %I in ("${path}") do echo %~sI`;
  return new Promise((resolve, reject) => {
    const cmd = require("child_process").spawn(`cmd`, ["/c", command], {
      shell: true
    });

    let result = "";
    cmd.on("error", error => {
      throw error;
    });
    cmd.stdout.on("data", stdout => {
      result += stdout.toString();
    });

    cmd.on("close", code => {
      if (code === 0) {
        const lines = result.split("\r\n").filter(line => line);
        const path = lines.slice(-1)[0];
        resolve(path.trim());
      } else {
        throw `Attempt to dosify path failed with code ${code}`;
      }
    });
  });
}

function appendToPath(isWin, pathsToAppend) {
  const PATH = process.env.PATH;
  const pathSeperator = isWin ? ";" : ":";

  process.env.PATH = [
    ...pathsToAppend,
    ...PATH.split(pathSeperator).filter(folder => folder)
  ].join(pathSeperator);

}

/*
-------------------------------------
Runtime Scripts

These functions are not invoked in firepit,
but are written to the filesystem (via Function.toString())
and then invoked from platform-specific .bat or .sh scripts
-------------------------------------
 */

function Script_NodeJS() {
  const [script, ...otherArgs] = process.argv.slice(2);
  require("child_process")
    .fork(script, otherArgs, {
      env: process.env,
      cwd: process.cwd(),
      stdio: "inherit"
    })
    .on("exit", code => {
      process.exit(code);
    });
}

async function Script_ShellJS() {
  const path = require("path");
  const child_process = require("child_process");
  const isWin = process.platform === "win32";
  const args = process.argv.slice(2);

  appendToPath(isWin, [
    __dirname,
    path.join(process.cwd(), "node_modules/.bin")
  ]);

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
    });
  } else {
    cmd = child_process.spawn(cmdRuntime, [cmdScript, ...otherArgs], {
      env: process.env,
      cwd: process.cwd(),
      stdio: "inherit",
      shell: true
    });
  }

  cmd.on("exit", code => {
    process.exit(code);
  });
}