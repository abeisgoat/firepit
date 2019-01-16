const fs = require("fs");
const path = require("path");
const { fork, spawn } = require("child_process");
const homePath = require("user-home");
const shell = require("shelljs");
shell.config.silent = true;
const runtime = require("./runtime");

const installPath = path.join(homePath, ".cache", "firebase", "cli");
let runtimeBinsPath = path.join(homePath, ".cache", "firebase", "bin");

// const moduleBinPath = "./lib/bin/firebase.js";
// const npmBinPath = __dirname + "/node_modules/npm/bin/npm-cli";

let safeNodePath;
const unsafeNodePath = process.argv[0];

const isFileDebug = process.argv.indexOf("--pit:file-debug") !== -1;
if (isFileDebug) {
  process.argv.splice(process.argv.indexOf("--pit:file-debug"), 1);
}

const isLogDebug = process.argv.indexOf("--pit:log-debug") !== -1;
if (isLogDebug) {
  process.argv.splice(process.argv.indexOf("--pit:log-debug"), 1);
}

const isWriter = process.argv.indexOf("--pit:disable-write") === -1;
if (!isWriter) {
  process.argv.splice(process.argv.indexOf("--pit:disable-write"), 1);
}

const isWindows = process.platform === "win32";

debug("Welcome to firepit!");

(async () => {
  const isTopLevel = process.env.IN_FIREPIT !== "true";
  safeNodePath = await getSafeCrossPlatformPath(isWindows, process.argv[0]);

  if (isTopLevel && isWindows) {
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
    fs.writeFileSync("firepit-log.txt", debug.log.join("\n"));
  }
})().catch(err => {
  debug(err.toString());
  console.log(
    `This tool has encountered an error. Please file a bug on Github and include firepit-log.txt`
  );
  fs.writeFileSync("firepit-log.txt", debug.log.join("\n"));
});

function FindTool(bin) {
  /*
    When locating firebase-tools, npm, node, etc they could all be hiding
    inside the firepit exe or in the npm cache.
   */

  const potentialPaths = [
    path.join(installPath, "lib/node_modules", bin),
    path.join(__dirname, "node_modules", bin)
  ];

  return potentialPaths
    .map(path => {
      debug(`Checking for ${bin} install at ${path}`);
      if (shell.ls(path + ".js").code === 0) {
        debug(`Found ${bin} install.`);
        return path;
      }
    })
    .filter(p => p);
}
async function firepit() {
  runtimeBinsPath = await getSafeCrossPlatformPath(isWindows, runtimeBinsPath);
  process.argv[0] = safeNodePath;
  process.env.NODE = safeNodePath;
  process.env._ = safeNodePath;

  debug(safeNodePath);
  debug(process.argv);

  createRuntimeBinaries();
  appendToPath(isWindows, [runtimeBinsPath]);

  if (process.argv.indexOf("is:npm") !== -1) {
    return ImitateNPM();
  }

  if (process.argv.indexOf("is:node") !== -1) {
    return ImitateNode();
  }

  const firebaseBins = FindTool("firebase-tools/lib/bin/firebase");
  if (firebaseBins.length) {
    const firebaseBin = firebaseBins[0];
    debug(`CLI install found at "${firebaseBin}", starting fork...`);
    ImitateFirebaseTools(firebaseBin);
  } else {
    debug(`CLI not found! Invoking npm...`);
    debug(`Attempting to install to "${installPath}"`);
    console.log(`Please wait while the Firebase CLI downloads...`);
    process.argv = [
      ...process.argv.slice(0, 2),
      "is:npm",
      "install",
      "-g",
      "npm",
      "firebase-tools"
    ];
    ImitateNPM();
  }
}

function ImitateNPM() {
  debug("Detected is:npm flag, calling NPM");
  const breakerIndex = process.argv.indexOf("is:npm") + 1;
  const npmArgs = [
    ...process.argv.slice(breakerIndex),
    `--script-shell=${runtimeBinsPath}/shell${isWindows ? ".bat" : ""}`,
    "--prefix",
    installPath
  ];
  debug(npmArgs);
  const cmd = fork(FindTool("npm/bin/npm-cli")[0], npmArgs, {
    stdio: "inherit",
    env: process.env
  });
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
    npm: `"${unsafeNodePath}" "${
      FindTool("npm/bin/npm-cli")[0]
    }" --script-shell "${runtimeBinsPath}/shell" "$@"`,

    /* Windows */
    "node.bat": `@echo off
"${unsafeNodePath}"  ${runtimeBinsPath}\\node.js %*`,
    "shell.bat": `@echo off
"${unsafeNodePath}"  ${runtimeBinsPath}\\shell.js %*`,
    "npm.bat": `@echo off
node "${
      FindTool("npm/bin/npm-cli")[0]
    }" --scripts-prepend-node-path="auto" --script-shell "${runtimeBinsPath}\\shell.bat" %*`,

    /* Runtime scripts */
    "shell.js": `${appendToPath.toString()}\n${getSafeCrossPlatformPath.toString()}\n(${runtime.Script_ShellJS.toString()})()`,
    "node.js": `(${runtime.Script_NodeJS.toString()})()`
  };

  try {
    shell.mkdir("-p", runtimeBinsPath);
  } catch (err) {
    debug(err);
  }

  if (isWriter) {
    Object.keys(runtimeBins).forEach(filename => {
      const runtimeBinPath = path.join(runtimeBinsPath, filename);
      try {
        fs.unlinkSync(runtimeBinPath);
      } catch (err) {
        debug(err);
      }
      fs.writeFileSync(runtimeBinPath, runtimeBins[filename]);
      shell.chmod("+x", runtimeBinPath);
    });
  }
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
  return new Promise(resolve => {
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

function debug(...msg) {
  if (!debug.log) debug.log = [];

  if (isLogDebug) {
    msg.forEach(m => console.log(m));
  } else {
    msg.forEach(m => debug.log.push(m));
  }
}
