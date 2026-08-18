/** `npm run demo` entry point — runs the offline walkthrough from source,
 *  so a fresh clone can see the loop work before anything is built. */
import { runDemoCli } from "./run";

process.exit(await runDemoCli(process.argv.slice(2)));
