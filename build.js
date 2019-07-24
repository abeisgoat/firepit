#!/usr/bin/env bash
const { mkdir, cat, cd, rm, find, echo, exec, mv } = require("shelljs");
const npm = (...args) => exec(["npm", ...args].join(" "));

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
mv("dist/firpeit-*", "dist/headless");

echo("-- Building headed binaries...");

const headful_config = cat("config.template.js").replace(
  "headless_value",
  "false"
);
echo(headful_config).to("config.js");
npm("run", "pkg");
mkdir("-p", "dist/headed");
mv("dist/firepit-*", "dist/headed");
