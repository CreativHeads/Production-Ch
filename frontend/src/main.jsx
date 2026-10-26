import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import StudioApp from "./studio/StudioApp";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <StudioApp />
  </StrictMode>
);
