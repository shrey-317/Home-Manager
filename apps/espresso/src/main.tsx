import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import './styles.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root missing from index.html');

/**
 * `import.meta.env.BASE_URL` comes from vite.config's `base`, so the router basename can
 * never drift from the deployed subpath. Trailing slash is stripped: React Router wants
 * '/Home-Manager', Vite gives '/Home-Manager/'.
 */
const basename = import.meta.env.BASE_URL.replace(/\/$/, '');

createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
