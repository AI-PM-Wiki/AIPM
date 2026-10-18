import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const [directory,site,envFile]=process.argv.slice(2);
process.loadEnvFile(envFile);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const child=spawn(process.execPath,['--import',root+'/agent-server/node_modules/tsx/dist/loader.mjs',
  root+'/test/browser/rate_feedback_server.mjs',directory,site],{
  cwd:root,stdio:'inherit',env:{...process.env,
    ANTHROPIC_API_KEY:process.env.AIPM_REAL_MODEL_API_KEY,
    ANTHROPIC_BASE_URL:'http://127.0.0.1:0',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',
    CLAUDE_CODE_MAX_RETRIES:'0',ANTHROPIC_MAX_RETRIES:'0',CLAUDE_CONFIG_DIR:directory+'/sdk-home'}});
process.on('SIGTERM',()=>child.kill('SIGTERM'));
child.on('exit',code=>process.exit(code));
