const http = require('http');
const fs   = require('fs');
const out  = [];
const log  = s => { process.stdout.write(s + '\n'); out.push(s); };

function get(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    log('GET ' + url);
    const req = http.get(url, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => { log('HTTP ' + res.statusCode); resolve({ status: res.statusCode, body }); });
    });
    req.on('error', e => { log('REQ_ERR ' + e.message); reject(e); });
    req.setTimeout(timeoutMs, () => { log('TIMEOUT'); req.destroy(); reject(new Error('TIMEOUT')); });
  });
}

async function main() {
  log('Step 1: devices');
  const dev = await get('http://localhost:9000/api/devices?server=ArcadiaWHJSqlStage');
  const devices = JSON.parse(dev.body);
  const vt = devices.filter(r => /virtual/i.test(r.dev_type));
  log('Virtual terminals found: ' + vt.length);
  if (!vt.length) { log(JSON.stringify(devices.slice(0,2))); return; }

  const entry = vt[0];
  log('Entry: ' + JSON.stringify(entry));

  log('Step 2: dialogs');
  const url = `http://localhost:9000/api/tester/dialogs?server=ArcadiaWHJSqlStage&entry=${encodeURIComponent(entry.id)}&app=${encodeURIComponent(entry.app_name)}`;
  const dlg = await get(url);
  log('Body: ' + dlg.body.slice(0, 1000));
}

main()
  .catch(e => log('FATAL: ' + e.message))
  .finally(() => { try { fs.writeFileSync('C:\\Users\\PVenkatesh\\Downloads\\ear-explorer\\_diag2.txt', out.join('\n')); } catch(we){ process.stdout.write('WRITE_ERR:'+we.message+'\n'); } });
