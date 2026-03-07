#!/usr/bin/env node

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Handle --setup before loading config (which validates required fields)
if (process.argv.includes('--setup')) {
  import('./setup').then(({ runSetup }) => runSetup());
} else {
  import('./main').then(({ start }) => start());
}
