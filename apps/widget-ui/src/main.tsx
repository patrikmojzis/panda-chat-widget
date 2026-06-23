import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { readWidgetPublicKey } from './widget-public-key';
import './styles.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Widget UI root element not found');
}

const widgetPublicKey = readWidgetPublicKey(window.location.search);
const bootstrapBaseHref = window.location.href;

createRoot(rootElement).render(
  <StrictMode>
    <App widgetPublicKey={widgetPublicKey} bootstrapBaseHref={bootstrapBaseHref} />
  </StrictMode>,
);
