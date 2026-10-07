import RegularPage from './RegularPage';
import SeriesPage from '../series/analytics/page';
import SeriesExperience from '../series/components/SeriesExperience';
import {loadPublicContext} from '../../lib/lifecycle/publicServer';
import {publicExperience} from '../../lib/lifecycle/publicRouting.mjs';
export const dynamic='force-dynamic';
export default async function Page(){
 const context=await loadPublicContext();
 return publicExperience(context.phase)==='playoffs'
  ? <SeriesExperience publicUrls><SeriesPage/></SeriesExperience>
  : <RegularPage/>;
}
