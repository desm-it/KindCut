import{useNativeMakePlanScroll}from'./native-make-plan-scroll';
import{NativeMakeCardBacking,NativeMakeCardDetails}from'./native-make-card-preview';
import{CARD_SIZES,type CardSize}from'../../workspace-utils';
import{penColourName}from'../panels/native-make-next-action';
import{filterNativePreviewSvg}from'./native-make-visual-svg';
import{normalizeWorkspaceSvgForJoyPreview}from'../../native-joy-workspace-normalize';
import{useMemo}from'react';
import{compileNormalizedSvgForJoy}from'@cricut-companion/svg-preflight';
import type{NativeJoyPlan}from'@cricut-companion/craft-core';
import type{NativeConfigurationSource}from'../../native-joy-configuration-types';
import type{NativeJobMetadata,NativeJobState}from'../../shell/native-joy-job-types';
import{partitionNativeJoyActions}from'../../shell/native-joy-action-plan';
import type{Language}from'../../i18n';
import{ToolGlyph,MatIcon,matPresetToVariant,type MatVariant}from'../workspace/CraftIcons';
import './native-make-preview.css';
export type NativeMakePreviewSource=NativeConfigurationSource&{previewOnly:true;visualSvg?:string;paperColor?:string;behindColor?:string;matPreset?:string;cardSize?:CardSize|null;insertSlots?:boolean};
export type NativeMakeDesign={widthPt:number;heightPt:number;tools:NativeJoyPlan['groups'];visualSvg?:string;paperColor:string;behindColor:string;cutColors:string[];matVariant?:'short'|'card';previewMatVariant?:MatVariant;cardSize?:CardSize|null;insertSlots?:boolean};
export function compileNativeMakeDesign(source:NativeConfigurationSource|NativeMakePreviewSource):NativeMakeDesign{
 const svg='previewOnly'in source&&source.previewOnly===true?normalizeWorkspaceSvgForJoyPreview(source.svg,source.mat):source.svg;
 const p=compileNormalizedSvgForJoy(svg,{materialId:source.materialId,mat:source.mat,strokeTools:source.strokeTools,boundsPolicy:'clip'});
 const display='previewOnly'in source?source:undefined;
 const previewMatVariant:MatVariant=display?.matPreset?matPresetToVariant(display.matPreset):source.mat.heightIn>6.5?'long':source.mat.heightIn===6.25?'card':'short';
 return{widthPt:p.mat.widthIn*72,heightPt:p.mat.heightIn*72,tools:partitionNativeJoyActions(p.groups),cutColors:Object.entries(source.strokeTools).filter(([,role])=>role.tool==='fine_point_blade').map(([color])=>color),visualSvg:display?.visualSvg,paperColor:display?.paperColor??'#faf9f3',behindColor:display?.behindColor??Object.entries(source.strokeTools).find(([,role])=>role.tool==='fine_point_blade')?.[0]??'#423a34',cardSize:display?.cardSize??null,insertSlots:display?.insertSlots??false,previewMatVariant,matVariant:previewMatVariant==='card'?'card':'short'};
}
const toolName=(tool:string,nl:boolean)=>tool==='pen'?'Pen':nl?'Snijden':'Cut';
export function NativeMakeStageIcon({kind,color,large=false,matVariant='short'}:{kind:'load'|'pen'|'cut'|'unload';color?:string;large?:boolean;matVariant?:'short'|'card'}){
 if(kind==='pen'||kind==='cut')return <span className={`native-make__stage-glyph${large?' native-make__stage-glyph--large':''}`}><ToolGlyph tool={kind==='pen'?'pen':'fine_point_blade'} color={color??'#4a433d'}/></span>;
 return <span className={`native-make__stage-mat${large?' native-make__stage-mat--large':''}`}><MatIcon variant={matVariant} height={large?82:44}/><svg className="native-make__feed-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">{kind==='load'?<path d="M12 21V5M6 11l6-6 6 6"/>:<path d="M12 3v16M6 13l6 6 6-6"/>}</svg></span>;
}
export function nativeMakePreviewMatLayout(widthPt:number,heightPt:number){
 const outerWidthPt=widthPt+72,outerHeightPt=heightPt+144;
 return{outerWidthPt,outerHeightPt,widthPx:350*outerWidthPt/outerHeightPt,inset:`${100*72/outerHeightPt}% ${100*36/outerWidthPt}%`};
}
export function NativeMakePreview({design,selected,language,onSelect}:{design:NativeMakeDesign|null;selected:number|null;language:Language;onSelect?:(index:number|null)=>void}){
 const nl=language==='nl',tool=selected===null?undefined:design?.tools[selected],name=tool?toolName(tool.tool,nl):(nl?'Volledig ontwerp':'Full design');
 const preview=useMemo(()=>{if(!design?.visualSvg)return{};try{return{svg:selected===null?design.visualSvg:filterNativePreviewSvg(design.visualSvg,tool?.tool==='pen'?[tool.paths[0]?.color??'']:design.cutColors,true)};}catch{return{error:true};}},[design,selected,tool]);
 const displaySvg=preview.svg;
 const image=useMemo(()=>displaySvg?`data:image/svg+xml;charset=utf-8,${encodeURIComponent(displaySvg)}`:undefined,[displaySvg]);
 const layout=nativeMakePreviewMatLayout(design?.widthPt??324,design?.heightPt??864);
 const groups=design?.tools,previewMatVariant=design?.previewMatVariant??(design?.matVariant==='card'?'card':design&&design.heightPt<=468?'short':'long');
 const card=previewMatVariant==='card',activeCard=card&&design?.cardSize?CARD_SIZES[design.cardSize]:null;
 return <div className="native-make__preview cut-modal__preview-area">
 <div className={`native-make__mat-wrap native-make__mat-backing native-make__mat-wrap--${previewMatVariant}`} style={{width:layout.widthPx,aspectRatio:`${layout.outerWidthPt} / ${layout.outerHeightPt}`}}>{card&&<NativeMakeCardBacking inset={layout.inset}/>}<div className="native-make__mat-art" style={{inset:layout.inset,backgroundColor:card?'rgb(243,242,239)':undefined}}>{card&&<div className="native-make__card-paper" style={{width:activeCard?`${activeCard.width*72/(design?.widthPt??324)*100}%`:"100%",height:activeCard?`${activeCard.height*72/(design?.heightPt??450)*100}%`:"100%",backgroundColor:design?.paperColor??'#faf9f3'}}/>}{image?<img className="native-make__mat" alt={tool?`${name} preview`:nl?'Volledig ontwerp met ingevulde snijvormen':'Full design with filled cut shapes'} src={image} style={{backgroundColor:card?'transparent':design?.paperColor}}/>:<svg className="native-make__mat" role="img" aria-label={tool?`${name} preview`:'Full design preview'} viewBox={`0 0 ${design?.widthPt??324} ${design?.heightPt??864}`}>
 <rect width="100%" height="100%" fill={card?'none':design?.paperColor??'#faf9f3'}/>
 {groups?.flatMap(group=>group.paths.map(path=><path key={`${group.tool}:${path.id}`} d={path.steps.map(s=>s.op+(s.points.length?' '+s.points.map(p=>`${p.x} ${p.y}`).join(' '):'')).join(' ')} fill="none" stroke={path.color??(group.tool==='pen'?'#345c96':design?.behindColor??'#423a34')} strokeWidth="1" opacity={selected===null||group===tool?1:0.18} vectorEffect="non-scaling-stroke"/>))}
 </svg>}{card&&design&&<NativeMakeCardDetails widthPt={design.widthPt} heightPt={design.heightPt} size={design.cardSize??null} color={design.behindColor} slots={!image&&Boolean(design.insertSlots)} dimSlots={tool?.tool==='pen'}/>}</div></div><p className="cut-modal__mat-label">{design?`${design.widthPt/72} × ${design.heightPt/72} in`:'4.5 × 12 in'} · {design?.matVariant==='card'?(nl?'Kaartmat':'Card mat'):(nl?'Joy-mat':'Joy mat')}</p></div>;
}
export function nativeMakeCurrentStep(job:NativeJobState|null|undefined,toolCount:number):number{
 if(!job||['idle','loading_and_aligning','waiting_for_mat','gripped','measuring_y','positioning'].includes(job.phase))return 0;
 if(job.phase==='completed')return toolCount+1;
 const index=job.workflow?.actionIndex??0;
 if(job.phase==='retained_ready')return index+1<toolCount?index+2:toolCount+1;
 return Math.min(index+1,toolCount);
}
export function NativeMakeToolPlans({design,selected,onHover,language,workflow,showAdvancedInfo=false,job}:{design:NativeMakeDesign|null;selected:number|null;onHover?:(index:number|null)=>void;onSelect?:(index:number|null)=>void;language:Language;workflow?:NativeJobMetadata['workflow'];showAdvancedInfo?:boolean;job?:NativeJobState|null}){
 const nl=language==='nl',current=nativeMakeCurrentStep(job,design?.tools.length??0),scrollRef=useNativeMakePlanScroll(current,design);
 return <section className="native-make__tools native-make__icon-plan" aria-label={nl?'Plan':'Plan'}><h3>Plan</h3><div ref={scrollRef} className="native-make__plan-scroll" role="region" aria-label={nl?'Planstappen':'Plan steps'} tabIndex={0} data-native-preview="true" data-active-step={current}><ol className={`cut-steps${job?.phase==='failed'?' cut-steps--error':''}`}>
 <li className={`cut-step cut-step--${current>0?'done':'active'}`} data-step-kind="load" title={nl?'Mat laden':'Load mat'}><span className="cut-step__tile" aria-label={nl?'Mat laden':'Load mat'}><NativeMakeStageIcon kind="load" matVariant={design?.matVariant}/></span><span className="cut-step__label">{nl?'Mat laden':'Load mat'}</span></li>
 {design?.tools.map((tool,i)=>{const recipe=workflow?.actions[i],color=recipe?.color??tool.paths[0]?.color??design.behindColor,label=`${toolName(tool.tool,nl)}${tool.tool==='pen'?` ${color}`:''}`,status=current>i+1?'done':current===i+1?'active':'upcoming';return <li key={`${tool.tool}:${color}:${i}`} data-step-kind={tool.tool==='pen'?'pen':'cut'} className={`cut-step cut-step--${status}`}><span tabIndex={0} aria-label={label} aria-current={current===i+1?'step':undefined} data-native-preview="true" onMouseEnter={()=>onHover?.(i)} onMouseLeave={()=>onHover?.(null)} onFocus={()=>onHover?.(i)} onBlur={()=>onHover?.(null)} title={`${label}${recipe?` · ${recipe.passCount} ${recipe.passCount===1?'pass':'passes'}`:''}`} className={`cut-step__tile native-make__tool-preview${selected===i?' native-make__tool-preview--selected':''}`}><NativeMakeStageIcon kind={tool.tool==='pen'?'pen':'cut'} color={color}/></span><span className="cut-step__label">{tool.tool==='pen'?`${penColourName(color,nl)} pen`:toolName(tool.tool,nl)}</span>{showAdvancedInfo&&<small>{tool.paths.length} paths{recipe?` · ${recipe.passCount} passes · native ${recipe.pressureRequests.join(' / ')}`:''}</small>}</li>;})}
 <li className={`cut-step cut-step--${current===(design?.tools.length??0)+1?'active':'upcoming'}`} data-step-kind="unload" title={nl?'Mat uitladen':'Unload mat'}><span className="cut-step__tile" aria-label={nl?'Mat uitladen':'Unload mat'}><NativeMakeStageIcon kind="unload" matVariant={design?.matVariant}/></span><span className="cut-step__label">{nl?'Mat uitladen':'Unload mat'}</span></li>
 </ol></div>{!design&&<p className="native-make__muted">{nl?'Je gereedschappen verschijnen hier.':'Your tools will appear here.'}</p>}</section>;
}
