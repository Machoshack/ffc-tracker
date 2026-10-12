// Combines the database files into setup.sql for pasting into the Supabase SQL Editor.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
const parts = [
  '-- FFC Patient Tracker: full database setup. Paste all of this into the Supabase SQL Editor and click Run.',
  '-- Includes FAKE patients for testing. No real patient data.',
];
for (const f of readdirSync('supabase/migrations').sort()) {
  parts.push(`\n-- ===== supabase/migrations/${f} =====`, readFileSync(`supabase/migrations/${f}`, 'utf8'));
}
parts.push('\n-- ===== supabase/seed.sql =====', readFileSync('supabase/seed.sql', 'utf8'));
writeFileSync('setup.sql', parts.join('\n'));
console.log('setup.sql written');
