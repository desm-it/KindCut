import{useEffect,useLayoutEffect,useRef}from'react';
const bounded=(value:number,max:number)=>Math.max(0,Math.min(value,Math.max(0,max)));
export function centeredPlanScroll(left:number,itemWidth:number,viewportWidth:number,scrollWidth:number){return bounded(left+itemWidth/2-viewportWidth/2,scrollWidth-viewportWidth);}
export function planWheelDelta(x:number,y:number,mode:number,pageWidth:number,lineHeight=16){const d=Math.abs(x)>Math.abs(y)?x:y;return d*(mode===1?lineHeight:mode===2?pageWidth:1);}
export function attachPlanWheel(element:HTMLElement){
 const wheel=(event:WheelEvent)=>{if(event.ctrlKey||element.scrollWidth<=element.clientWidth)return;const line=typeof getComputedStyle==='function'?parseFloat(getComputedStyle(element).lineHeight)||16:16,delta=planWheelDelta(event.deltaX,event.deltaY,event.deltaMode,element.clientWidth,line);if(!Number.isFinite(delta)||delta===0)return;event.preventDefault();event.stopPropagation();element.scrollLeft=bounded(element.scrollLeft+delta,element.scrollWidth-element.clientWidth);};
 element.addEventListener('wheel',wheel,{passive:false});return()=>element.removeEventListener('wheel',wheel);
}
export function useNativeMakePlanScroll(current:number,identity:unknown){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{const el=ref.current;return el?attachPlanWheel(el):undefined;},[]);
 useLayoutEffect(()=>{const el=ref.current;if(!el)return;const centre=()=>{if(!el.clientWidth)return;const step=el.querySelectorAll<HTMLElement>('.cut-step')[current];if(!step)return;const viewport=el.getBoundingClientRect(),item=step.getBoundingClientRect(),left=el.scrollLeft+item.left-viewport.left-el.clientLeft;el.scrollLeft=centeredPlanScroll(left,item.width,el.clientWidth,el.scrollWidth);};centre();const observer=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(centre);observer?.observe(el);const list=el.firstElementChild;if(list)observer?.observe(list);return()=>observer?.disconnect();},[current,identity]);
 return ref;
}
