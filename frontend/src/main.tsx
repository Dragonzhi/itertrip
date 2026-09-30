import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { startOffline } from './lib/offline';

// Root direct access and the deployed subpath share one offline entry point.
// Do this in the page: backend redirects would loop when Nginx strips /itertrip/.
if (import.meta.env.PROD && (location.pathname === '/' || location.pathname === '/itertrip')) {
  history.replaceState(null, '', import.meta.env.BASE_URL + location.search + location.hash);
}
startOffline();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
