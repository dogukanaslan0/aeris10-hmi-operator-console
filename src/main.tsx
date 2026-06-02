import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import './styles/tokens.css';
import './styles/globals.css';

const rootEl = document.getElementById('root');
if (rootEl === null) {
  throw new Error('AERIS-10: #root element missing from index.html');
}

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
