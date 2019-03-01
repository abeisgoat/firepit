# firepit/tools

This folder contains a `package.json`, `yarnrc`, and other files which allow us to build an offline mirror of the NPM registry
which only contains the exact required packages which Firepit exposes to a user (`firebase` and `npm`).

## Workflow

Running `npm run freeze` will generate a `yarn.lock` file and a `mirror/` folder which contains repository contents.

Once this directory is packaged and shipped to a user `npm run unfreeze` will run `yarn` with the correct arguments
to install from the local mirror allowing an installation to happen in rough 1/5 the time of a normal NPM install.