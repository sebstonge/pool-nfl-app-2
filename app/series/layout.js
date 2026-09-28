import SeriesNav from './components/SeriesNav';
import AdminPreviewReturn from './components/admin-preview/AdminPreviewReturn';

export default function SeriesLayout({children}) {
  return <><AdminPreviewReturn/>{children}<SeriesNav/></>;
}
