import OffseasonPage from '../components/OffseasonPage';
import RegularPage from './RegularPage';
import SeriesPage from '../series/tous-les-choix/page';
import SeriesExperience from '../series/components/SeriesExperience';
import {loadPublicContext} from '../../lib/lifecycle/publicServer';
import {publicExperience} from '../../lib/lifecycle/publicRouting.mjs';
export const dynamic='force-dynamic';
export default async function Page(){
 const context=await loadPublicContext();
 if(context.phase==='offseason')return <OffseasonPage season={context.current_season}/>;
 return publicExperience(context.phase)==='playoffs'
  ? <SeriesExperience publicUrls><SeriesPage/></SeriesExperience>
  : <RegularPage/>;
}
