import { config } from 'dotenv';
config({ path: __dirname + '/../.env.test', override: false, quiet: true });
config({ path: __dirname + '/../.env', override: false, quiet: true });
