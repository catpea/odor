import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Interpreter } from './src/runtime/interpreter.js';

export const EXIT_SUCCESS = 0;
export const EXIT_PARTIAL = 1;
export const EXIT_FATAL   = 2;

export async function run(argv = process.argv.slice(2), options = {}) {
  const programFile = argv[0];

  if (!programFile) {
    console.error('Usage: odor3-build <build.xml> [--dry-run] [--force-post <post-id>]');
    return EXIT_FATAL;
  }

  const events = options.events ?? new EventEmitter();

  const interpreter = new Interpreter();

  try {
    await interpreter.load(programFile);
  } catch (err) {
    console.error(`Fatal: could not load program "${programFile}": ${err.message}`);
    return EXIT_FATAL;
  }

  const controller = new AbortController();

  const onSigint = () => {
    console.log('\nShutdown requested — finishing in-flight work...');
    controller.abort();
  };
  process.on('SIGINT', onSigint);

  return new Promise(async resolve => {
    let settled = false;

    const finish = code => {
      if (settled) return;
      settled = true;
      process.removeListener('SIGINT', onSigint);
      resolve(code);
    };

    try {
      const { runtime } = await interpreter.run(argv, { events });

      // Inject the abort signal into the already-resolved runtime
      // (run() completes synchronously; the signal is checked per-action)
      const exitCode = runtime.store.get('build.exitCode') ?? EXIT_SUCCESS;
      finish(exitCode);
    } catch (err) {
      if (controller.signal.aborted) {
        console.log('Build cancelled.');
        finish(EXIT_PARTIAL);
      } else {
        console.error(`Fatal: ${err.message}`);
        finish(EXIT_FATAL);
      }
    }
  });
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntrypoint) {
  const code = await run(process.argv.slice(2));
  process.exit(code);
}
