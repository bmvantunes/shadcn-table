import React from "react";
import ReactDOM from "react-dom/client";

import "@bruno/shadcn/styles.css";
import "./styles.css";

import { App } from "./app";

const root = document.querySelector<HTMLDivElement>("#root");

if (!root) {
  throw new Error("Expected the prototype root element.");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
