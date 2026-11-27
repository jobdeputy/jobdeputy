import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import { Popup, type Send } from '../../src/popup.tsx';
import { readSettings } from '../../src/settings.ts';
import './style.css';

const send: Send = (request) => browser.runtime.sendMessage(request);
const siteUrl = readSettings(import.meta.env)?.siteUrl;

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Popup
        version={browser.runtime.getManifest().version}
        send={send}
        {...(siteUrl ? { siteUrl } : {})}
      />
    </StrictMode>,
  );
}
