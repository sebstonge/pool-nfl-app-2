export const publicPaths=['/','/matchs','/tous-les-choix','/qb-ratings','/analytics','/classements'];
export function publicExperience(phase){
 if(!['regular','playoffs','offseason'].includes(phase))throw new Error('Phase indisponible.');
 return phase;
}
export function seriesHref(path,publicUrls){
 if(!publicUrls)return path;
 const normal=path==='/series'?'/':path.replace(/^\/series\//,'/');
 return publicPaths.includes(normal)?normal:path;
}
export function adminHref(phase){return phase==='playoffs'?'/admin/playoffs':'/admin';}
