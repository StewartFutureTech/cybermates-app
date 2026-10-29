import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const p = await b.newPage(); await p.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1');
await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const log = []; p.on('console', m => log.push(m.type() + ': ' + m.text().slice(0, 200))); p.on('pageerror', e => log.push('PAGEERROR: ' + e.message)); p.on('requestfailed', r => log.push('REQFAIL ' + r.url()));
await p.goto(process.argv[2], { waitUntil: 'networkidle2', timeout: 30000 }); await new Promise(r => setTimeout(r, 4000));
console.log('body text:', (await p.evaluate(() => document.body.innerText)).slice(0, 200).replace(/\n/g, ' | '));
await p.screenshot({ path: '/workspace/cybermates-shots/live-check/blank-check-chromium.png' }); console.log(log.join('\n')); await b.close();
