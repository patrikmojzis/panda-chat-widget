import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Toaster } from '@/components/ui/sonner';
import './index.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Console root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
    <Toaster />
  </StrictMode>,
);
