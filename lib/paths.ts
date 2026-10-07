import { join } from 'node:path';

// The files that one run writes for the job summary and the workflow outputs. The folder is not in git.
export const RUN_DIR = join(import.meta.dirname, '..', '.e2e');
export const WARMUP_FILE = join(RUN_DIR, 'warmup.json');
export const VERSIONS_FILE = join(RUN_DIR, 'versions.json');
export const SUMMARY_FILE = join(RUN_DIR, 'summary.md');
