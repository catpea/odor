#!/usr/bin/env node
import { run } from '../src/cli/status.js';

const args = process.argv.slice(2);
const code = await run(args);
process.exit(code);
