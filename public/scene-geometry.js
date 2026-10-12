// Panel construction rotates the original points (FUN100b01e0). A later
// object transform has the opposite sign (FUN1008e050/10090250) and its own
// anchor. Door native point1 is the bottom left corner, not its center.
const rad=Math.PI/180;
export function rotate([x,y,z],[rx,ry,rz]){
  let s=Math.sin(rz*rad),c=Math.cos(rz*rad);[x,y]=[c*x-s*y,s*x+c*y];
  s=Math.sin(ry*rad);c=Math.cos(ry*rad);[x,z]=[c*x+s*z,-s*x+c*z];
  s=Math.sin(rx*rad);c=Math.cos(rx*rad);[y,z]=[c*y-s*z,s*y+c*z];return [x,y,z];
}
export function panelPoints(panel,cameraYaw=0){
  const raw=[[-panel.width/2,-panel.height/2,0],[-panel.width/2,panel.height/2,0],
    [panel.width/2,panel.height/2,0],[panel.width/2,-panel.height/2,0]];
  const rotation=panel.billboard?[panel.rotation[0],cameraYaw+180,panel.rotation[2]]:panel.rotation;
  let points=raw.map(p=>rotate(p,rotation));
  if(panel.objectRotation){
    const anchor=panel.rotationAnchor?points[panel.rotationAnchor-1]:[0,0,0];
    if(!anchor)throw Error('Unsupported original panel anchor');
    points=points.map(p=>rotate(p.map((v,i)=>v-anchor[i]),panel.objectRotation.map(v=>-v)).map((v,i)=>v+anchor[i]));
  }
  return points.map(p=>p.map((v,i)=>v+panel.position[i]));
}
