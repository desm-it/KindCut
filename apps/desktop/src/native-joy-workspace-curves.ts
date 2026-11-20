/** SVG endpoint-to-centre arcs (SVG 1.1 F.6.5), approximated by <=22.5-degree cubics.
 * Planning only: no I/O or device authority. Endpoints are retained exactly.
 */
export type CurvePoint=[number,number];
export type ArcSegment={op:'L'|'C';p:number[]};
export function arcCubics(from:CurvePoint,to:CurvePoint,rx:number,ry:number,rotation:number,large:number,sweep:number):ArcSegment[]{
 if([from[0],from[1],to[0],to[1],rx,ry,rotation].some(v=>!Number.isFinite(v))||rx<0||ry<0||![0,1].includes(large)||![0,1].includes(sweep))throw Error('Invalid workspace arc parameters.');
 if(from[0]===to[0]&&from[1]===to[1])return[];
 if(!rx||!ry)return[{op:'L',p:[...to]}];
 const phi=(rotation%360)*Math.PI/180,c=Math.cos(phi),s=Math.sin(phi),dx=(from[0]-to[0])/2,dy=(from[1]-to[1])/2;
 const x=c*dx+s*dy,y=-s*dx+c*dy;
 let u=x/rx,v=y/ry,lambda=u*u+v*v;
 if(!Number.isFinite(lambda)||lambda===0)throw Error('Workspace arc exceeds numeric range.');
 if(lambda>1){const scale=Math.sqrt(lambda);rx*=scale;ry*=scale;u=x/rx;v=y/ry;lambda=u*u+v*v;}
 const factor=(large===sweep?-1:1)*Math.sqrt(Math.max(0,(1-lambda)/lambda));
 const cxp=factor*rx*v,cyp=-factor*ry*u,cx=c*cxp-s*cyp+(from[0]+to[0])/2,cy=s*cxp+c*cyp+(from[1]+to[1])/2;
 const a=(x-cxp)/rx,b=(y-cyp)/ry,e=(-x-cxp)/rx,f=(-y-cyp)/ry;
 let theta=Math.atan2(b,a),delta=Math.atan2(a*f-b*e,a*e+b*f);
 if(!sweep&&delta>0)delta-=2*Math.PI;if(sweep&&delta<0)delta+=2*Math.PI;
 const count=Math.max(1,Math.ceil(Math.abs(delta)/(Math.PI/8)));if(count>32)throw Error('Workspace arc segment budget exceeded.');
 const dt=delta/count,point=(t:number):CurvePoint=>[cx+c*rx*Math.cos(t)-s*ry*Math.sin(t),cy+s*rx*Math.cos(t)+c*ry*Math.sin(t)];
 const tangent=(t:number):CurvePoint=>[-c*rx*Math.sin(t)-s*ry*Math.cos(t),-s*rx*Math.sin(t)+c*ry*Math.cos(t)];
 const out:ArcSegment[]=[];let start=from;
 for(let i=0;i<count;i++){const endAngle=theta+dt,end=i===count-1?to:point(endAngle),d0=tangent(theta),d1=tangent(endAngle),k=4/3*Math.tan(dt/4);const p=[start[0]+k*d0[0],start[1]+k*d0[1],end[0]-k*d1[0],end[1]-k*d1[1],...end];if(p.some(n=>!Number.isFinite(n)))throw Error('Nonfinite workspace arc conversion.');out.push({op:'C',p});start=end;theta=endAngle;}
 return out;
}
