import 'virtual:lpm-tokens.css';
import './global.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { AppRoot } from './components/AppRoot.js';

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('index.html is missing its #root element.');
}

createRoot(rootElement).render(
  <StrictMode>
    <AppRoot />
  </StrictMode>,
);
