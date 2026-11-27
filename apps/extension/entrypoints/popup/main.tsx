import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Popup } from '../../src/popup.tsx';
import './style.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Popup version={browser.runtime.getManifest().version} />
    </StrictMode>,
  );
}
