import { createRoot } from "react-dom/client";

import { App } from "./app";
import "./styles.css";
import { inMemoryViewServer, seedOrders } from "./view-server";

await seedOrders(240);

const root = document.querySelector<HTMLDivElement>("#root");
if (root === null) throw new Error("Missing #root mount point");

createRoot(root).render(
  <inMemoryViewServer.ViewServerInMemoryProvider>
    <App />
  </inMemoryViewServer.ViewServerInMemoryProvider>,
);
