import OffseasonPage from './components/OffseasonPage';
import RegularPage from './RegularPage';
import SeriesPage from './series/page';
import SeriesExperience from './series/components/SeriesExperience';
import {loadPublicContext} from '../lib/lifecycle/publicServer';
export const dynamic='force-dynamic';
export default async function Page(){
 const context=await loadPublicContext();
 if(context.phase==='offseason')return <OffseasonPage season={context.current_season}/>;
 return <RegularPage phase={context.phase} playoffsHome={<SeriesExperience publicUrls><SeriesPage/></SeriesExperience>}/>;
}
