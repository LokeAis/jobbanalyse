import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {AuthProvider} from './auth/AuthContext';
import {FeedbackProvider} from './ui/Feedback';
import {installErrorTracking} from './utils/track';
import './index.css';

installErrorTracking();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FeedbackProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </FeedbackProvider>
  </StrictMode>,
);
