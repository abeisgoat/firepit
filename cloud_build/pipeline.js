#!/usr/bin/env node
const shelljs = require("shelljs");
const path = require("path");
const argv = require('yargs').argv
const { mkdir, cat, cd, rm, find, echo, exec, mv, ls, pwd, tempdir, cp } = shelljs;

//https://storage.googleapis.com/fad-firebase-tools/firebase_tools.tgz

const isPublishing = argv.publish;
const isLocalFirepit = argv.local;
const styles = (argv.styles || "headless,headful").split(",").map((s) => s.trim()).reduce((m, v) => {
  m[v] = true;
  return m;
}, {});
const firebase_tools_package = argv.package;
const release_tag = argv.tag;

shelljs.config.fatal = true;

const use_commands = (...executables) =>
  executables.forEach(
    name => (global[name] = (...args) => exec([name, ...args].join(" ")))
  );

use_commands("hub", "npm", "wget", "tar", "git");

cd(tempdir());
rm("-rf", "firepit_pipeline");
mkdir("firepit_pipeline");
cd("firepit_pipeline");
const workdir = pwd();

npm("init", "-y");
npm("install", firebase_tools_package);

if (isLocalFirepit) {
  echo("Using local firepit for testing...");
  mkdir("firepit");
  rm("-rf", path.join(__dirname, "../vendor/node_modules"));
  rm("-rf", path.join(__dirname, "../node_modules"));

  cp(path.join(__dirname, "../*.j*"), "firepit/");
  cp("-R", path.join(__dirname, "../vendor"), "firepit/vendor");
} else {
  try {
    echo("Attempting to use firebase_tools/fireput...");
    mv("node_modules/firebase_tools/firepit", "firepit");
    echo("Success!");
  } catch (err) {
    echo("Failure... Pulling firepit repo...");
    git("clone", "https://github.com/abeisgoat/firepit.git");
  }
}

echo("Setting up firepit dev deps...");
cd("firepit");
npm("install");

echo("-- Installing new vendor/node_modules");
cd("vendor");
mv("../../node_modules", ".");

echo("-- Removing native platform addons (.node)");
find(".")
  .filter(function(file) {
    return file.match(/\.node$/);
  })
  .forEach(file => {
    echo(file);
    rm(file);
  });
cd("..");
echo(pwd());

if (styles.headless) {
  echo("-- Building headless binaries...");

  const config_template = cat("config.template.js").replace(
      "firebase_tools_package_value",
      firebase_tools_package
  );

  const headless_config = config_template.replace(
      "headless_value",
      "true"
  );
  echo(headless_config).to("config.js");
  npm("run", "pkg");
  ls("dist/firepit-*").forEach(file => {
    mv(
        file,
        path.join(
            "dist",
            path.basename(file).replace("firepit", "firebase-tools-headless")
        )
    );
  });
}

if (styles.headful) {
  echo("-- Building headed binaries...");

  const headful_config = config_template.replace(
      "headless_value",
      "false"
  );
  echo(headful_config).to("config.js");
  npm("run", "pkg");

  ls("dist/firepit-*").forEach(file => {
    mv(
        file,
        path.join(
            "dist",
            path.basename(file).replace("firepit", "firebase-tools-headed")
        )
    );
  });
}

if (isPublishing) {
  echo("Publishing...");
  // Temporary hack to release to hub-release-playground instead of prod
  hub("clone", "abeisgoat/hub-release-playground");
  cd("hub-release-playground");
  // EOHack

  ls("../dist").forEach((filename) => {
    hub("release", "edit", "-m", '""', "-a", path.join("../dist", filename), release_tag);
  });
  cd("..");
} else {
  echo("Skipping publishing...");
}

echo("-- Artifacts");
console.log(ls("-R", "dist").join("\n"));
rm("-rf", "/tmp/firepit_artifacts");
mv("dist", "/tmp/firepit_artifacts");

// Cleanup
cd("~");
rm("-rf", workdir);
