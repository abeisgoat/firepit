#!/usr/bin/env bash
cd vendor
npm install firebase-tools@latest
find . -name "*.node" -exec rm -rf {} \;
cd ..
npm run pkg
