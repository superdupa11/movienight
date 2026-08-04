import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { RoomProvider } from "./shared/RoomContext";
import "./index.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");

createRoot(container).render(
  <StrictMode>
    <RoomProvider>
      <App />
    </RoomProvider>
  </StrictMode>,
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js");
  });
}
