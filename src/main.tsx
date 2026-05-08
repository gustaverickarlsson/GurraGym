import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const rootNode = document.getElementById('root');
if (!rootNode) {
  throw new Error('Missing #root for modern app shell');
}

createRoot(rootNode).render(
  <StrictMode>
    <App />
  </StrictMode>
);
