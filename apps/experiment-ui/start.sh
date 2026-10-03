#!/bin/sh
# FRONTEND-R1 — runnable start (review fix: plain --experimental-strip-types
# cannot load the frozen modules' TypeScript parameter properties;
# --experimental-transform-types can, on Node >= 22.7).
# Usage: ./start.sh <experiment-dir> [port]
set -e
cd "$(dirname "$0")"
DIR="${1:?usage: ./start.sh <experiment-dir> [port]}"
PORT="${2:-4319}"

# startup check: this runtime must be able to LOAD the frozen modules
CHECK=$(node --experimental-transform-types --input-type=module -e '
  import { pathToFileURL } from "node:url";
  try {
    await import(pathToFileURL(process.argv[1]).href);
    console.log("ok");
  } catch (e) {
    console.log("fail:" + e.message);
    process.exit(1);
  }
' "$PWD/../../packages/user-evidence-r0/src/freeze.ts" 2>/dev/null || echo "fail:runtime-check")
case "$CHECK" in
  ok) ;;
  *) echo "startup check failed — this Node runtime cannot load the frozen modules:"; echo "  $CHECK"; echo "use Node >= 22.7 (this script passes --experimental-transform-types)"; exit 1 ;;
esac

exec node --experimental-transform-types server/index.ts --exp-dir "$DIR" --port "$PORT"
