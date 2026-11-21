import { Link } from 'react-router';
import { useDocumentTitle } from '../components/ui';

export function NotFoundPage() {
  useDocumentTitle('Page not found');
  return (
    <div className="empty-state">
      <h1>Page not found</h1>
      <p>That page doesn't exist. It may have moved.</p>
      <Link to="/" className="button">
        Go to the shop
      </Link>
    </div>
  );
}
