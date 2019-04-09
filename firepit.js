// Copyright 2018, Google Inc. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

const fs = require("fs");
const path = require("path");
const { fork, spawn } = require("child_process");
const homePath = require("user-home");
const chalk = require("chalk");
const shell = require("shelljs");
shell.config.silent = true;

const runtime = require("./runtime");
const version = require("./package.json").version;

function SetWindowTitle(title) {
  if (process.platform === 'win32') {
    process.title = title;
  } else {
    process.stdout.write('\x1b]2;' + title + '\x1b\x5c');

  }
}

const installPath = path.join(homePath, ".cache", "firebase", "cli");
let runtimeBinsPath = path.join(homePath, ".cache", "firebase", "bin");

let safeNodePath;
const unsafeNodePath = process.argv[0];

const flagDefinitions = [
  "file-debug",
  "log-debug",
  "disable-write",
  "runtime-check",
  "setup-check",
  "force-setup"
];

const flags = flagDefinitions.reduce((flags, name) => {
  flags[name] = process.argv.indexOf(`--pit:${name}`) !== -1;
  if (flags[name]) {
    process.argv.splice(process.argv.indexOf(`--pit:${name}`), 1);
  }

  return flags;
}, {});

if (flags["runtime-check"]) {
  console.log(`firepit invoked for runtime check, exiting subpit.`);
  return;
}

const isWindows = process.platform === "win32";

debug(`Welcome to firepit v${version}!`);

(async () => {
  const isTopLevel = !process.env.FIREPIT_VERSION;
  safeNodePath = await getSafeCrossPlatformPath(isWindows, process.argv[0]);

  if (flags["setup-check"]) {
    const bins = FindTool("firebase-tools/lib/bin/firebase");

    for (const bin of bins) {
      bins[bin] = await getSafeCrossPlatformPath(bins[bin]);
    }

    console.log(JSON.stringify({bins}));
    return;
  }

  if (flags["force-setup"]) {
    createRuntimeBinaries();
    SetupFirebaseTools();
    return;
  }

  if (isTopLevel && isWindows) {
    const shellConfig = {
      stdio: "inherit",
      env: {
        FIREPIT_VERSION: version,
        ...process.env
      }
    };

    const isRuntime = await VerifyNodePath(safeNodePath);
    debug(`Node path ${safeNodePath} is runtime? ${isRuntime}`);

    let firebase_command;
    if (isRuntime) {
      const script_path = await getSafeCrossPlatformPath(
        isWindows,
        path.join(__dirname, "/firepit.js")
      );
      firebase_command = `${safeNodePath} ${script_path}`;
    } else {
      firebase_command = safeNodePath;
    }

    debug(firebase_command);

    const welcome_path = await getSafeCrossPlatformPath(
      isWindows,
      path.join(__dirname, "/welcome.js")
    );
    spawn(
      "cmd",
      [
        "/k",
        [
          `doskey firebase=${firebase_command} $*`,
          `doskey npm=${firebase_command} is:npm $*`,
          `set prompt=${chalk.yellow("$G")}`,
          `${firebase_command} is:node ${welcome_path} ${firebase_command}`
        ].join(" & ")
      ],
      shellConfig
    );

    process.on("SIGINT", () => {
      debug("Received SIGINT. Refusing to close top-level shell.");
    });
  } else {
    SetWindowTitle("Firebase CLI");
    await firepit();
  }

  if (flags["file-debug"]) {
    fs.writeFileSync("firepit-log.txt", debug.log.join("\n"));
  }
})().catch(err => {
  debug(err.toString());
  console.log(
    `This tool has encountered an error. Please file a bug on Github and include firepit-log.txt`
  );
  fs.writeFileSync("firepit-log.txt", debug.log.join("\n"));
});

async function VerifyNodePath(nodePath) {
  const runtimeCheckPath = await getSafeCrossPlatformPath(
    isWindows,
    path.join(__dirname, "check.js")
  );
  return new Promise(resolve => {
    const cmd = spawn(nodePath, [runtimeCheckPath, "--pit:runtime-check"], {
      shell: true
    });

    let result = "";
    cmd.on("error", error => {
      throw error;
    });

    cmd.stderr.on("data", stderr => {
      debug(`STDERR: ${stderr.toString()}`);
    });

    cmd.stdout.on("data", stdout => {
      debug(`STDOUT: ${stdout.toString()}`);
      result += stdout.toString();
    });

    cmd.on("close", code => {
      debug(
        `[VerifyNodePath] Expected "✓" from runtime got code ${code} with output "${result}"`
      );
      if (code === 0) {
        if (result.indexOf("✓") >= 0) {
          resolve(true);
        } else {
          resolve(false);
        }
      } else {
        resolve(false);
      }
    });
  });
}

function FindTool(bin) {
  /*
    When locating firebase-tools, npm, node, etc they could all be hiding
    inside the firepit exe or in the npm cache.
   */

  const potentialPaths = [
    path.join(installPath, "lib/node_modules", bin),
    path.join(installPath, "node_modules", bin),
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
    SetupFirebaseTools();
  }
}

function ImitateNPM() {
  debug("Detected is:npm flag, calling NPM");
  const breakerIndex = process.argv.indexOf("is:npm") + 1;
  const npmArgs = [
    `--script-shell=${runtimeBinsPath}/shell${isWindows ? ".bat" : ""}`,
    `--globalconfig=${path.join(runtimeBinsPath, "npmrc")}`,
    ...process.argv.slice(breakerIndex)
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

function SetupFirebaseTools() {
  debug(`Attempting to install to "${installPath}"`);
  console.log(`Please wait while the Firebase CLI downloads...`);
  process.argv = [
    ...process.argv.slice(0, 2),
    "is:npm",
    "install",
    "-g",
    "--verbose",
    "npm",
    "firebase-tools"
  ];
  ImitateNPM();
}

function ImitateFirebaseTools(binPath) {
  debug("Detected no special flags, calling firebase-tools");
  const cmd = fork(binPath, process.argv.slice(2), {
    stdio: "inherit",
    env: { ...process.env, FIREPIT_VERSION: version }
  });
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
    "node.js": `(${runtime.Script_NodeJS.toString()})()`,

    /* Config files */
    npmrc: `prefix = ${installPath}`
  };

  try {
    shell.mkdir("-p", runtimeBinsPath);
  } catch (err) {
    debug(err);
  }

  if (!flags["disable-write"]) {
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

  if (flags["log-debug"]) {
    msg.forEach(m => console.log(m));
  } else {
    msg.forEach(m => debug.log.push(m));
  }
}
