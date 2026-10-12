const $=id=>document.getElementById(id);
export function bindGameMenu(conversation){
 const menu=$('game-menu');
 $('game-menu-button').onclick=()=>{menu.showModal();conversation.scene.keys.clear();conversation.scene.ui.keys.clear();conversation.holdMic();};
 $('game-menu-close').onclick=()=>menu.close();
 menu.addEventListener('close',()=>{conversation.holdMic();$('game').focus();});
 // Close the menu before another modal is opened by its existing handler.
 for(const id of ['dialogue-button','character-voice-button','reset'])$(id).addEventListener('click',()=>menu.close(),{capture:true});
}
