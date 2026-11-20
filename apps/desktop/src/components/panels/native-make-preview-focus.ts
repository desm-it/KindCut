import type{NativeJobState}from'../../shell/native-joy-job-types';
import{nativeMakeCurrentStep}from'../modals/native-make-design';
/** View-only focus: no retained click selection and no execution authority. */
export function nativeMakePreviewFocus(job:(NativeJobState&{historical?:boolean})|null|undefined,hovered:number|null,count:number):number|null{
 if(hovered!==null&&Number.isInteger(hovered)&&hovered>=0&&hovered<count)return hovered;
 if(!job?.active||job.historical)return null;
 const step=nativeMakeCurrentStep(job,count);
 return step>0&&step<=count?step-1:null;
}
