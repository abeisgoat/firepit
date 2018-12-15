const { join } = require("path");
const {
  lstatSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  constants,
    unlinkSync
} = require("fs");
const { getInstalledPath } = require("get-installed-path");
const { fork } = require("child_process");
const homePath = require("user-home");
const debug = require("debug")("trashbin");

const npm = __dirname + "/node_modules/npm/bin/npm-cli";

(async () => {
  debug("Welcome to trashbin!");

  const isWin = process.platform === "win32";
  const fauxBinsPath = join(homePath, ".cache", "firebase", "bin");
  if (!isWin) {
    process.env.PATH = `${process.env.PATH}:${fauxBinsPath}`;
  }
  process.env._ = join(fauxBinsPath, "node");
  process.env.NODE = process.env._;

  debug(process.argv);
  debug(process.env);
  if (process.argv.indexOf("is:npm") !== -1) {
    debug("Detected is:npm flag, calling NPM");
    const breakerIndex = process.argv.indexOf("is:npm") + 1;
    const npmArgs = [
      ...process.argv.slice(breakerIndex),
      "--no-update-notifier",
      `--script-shell=${fauxBinsPath}/shell${isWin? ".bat" : ""}`
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
    const cmd = fork(nodeArgs[0], nodeArgs.slice(1), { stdio: "inherit", env: process.env  });
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
    const fauxBins = {
      /* Linux / OSX */
      "shell": `#!/usr/bin/env bash
bash "\${\@/*${process.argv[0].split("/").slice(-1)[0]}/node}"`,
      "node": `#!/usr/bin/env bash
if [[ "$@" == *"gyp"* ]]; then
  ${process.argv[0]} "$@"
else
  ARGS="$@"
  if ([[ "$@" != /* ]]); then
    ARGS="$PWD/$@"
  fi

  ${process.argv[0]} $ARGS
fi`,
      "npm": `${
        process.argv[0]
      } "/snapshot/npnoo/node_modules/npm/bin/npm-cli" --no-update-notifier --script-shell "${fauxBinsPath}/shell" "$@"`,
      /* Windows */
      "node.bat": `${process.argv[0]} %CD%/%*`,
      "shell.bat": `setlocal ENABLEDELAYEDEXPANSION
set PATH=%PATH%;${fauxBinsPath}
set blank=
set str=%*
set str=%str:-c=!blank!%
set node_runtime=node
set cmd=%str:${process.argv[0]} =!node_runtime!%
cmd /d /c %cmd%`,
      "npm.bat": `${
        process.argv[0]
        } "/snapshot/npnoo/node_modules/npm/bin/npm-cli" --no-update-notifier --script-shell "${fauxBinsPath}/shell.bat" %*`,
    };

    try {
      mkdirSync(fauxBinsPath);
    } catch (err) {
      debug(err);
    }

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
        "--prefix",
        installPath
      ],
      { stdio: "inherit", env: process.env }
    );

    cmd.on("close", () => {
      debug(`npm is done.`);
    });
  }
})();