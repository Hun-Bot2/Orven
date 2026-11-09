import ReactDOM from "react-dom/client";
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/600.css";
import "@fontsource/newsreader/400.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./tokens.css";
import "./styles.css";
import App from "./App";
import { AccountProvider } from "./AccountContext";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <AccountProvider>
    <App />
  </AccountProvider>,
);
