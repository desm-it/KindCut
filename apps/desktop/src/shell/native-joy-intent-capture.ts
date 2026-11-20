export const NATIVE_INTENTS=['connect','disconnect','job-start','job-go','job-resume','job-end']as const;
export type NativeIntent=typeof NATIVE_INTENTS[number];
export function isNativeIntent(v:unknown):v is NativeIntent{return typeof v==='string'&&(NATIVE_INTENTS as readonly string[]).includes(v);}
/** Install only in Electron's isolated preload, never in the page world. */
export function installNativeIntentCapture(target:Pick<Window,'addEventListener'>,send:(action:NativeIntent|null)=>void){
 target.addEventListener('click',event=>{
  if(!event.isTrusted)return;
  const node=event.target as Element|null;
  const button=node&&typeof node.closest==='function'?node.closest('button')as HTMLButtonElement|null:null;
  const action=button?.getAttribute('data-native-intent');
  // Looking at a tool/full preview must not create approval or cancel pending Go.
  if(button?.isConnected&&!button.disabled&&button.getAttribute('data-native-preview')==='true'&&!action)return;
  // An unrelated real click revokes an unused receipt, e.g. Cancel or Close.
  send(button&&!button.disabled&&button.isConnected&&isNativeIntent(action)?action:null);
 },{capture:true});
}
