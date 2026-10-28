import {notFound} from 'next/navigation';
import SeasonalPreview from '../../components/seasonal/SeasonalPreview';

// This gallery never renders in a production build, including Vercel Preview.
export default function Page() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <SeasonalPreview />;
}
