import {loadOriginalUi,drawUiPlanCanvas,layoutCaption,layoutOutlineText,unprojectUiPoint} from './ui-tools/outline-text.js';
import {NameEntry,layoutNameEntry,displayName} from './ui-tools/name-entry.js';
import {layoutOriginalPage} from './ui-tools/original-pages.js';
import {loadOriginalPages,drawOriginalPage} from './original-pages-canvas.js';
export class GameUi {
  static async load(canvas){const [assets,pages]=await Promise.all([loadOriginalUi(),loadOriginalPages()]);return new GameUi(canvas,{...assets,...pages});}
  constructor(canvas,assets){
    Object.assign(this,assets);this.canvas=canvas;this.context=canvas.getContext('2d');
    this.keys=new Set();this.cursor=null;this.lastTick=0;this.lastDraw='';this.reset();
  }
  reset(){
    this.name=new NameEntry(this.data,{index:this.name?.index??0,subtitles:this.name?.subtitles??false});
    this.keys.clear();this.cursor=null;this.lastDraw='';this.page=null;this.active=true;this.drawName();
  }
  confirm(){if(this.page)return false;this.name.step({key:'Enter'});this.active=false;this.keys.clear();this.clear();return true;}
  back(){this.page=null;this.cursor=null;this.keys.clear();this.lastDraw='';this.drawName();}
  clear(){this.context.clearRect(0,0,this.canvas.width,this.canvas.height);this.lastDraw='';}
  step(input){if(this.page)return;this.name.step(input);this.lastDraw='';this.drawName();}
  key(key,down){
    if(!this.active)return false;
    if(this.page){if(down&&key==='Escape')this.back();return key==='Escape'||key.startsWith('Arrow')||key.length===1;}
    if(key.startsWith('Arrow')){this.keys[down?'add':'delete'](key);return true;}
    if(down&&key.length===1){this.step({key});return true;}
    return false;
  }
  buttonAt(x,y){
    const [sx,sy]=unprojectUiPoint(x,y,{nativeClientHeight:734,height:734});
    // Browser interaction includes the actual visible glyph bounds. The
    // original hand rectangle can sit below its text at this client height.
    for(const button of this.data.nameMenu.buttons){
      const selected=button.id==='subtitles'&&this.name.subtitles,b=selected?{...button,text:button.onText,x:button.onX}:button;
      const plan=layoutOutlineText(this.font,b.text,b),first=plan.commands[0],last=plan.commands.at(-1);
      if(sx>=first.x-1&&sx<=last.x+last.scale*last.glyph.advanceX+1&&sy>=button.y-1&&sy<=button.y+6)return button;
    }
    return null;
  }
  pointer(x,y,click=false){
    if(!this.active)return false;
    if(this.page){
      const [sx,sy]=unprojectUiPoint(x,y,{nativeClientHeight:734,height:734});
      this.cursor={x:sx,y:sy};
      const plan=layoutOriginalPage(this.font,this.pages,this.page,{cursor:this.cursor,click});
      for(const action of plan.actions){
        if(action.type==='external-url')window.open(action.url,'_blank','noopener,noreferrer');
        if(action.type==='page'&&action.nativeState===0){this.back();return true;}
      }
      this.lastDraw='';this.drawName();return this.page!=='hints'||plan.hovered.length>0;
    }
    const button=this.buttonAt(x,y);
    this.cursor=button?{x:(button.hit[0]+button.hit[2])/2,y:(button.hit[1]+button.hit[3])/2}:null;
    const frame=this.name.step({cursor:this.cursor,click});
    for(const action of frame.actions)if(action.type==='page'){this.page=action.page;this.cursor=null;this.keys.clear();}
    this.lastDraw='';this.drawName();return !!button;
  }
  drawName(){
    const frame=this.name.frame,key=[frame.index,frame.visible,frame.subtitles,JSON.stringify(frame.cursor),this.page].join('|');
    if(key===this.lastDraw)return;
    this.clear();
    const viewport={width:1016,height:734,nativeClientHeight:734};
    if(this.page)drawOriginalPage(this.context,this.font,layoutOriginalPage(this.font,this.pages,this.page,{cursor:this.cursor}),this.images,viewport);
    else{
      const plan=layoutNameEntry(this.font,this.data,frame);
      const title=layoutOutlineText(this.font,'Facade 2',{x:25,y:32,scale:15,color:7});
      const width=title.commands.at(-1).x+15*title.commands.at(-1).glyph.advanceX;
      for(const command of title.commands)command.x-=width/2;
      plan.commands.push(...title.commands);
      drawUiPlanCanvas(this.context,this.font,plan,this.data.palette,viewport);
    }
    this.lastDraw=key;
  }
  captionPages(text){
    const pages=[];let current=null;
    for(const word of text.matchAll(/\S+/g)){
      const clean=word[0].replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/[–—]/g,'-').replace(/…/g,'.').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7e]/g,'?');
      for(let offset=0;offset<clean.length;offset+=12){
        const part=clean.slice(offset,offset+12),candidate=current?current.text+' '+part:part;
        const plan=layoutCaption(this.font,candidate,{x:0,y:0});
        if(!current||plan.commands.some(c=>c.line>=3)){current={text:part,start:word.index+offset};pages.push(current);}
        else current.text=candidate;
      }
    }
    return pages.length?pages:[{text:'...',start:0}];
  }
  update(now,scene){
    if(this.active){
      if(this.page){this.drawName();return;}
      if(now-this.lastTick>=1000/30){
        this.lastTick=now;this.name.step({left:this.keys.has('ArrowLeft'),right:this.keys.has('ArrowRight'),up:this.keys.has('ArrowUp'),down:this.keys.has('ArrowDown'),cursor:this.cursor});this.drawName();
      }
      return;
    }
    const generated=scene.conversation?.caption;
    if(!generated&&(!this.name.subtitles||scene.audio.status!=='playing')){if(this.lastDraw)this.clear();return;}
    const line=generated??scene.audio.line,actor=scene.actors.find(a=>a.model.name===line.actor),head=actor?.renderedHead;
    // Original caption geometry; this replacement chooses the visible head
    // anchor. Native subtitle eligibility/lifetime remains a separate audit.
    const x=head?head.points[0][0]:-70,y=head?Math.min(25,head.points[0][1]+8):(line.actor==='grace'?20:-60);
    const key=[line.actor,line.script,Math.round(x*10),Math.round(y*10)].join('|');if(key===this.lastDraw)return;
    this.clear();drawUiPlanCanvas(this.context,this.font,layoutCaption(this.font,line.text,{x,y,route:line.actor==='grace'?0:1}),this.data.palette,{nativeClientHeight:734});this.lastDraw=key;
  }
  get label(){return this.page?this.page[0].toUpperCase()+this.page.slice(1):displayName(this.data,this.name.index);}
}
