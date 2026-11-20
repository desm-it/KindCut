import{buildWorkspaceCutSvg,buildWorkspaceCutPreviewSvg,isCutSvgEmpty,type WorkspaceObject}from'./workspace-objects';
import{WORKSPACE_PIXELS_PER_INCH,type CardSize}from'./workspace-utils';
import{nativeMakeCardVisual}from'./components/modals/native-make-card-preview';
import{nativeWorkspaceStrokeTools}from'./native-joy-workspace-source';
import type{NativeConfigurationSource}from'./native-joy-configuration-types';
/** Build the same actual paper/insert slots for inspection and execution. No device authority. */
export function buildNativeWorkspaceBundle(input:{items:WorkspaceObject[];matPreset:string;mat:{width:number;height:number};tools:Parameters<typeof buildWorkspaceCutSvg>[3];materialId:number;cardSize:CardSize|null;insertSlots:boolean;behindColor:string;colorMap:Record<string,string>}):{source:NativeConfigurationSource;visualSvg:string}{
 const{items,matPreset,mat,tools,materialId,cardSize,insertSlots,behindColor,colorMap}=input,insert=materialId===535;
 if(insert&&matPreset!=='joy-card')throw Error('Insert cards require the CardMat selected in the editor.');
 if(matPreset==='joy-card'&&(mat.width!==4.5||mat.height!==6.25))throw Error('CardMat dimensions do not match its explicit mode.');
 const visual=nativeMakeCardVisual(mat,cardSize,insertSlots,behindColor,insert),w=mat.width*WORKSPACE_PIXELS_PER_INCH,h=mat.height*WORKSPACE_PIXELS_PER_INCH;
 const svg=buildWorkspaceCutSvg(items,w,h,tools,WORKSPACE_PIXELS_PER_INCH,visual.slotsSvg,visual.paper);
 if(isCutSvgEmpty(svg))throw Error('There is no supported design content on the workspace paper.');
 const source:NativeConfigurationSource={svg,materialId,mat:{widthIn:mat.width,heightIn:mat.height,...(matPreset==='joy-card'?{mode:'card' as const}:{})},strokeTools:nativeWorkspaceStrokeTools(svg,colorMap)};
 return{source,visualSvg:buildWorkspaceCutPreviewSvg(items,w,h,tools,WORKSPACE_PIXELS_PER_INCH,visual.slotsSvg,visual.paper)};
}
