import type { ModuleKind } from './data.ts';
type Source={kind?:ModuleKind;x?:number;y?:number};
/** Pointer-based editor dragging; no dependency on browser HTML drag support. */
export function moduleDrag(root:HTMLElement, callbacks:{active:(value:boolean)=>void;error:(source:Source,x:number,y:number)=>string|undefined;drop:(source:Source,x:number,y:number)=>void}) {
  let pending:{id:number;x:number;y:number;button:HTMLElement;source:Source}|undefined;
  let ghost:HTMLElement|undefined,target:HTMLElement|undefined,hint:HTMLElement|undefined,suppressClick=false;
  const clear=()=>{
    pending?.button.classList.remove('drag-source');target?.removeAttribute('data-drop');
    ghost?.remove();hint?.remove();ghost=target=hint=undefined;pending=undefined;callbacks.active(false);
  };
  root.addEventListener('dragstart',event=>event.preventDefault());
  root.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    const button=(event.target as HTMLElement).closest<HTMLElement>('[draggable="true"]');
    if(!button)return;
    pending={id:event.pointerId,x:event.clientX,y:event.clientY,button,source:button.dataset.kind?{kind:button.dataset.kind as ModuleKind}:{x:Number(button.dataset.x),y:Number(button.dataset.y)}};
  });
  window.addEventListener('pointermove',event=>{
    if(!pending||event.pointerId!==pending.id)return;
    if(!ghost&&Math.hypot(event.clientX-pending.x,event.clientY-pending.y)<6)return;
    event.preventDefault();
    if(!ghost){
      callbacks.active(true);pending.button.classList.add('drag-source');
      ghost=pending.button.cloneNode(true) as HTMLElement;ghost.className='module-drag-ghost';ghost.removeAttribute('id');ghost.setAttribute('aria-hidden','true');document.body.append(ghost);
      hint=document.createElement('div');hint.className='module-drag-hint';hint.setAttribute('role','status');document.body.append(hint);
    }
    ghost.style.left=`${event.clientX+14}px`;ghost.style.top=`${event.clientY+14}px`;
    target?.removeAttribute('data-drop');
    target=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('.module-cell')??undefined;
    if(target&&!root.contains(target))target=undefined;
    const error=target?callbacks.error(pending.source,Number(target.dataset.x),Number(target.dataset.y)):undefined;
    if(target)target.dataset.drop=error?'invalid':'valid';
    hint!.textContent=target?(error??(pending.source.kind?'Release to install':target.classList.contains('occupied')?'Release to swap modules':'Release to move module')):'Drag onto a ship grid cell · Esc cancels';
  },{passive:false});
  window.addEventListener('pointerup',event=>{
    if(!pending||event.pointerId!==pending.id)return;
    const source=pending.source,cell=target,dragged=Boolean(ghost);
    clear();
    if(!dragged)return;
    suppressClick=true;setTimeout(()=>{suppressClick=false;},0);
    if(cell)callbacks.drop(source,Number(cell.dataset.x),Number(cell.dataset.y));
  });
  window.addEventListener('pointercancel',()=>clear());
  window.addEventListener('blur',()=>clear());
  window.addEventListener('keydown',event=>{if(event.key==='Escape')clear();});
  root.addEventListener('click',event=>{if(suppressClick){event.preventDefault();event.stopImmediatePropagation();}},true);
}
