import {layoutOutlineText} from './outline-text.js';
const f=Math.fround;
export function displayName(data,index){
  const row=data.names[index];if(!row)throw Error('Original name index outside0..94');
  if(data.names[index+1]?.name===row.name)return row.name+' (female)';
  if(data.names[index-1]?.name===row.name)return row.name+' (male)';
  return row.name;
}
//One original update per step. Owns no input handlers and invents no wallclock
//repeat speed. The browser controller chooses when to call this update.
export class NameEntry{
  constructor(data,{index=0,subtitles=false}={}){
    if(data.format!=='facade-original-ui-contract-v1'||data.names.length!==95||!data.names[index])throw Error('Invalid original name data');
    this.data=data;this.index=index;this.subtitles=!!subtitles;this.counter=data.nameMenu.counterInitial;this.cooldown=0;this.confirmed=false;this.frame=this._frame(null,[]);
  }
  _frame(cursor,actions){return{index:this.index,name:displayName(this.data,this.index),record:this.data.names[this.index],subtitles:this.subtitles,visible:this.counter>10,counter:this.counter,cooldown:this.cooldown,cursor,actions,confirmed:this.confirmed};}
  step({key='',left=false,right=false,up=false,down=false,cursor=null,click=false}={}){
    if(this.confirmed)return this.frame;
    if(key==='Enter'||key==='\r'){this.confirmed=true;this.frame=this._frame(cursor,[{type:'confirm',id:this.index,name:this.data.names[this.index].name,gender:this.data.names[this.index].gender,isFemale:this.data.names[this.index].gender!=='m'}]);return this.frame;}
    const actions=[];
    for(const button of this.data.nameMenu.buttons){
      if(cursor&&cursor.x>button.hit[0]&&cursor.y>button.hit[1]&&cursor.x<button.hit[2]&&cursor.y<button.hit[3]&&click){
        if(button.id==='subtitles'){this.subtitles=!this.subtitles;actions.push({type:'subtitles',enabled:this.subtitles});}
        else actions.push({type:'page',page:button.id});
      }
    }
    //The native byte handler folds ASCII a..z only (not Unicode case folding).
    let letter=key.length===1?key.charCodeAt(0):0;if(letter>=97&&letter<=122)letter-=32;
    if(letter>=65&&letter<=90){
      this.index=0;while(this.index<95&&this.data.names[this.index].name.charCodeAt(0)<letter)this.index++;
      if(this.index>94)this.index=94;this.counter=60;
    }
    const previous=left||up,next=right||down;
    if(this.cooldown<1){
      if(previous&&this.index>0)this.index--;
      if(next&&this.index<94)this.index++;
      if(previous||next){this.counter=60;this.cooldown=4;}
    }else this.cooldown--;
    this.frame=this._frame(cursor,actions);this.counter--;if(this.counter<1)this.counter=40;return this.frame;
  }
}
export function layoutNameEntry(font,data,frame){
  if(frame.confirmed)return{commands:[],source:'10097bd0',confirmed:true};
  const commands=[];
  for(const label of data.nameMenu.labels)commands.push(...layoutOutlineText(font,label.text,label).commands);
  for(const button of data.nameMenu.buttons){
    const b={...button};if(button.id==='subtitles'&&frame.subtitles){b.text=button.onText;b.x=button.onX;}
    if(frame.cursor&&frame.cursor.x>b.hit[0]&&frame.cursor.y>b.hit[1]&&frame.cursor.x<b.hit[2]&&frame.cursor.y<b.hit[3])b.color=b.hoverColor;
    commands.push(...layoutOutlineText(font,b.text,b).commands);
  }
  if(frame.visible){const selected=data.nameMenu.selected,text=displayName(data,frame.index);commands.push(...layoutOutlineText(font,text,{...selected,x:f(selected.xBase+text.length*selected.xPerByte)}).commands);}
  const bg=data.nameMenu.background;commands.push({kind:'polygon',points:bg.corners.map(p=>p.slice(0,2)),z:bg.corners[0][2],color:bg.color,alpha:1});
  return{commands,source:'10097bd0',confirmed:false,index:frame.index};
}
export function layoutIntroTitle(font,data){return{commands:data.introTitle.flatMap(label=>layoutOutlineText(font,label.text,label).commands),source:'1009e800'};}
