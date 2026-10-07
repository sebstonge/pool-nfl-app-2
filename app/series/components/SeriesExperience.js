'use client';
import {SeriesLinksContext} from './SeriesLinks';
import SeriesNav from './SeriesNav';
import AdminPreviewReturn from './admin-preview/AdminPreviewReturn';
export default function SeriesExperience({children,publicUrls=false}){
 return <SeriesLinksContext.Provider value={publicUrls}>
  {!publicUrls&&<AdminPreviewReturn/>}{children}<SeriesNav/>
 </SeriesLinksContext.Provider>;
}
