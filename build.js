#!/usr/bin/env node
const shelljs = require("shelljs");
const { mkdir, cat, cd, rm, find, echo, exec, mv, ls} = shelljs;
const npm = (...args) => exec(["npm", ...args].join(" "));
const path = require("path");

// shelljs.config.verbose = true;

cd("vendor");

echo("-- Cleaning vendors...");
rm("-f", "config.js");
rm("-rf", "node_modules");

echo("-- Installing new vendor/node_modules");
npm("install", "firebase-tools@latest");

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

echo("-- Cleaning builds...");
rm("-rf", "dist/*");

echo("-- Building headless binaries...");

const headless_config = cat("config.template.js").replace(
  "headless_value",
  "true"
);
echo(headless_config).to("config.js");
npm("run", "pkg");
mkdir("-p", "dist/headless");
ls("dist/firepit-*").forEach(file => {
  mv(
    file,
    path.join(
      "dist/headless",
      path.basename(file).replace("firepit", "firebase-tools")
    )
  );
});

echo("-- Building headed binaries...");

const headful_config = cat("config.template.js").replace(
  "headless_value",
  "false"
);
echo(headful_config).to("config.js");
npm("run", "pkg");
mkdir("-p", "dist/headed");

ls("dist/firepit-*").forEach(file => {
    mv(
        file,
        path.join(
            "dist/headed",
            path.basename(file).replace("firepit", "firebase-tools")
        )
    );
});
