import type{NativeJoyPlan}from'@cricut-companion/craft-core';
/** Stable complete actions: each pen colour, then blade. No geometry is omitted. */
export function partitionNativeJoyActions(groups:NativeJoyPlan['groups']):NativeJoyPlan['groups']{
 const pens:NativeJoyPlan['groups']=[],blades:NativeJoyPlan['groups']=[];
 for(const group of groups){if(group.tool==='pen'){const colors=new Map<string,NativeJoyPlan['groups'][number]>();for(const path of group.paths){if(typeof path.color!=='string'||!/^#[0-9a-f]{6}$/i.test(path.color))throw Error('Each pen path needs an identifiable colour.');const key=path.color.toLowerCase();let action=colors.get(key);if(!action){action={...group,paths:[]};colors.set(key,action);pens.push(action);}action.paths.push(path);}}else blades.push({...group,paths:[...group.paths]});}
 const actions=[...pens,...blades];if(actions.length>32)throw Error('This tool plan exceeds the supported 32-action limit.');return actions;
}
