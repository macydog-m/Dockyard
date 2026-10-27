import { _electron } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await _electron.launch({args:[path.resolve('scripts/glass-material-lab.cjs')],env});
const results=[];
try {
  for(const config of [{mode:'clear',theme:'dark'},{mode:'native',theme:'dark'},{mode:'native',theme:'light'},{mode:'layer',theme:'dark'}]){
    await fs.writeFile('.local/glass-lab-control.json',JSON.stringify(config),'utf8');
    let state;
    for(let i=0;i<100;i++){
      try {state=JSON.parse(await fs.readFile('output/playwright/glass-lab-state.json','utf8'));}catch{}
      if(JSON.stringify(state?.config)===JSON.stringify(config))break;
      await new Promise(r=>setTimeout(r,100));
    }
    assert.deepEqual(state.config,config);
    const page=(await app.windows()).find(p=>p.url().includes(encodeURIComponent(`${config.mode} / ${config.theme}`)));
    assert.ok(page);
    await page.getByRole('button',{name:'Test click',exact:true}).click();
    assert.equal(await page.getByRole('button').textContent(),'Clicked successfully');
    const focus=await app.evaluate(({BrowserWindow})=>{
      const windows=BrowserWindow.getAllWindows();
      const panel=windows.find(w=>w.getTitle()==='Dockyard material lab sample');
      windows.find(w=>w.getTitle()==='Dockyard material lab background').focus();
      return {visible:panel.isVisible(),destroyed:panel.isDestroyed()};
    });
    assert.equal(focus.visible,true);
    results.push({...state,domClickPassed:true,visibleAfterBackgroundFocus:focus.visible});
  }
  await fs.writeFile('output/playwright/glass-material-check.json',JSON.stringify({results,note:'DOM input and native lifecycle only. These checks do not validate DWM pixels or physical mouse hit testing.'},null,2),'utf8');
  console.log(JSON.stringify(results,null,2));
}finally{await app.close();}
