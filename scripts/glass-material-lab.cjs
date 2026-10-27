// Native material experiment. Uses only a synthetic background; no screen capture.
const { app, BrowserWindow, BaseWindow, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.setPath('userData',path.resolve('.local/glass-material-lab'));
const control=path.resolve('.local/glass-lab-control.json');
const report=path.resolve('output/playwright/glass-lab-state.json');
const html=s=>'data:text/html;charset=utf-8,'+encodeURIComponent(s);
let board, panel, plate, last='';
fs.mkdirSync(path.dirname(report),{recursive:true});
fs.writeFileSync(control,JSON.stringify({mode:'native',theme:'dark'}),'utf8');
app.whenReady().then(async()=>{
  board=new BrowserWindow({title:'Dockyard material lab background',x:180,y:130,width:850,height:520,frame:false,alwaysOnTop:true,show:false,webPreferences:{sandbox:true}});
  await board.loadURL(html(`<body style="margin:0;background:repeating-linear-gradient(90deg,#fafafa 0 80px,#151515 80px 160px);font:26px Segoe UI"><div style="position:absolute;top:300px;width:100%;height:160px;background:linear-gradient(90deg,#e45955,#e9cb65,#619bd7)"></div><p style="background:white;padding:12px">SYNTHETIC BACKGROUND · material test</p></body>`));
  board.show();
  const apply=async c=>{
    panel?.destroy(); plate?.destroy(); plate=null;
    nativeTheme.themeSource=c.theme||'dark';
    const opts={x:270,y:230,width:640,height:330,frame:false,thickFrame:false,hasShadow:false,alwaysOnTop:true,show:false,resizable:false,backgroundColor:'#00000000'};
    if(c.mode==='layer'){
      plate=new BaseWindow({...opts,title:'Dockyard lab backing',backgroundMaterial:'acrylic',focusable:false,skipTaskbar:true});
      plate.setIgnoreMouseEvents(true);
      if(c.opacity!==undefined)plate.setOpacity(c.opacity);
      plate.showInactive();
    }
    panel=new BrowserWindow({...opts,title:'Dockyard material lab sample',transparent:c.mode!=='native',backgroundMaterial:c.mode==='native'?'acrylic':'none',webPreferences:{sandbox:true}});
    await panel.loadURL(html(`<body style="margin:0;background:transparent;color:white;font:16px Segoe UI"><main style="height:330px;box-sizing:border-box;border:1px solid #fff9;border-top:2px solid #fffe;border-radius:14px;background:rgba(35,35,35,${c.mode==='clear'?.18:.01});padding:28px"><h2>${c.mode} / ${c.theme} / backing opacity ${c.opacity??1}</h2><p>White / black stripes and colored blocks behind this window.</p><button onclick="this.textContent='Clicked successfully'" style="padding:16px;color:white;background:#ffffff20;border:1px solid white;border-radius:9px">Test click</button></main></body>`));
    panel.show();panel.moveTop();panel.focus();
    panel.webContents.on('before-input-event',(_event,input)=>{
      if(input.type!=='keyDown')return;
      const variants={
        '1':{mode:'clear',theme:'dark'},
        '2':{mode:'native',theme:'dark'},
        '3':{mode:'native',theme:'light'},
        '4':{mode:'layer',theme:'dark'},
      };
      if(variants[input.key]) fs.writeFileSync(control,JSON.stringify(variants[input.key]),'utf8');
      if(input.key==='Escape')app.quit();
    });
    fs.writeFileSync(report,JSON.stringify({config:c,theme:nativeTheme.shouldUseDarkColors,reduced:nativeTheme.prefersReducedTransparency,highContrast:nativeTheme.shouldUseHighContrastColors,panel:panel.getBounds(),plateOpacity:plate?.getOpacity(),electron:process.versions.electron},null,2));
  };
  last=fs.readFileSync(control,'utf8');
  await apply(JSON.parse(last));
  const timer=setInterval(async()=>{try{const value=fs.readFileSync(control,'utf8');if(value!==last){last=value;const c=JSON.parse(value);if(c.quit){clearInterval(timer);app.quit();return;}await apply(c);}}catch(e){console.error(e.message);}},500);
});
app.on('window-all-closed',()=>app.quit());
