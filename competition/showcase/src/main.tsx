import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/typography.css";
import "./styles/globals.css";
import "./styles/effects.css";
import { ShowcaseApp } from "./app/ShowcaseApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ShowcaseApp />
  </StrictMode>,
);
