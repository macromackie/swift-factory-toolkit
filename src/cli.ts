#!/usr/bin/env node
import { parseInvocation } from "./arguments.js";
import { errorMessage } from "./evidence.js";
import { execute } from "./execute.js";

try {
  await execute(parseInvocation(process.argv.slice(2)));
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}
