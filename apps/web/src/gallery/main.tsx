import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Gallery } from './gallery.tsx';
import '../styles/gallery.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('The #root element is missing from gallery.html.');
}

createRoot(root).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
