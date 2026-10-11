#!/usr/bin/env python3
"""Real Linux TTY/process lifetime checks, optionally with owned Chromium/CDP."""
import argparse, errno, fcntl, json, os, pty, select, signal, subprocess, tempfile, termios, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--real-browser',action='store_true');args=parser.parse_args()
    assert os.name=='posix'
    with tempfile.TemporaryDirectory(prefix='fosu-diagnostic-exit-') as temporary:
        root=Path(temporary); entry=root/'child.js'
        entry.write_text('''const fs=require('fs'),path=require('path');
const root=process.argv[2],mode=process.argv[3],cwd=process.argv[4];
const prompt=require(path.join(cwd,'tools/wyz-schedule-collector/terminalPrompt'));
const unlock=require(path.join(cwd,'tools/wyz-schedule-collector/runStore')).acquireLock(root,'school-session.lock');
const control=new AbortController(),abort=()=>control.abort();
process.once('SIGINT',abort);process.once('SIGTERM',abort);
let timer,browser,context,cdp;
(async()=>{let result;
 try{
  if(process.env.FIXTURE_REAL_BROWSER==='1'){
   browser=await require(path.join(cwd,'tools/fosu-sync-client/node_modules/playwright')).chromium.launch({headless:true});
   context=await browser.newContext({ignoreHTTPSErrors:false});const page=await context.newPage();await page.goto('data:text/html,<p>local fixture</p>');
   cdp=await context.newCDPSession(page);await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  }
  if(mode==='timeout')timer=setTimeout(abort,150);
  const input=prompt.readHidden('FIXTURE_INPUT_PROMPT\\n',{signal:control.signal});
  // readHidden prints its prompt before arming raw mode. Announce readiness
  // only after its synchronous setup returns; do not send Ctrl+C to Chromium
  // through the still-canonical foreground PTY during that small interval.
  if(!process.stdin.isRaw||process.stdin.listenerCount('data')!==1)throw new Error('FIXTURE_INPUT_NOT_ARMED');
  console.log('FIXTURE_INPUT_READY');
  await input;
  if(mode==='failure')throw Object.assign(new Error('fixture-only'),{code:'FIXTURE_FAILURE'});
  result={status:'BLOCKED',observationStatus:'REQUEST_SHAPE_OBSERVED'};process.exitCode=2;
 }catch(error){result={status:error.code==='FIXTURE_FAILURE'?'FAILED':'BLOCKED',code:error.code};process.exitCode=error.code==='FIXTURE_FAILURE'?1:2;}
 finally{if(cdp)await cdp.detach();if(context)await context.close();if(browser)await browser.close();unlock();clearTimeout(timer);process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);require(path.join(cwd,'tools/diagnostics/cas-precheck-shape-915')).releaseInput();}
 console.log(JSON.stringify({...result,locksReleased:true,browserClosed:!browser||!browser.isConnected(),inputListeners:process.stdin.listenerCount('data'),rawModeRestored:!process.stdin.isRaw}));
})();
''',encoding='utf8')
        for mode in ['normal','failure','ctrl-c','timeout']:
            master,slave=pty.openpty()
            def setup(): os.setsid();fcntl.ioctl(slave,termios.TIOCSCTTY,0)
            env={**os.environ,'FIXTURE_REAL_BROWSER':'1' if args.real_browser else '0'}
            child=subprocess.Popen(['node',str(entry),str(root),mode,str(ROOT)],stdin=slave,stdout=slave,stderr=slave,env=env,preexec_fn=setup)
            os.close(slave); output=bytearray();sent=False;deadline=time.monotonic()+20
            try:
                while time.monotonic()<deadline:
                    if select.select([master],[],[],.05)[0]:
                        try: chunk=os.read(master,65536)
                        except OSError as error:
                            if error.errno!=errno.EIO:raise
                            break
                        if not chunk:break
                        output.extend(chunk)
                    if not sent and b'FIXTURE_INPUT_READY' in output:
                        if mode=='ctrl-c':os.write(master,b'\x03')
                        elif mode!='timeout':os.write(master,b'fixture-only\r')
                        sent=True
                    if child.poll() is not None:break
                try: child.wait(timeout=2)
                except subprocess.TimeoutExpired: raise AssertionError('PROCESS_STILL_ALIVE_AFTER_RESULT '+mode)
                assert child.returncode==(1 if mode=='failure' else 2),(mode,child.returncode,output.decode())
                rows=[json.loads(line) for line in output.decode().splitlines() if line.startswith('{')]
                assert len(rows)==1,output.decode();result=rows[0]
                assert result['locksReleased'] and result['browserClosed'] and result['rawModeRestored'] and result['inputListeners']==0
                assert not (root/'school-session.lock').exists()
                if mode=='normal':assert result['observationStatus']=='REQUEST_SHAPE_OBSERVED'
                print('CASE_PASS '+mode+' exit='+str(child.returncode)+' handles=CLEAN')
            finally:
                if child.poll() is None:os.killpg(child.pid,signal.SIGKILL);child.wait()
                os.close(master)
    print('DIAGNOSTIC_EXIT_PASS cases=4 realBrowser='+str(args.real_browser)+' schoolRequests=0')
if __name__=='__main__':main()
