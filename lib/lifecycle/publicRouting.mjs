export const publicPaths=['/','/matchs','/tous-les-choix','/qb-ratings','/analytics','/classements'];
export function publicExperience(phase){
 if(!['regular','playoffs','offseason'].includes(phase))throw new Error('Phase indisponible.');
 // Offseason has no new workflow in 2B-2; existing closed regular views remain.
 return phase==='playoffs'?'playoffs':'regular';
}
export function seriesHref(path,publicUrls){
 if(!publicUrls)return path;
 const normal=path==='/series'?'/':path.replace(/^\/series\//,'/');
 return publicPaths.includes(normal)?normal:path;
}
export function adminHref(phase){return phase==='playoffs'?'/admin/playoffs':'/admin';}
