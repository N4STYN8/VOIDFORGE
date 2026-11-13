/** Small geometric cockpit symbols, drawn in the game's existing cyan line palette. */
export function cockpitIcon(name:string){
 const paths:Record<string,string>={boost:'M4 6l6 6-6 6m6-12l6 6-6 6m6-12l6 6-6 6',overclock:'M14 2L5 14h7l-2 8 10-13h-8z',dock:'M14 5a6 6 0 0 0-7 7L2 17l5 5 5-5a6 6 0 0 0 7-7l-4 4-4-4 4-4z',shop:'M12 2l9 5v10l-9 5-9-5V7zm-9 5l9 5 9-5m-9 5v10',build:'M3 21V8h4V3h4v8h4V5h5v16zM7 15h9m-9 3h9',map:'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',settings:'M9 3h6l1 4 4 1 1 6-4 2-1 5h-6l-2-4-5-1-1-6 4-2zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',hull:'M12 2l9 5v10l-9 5-9-5V7zM12 7v10M7 12h10',shield:'M12 2l8 4v7l-8 9-8-9V6zM12 5v13',energy:'M14 2L5 14h7l-2 8 10-13h-8z',heat:'M6 7v10h12V7M9 3v10M12 2v11M15 3v10M4 20h16'};
 return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${paths[name]??paths.map}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="miter" stroke-linecap="square"/></svg>`;
}
/** Fixed geometry is regenerated only on viewport resize, never by the game loop. */
export function frameMarkup(width:number,height:number,left:number,right:number){
 if(width<700)return `<path d="M0 0H${width}V56H0zM0 ${height-114}l16 10H${width-16}l16-10V${height}H0z" fill="#152635" stroke="#496979"/><path d="M4 60V${height-122}M${width-4} 60V${height-122}" stroke="#4c6a7a" stroke-width="2"/><path d="M20 4h50M${width-70} ${height-5}h50" stroke="#70ccea" stroke-width="2"/>`;
 const bottom=height-114,L=Math.round(left)+26,R=width-Math.round(right)-26;
 const plate=(points:string)=>`<polygon points="${points}" fill="#152635" stroke="#07111b" stroke-width="5"/><polyline points="${points}" fill="none" stroke="#4c6a7a" stroke-width="1"/>`;
 let out=plate(`0,0 ${L+54},0 ${L+8},58 0,58`)+plate(`${width},0 ${R-54},0 ${R-8},58 ${width},58`);
 out+=`<path d="M${L+60} 3H${R-60}l32 26-32 26H${L+60}l-32-26z" fill="#081720" stroke="#477083"/><path d="M${L+58} 8H${R-58}M${L+58} 50H${R-58}" stroke="#1c4856"/>`;
 out+=plate(`0,${bottom-28} 24,${bottom} ${L-10},${bottom} ${L+50},${height-2} 0,${height-2}`)+plate(`${width},${bottom-28} ${width-24},${bottom} ${R+10},${bottom} ${R-50},${height-2} ${width},${height-2}`);
 out+=`<path d="M${L+4} 58V${bottom-4}L${L+40} ${bottom+28}M${R-4} 58V${bottom-4}L${R-40} ${bottom+28}" fill="none" stroke="#547284" stroke-width="3"/><path d="M${L+10} 62V${bottom-8}M${R-10} 62V${bottom-8}" stroke="#112b3a" stroke-width="5"/>`;
 for(const x of [8,width-24]){out+=`<path d="M${x} 58V${bottom-28}" stroke="#385a6d" stroke-width="2"/>`;}
 for(const [x,y] of [[18,18],[width-18,18],[18,height-18],[width-18,height-18],[L+20,18],[R-20,18],[L-4,height-20],[R+4,height-20]]){out+=`<rect x="${x-5}" y="${y-5}" width="10" height="10" fill="#07101b" stroke="#35566a"/><circle cx="${x}" cy="${y}" r="2" fill="#6a96a7"/><path d="M${x-2} ${y+2}l4-4" stroke="#122333"/>`;}
 for(const x of [L+24,R-74,42,width-96]){const y=x===42||x===width-96?height-42:12;out+=`<path d="M${x} ${y}h52l-8 9h-52z" fill="#0b3941" stroke="#3b7e89"/><path d="M${x+4} ${y+3}h39" stroke="#64e5e8" stroke-width="3"/>`;}
 for(const x of [28,width-126]){out+=`<path d="M${x} ${height-67}h94l-12 13h-70z" fill="#0a1723" stroke="#38586b"/><path d="M${x+14} ${height-61}h57" stroke="#2b6875" stroke-width="2"/><path d="M${x+18} ${height-58}h44" stroke="#70ccea" stroke-width="2"/>`;for(let i=0;i<3;i++)out+=`<path d="M${x+20+i*15} ${height-28}l-7 8h8l7-8z" fill="#234253"/>`;}
 return out;
}
