import React from 'react';
import ReactDOM from 'react-dom/client';
// Design system first, so each page's stylesheet can build on it.
import '@shared/styles/design-system.css';
import App from './App';
import { installAuthInterceptor } from './utils/authInterceptor';


// Rejected sessions send the user back to sign in instead of stalling.
installAuthInterceptor();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
