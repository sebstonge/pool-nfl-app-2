import SeriesExperience from './components/SeriesExperience';
import {loadPublicContext} from '../../lib/lifecycle/publicServer';
export const dynamic='force-dynamic';
export default async function SeriesLayout({children}) {
 const context=await loadPublicContext();
 return <SeriesExperience publicUrls={context.phase==='playoffs'}>{children}</SeriesExperience>;
}
